// 商品实时代理（M2 方案 §0 铁律：列表商品不入库，实时拉取透传）
// 平台：jd / tb / pdd / vip；tb 无 goodsdetail 端点（详情用列表条目渲染）
// 对外统一契约：page（≥1）、size（1-100）、keyword + 各平台透传白名单；
// 平台参数差异在此吸收：jd/vip=pageindex/pagesize，pdd=page/page_size，tb=游标 min_id/tb_p（pagesize 仅限 1,2,10,20,50,100）
import { Router, type Request, type Response, type NextFunction } from 'express';
import { hjkCall, extractList, normalizeGoods } from '../lib/haojingke.js';
import { resolveHjkConfig } from '../lib/provider.js';
import { HttpError } from '../middleware/errors.js';
import { optionalUser } from '../middleware/auth.js';
import { pool } from '../db/client.js';

export const goodsRouter = Router();

const PLATFORMS = new Set(['jd', 'tb', 'pdd', 'vip']);

/** 各平台 goodslist 透传参数白名单（不含分页，分页单独映射） */
const LIST_PASS: Record<string, Set<string>> = {
  jd: new Set(['keyword', 'cid1', 'cid2', 'cid3', 'goods_ids', 'minprice', 'maxprice', 'mincommission', 'maxcommission', 'sortname', 'sort', 'ispg', 'iscoupon', 'ishot', 'owner', 'isunion']),
  tb: new Set(['keyword', 'tb_p', 'min_id', 'limitrate', 'is_tmall', 'is_coupon', 'is_shopping', 'startprice', 'endprice', 'sort']),
  pdd: new Set(['keyword', 'cat_id', 'opt_id', 'block_cats', 'with_coupon', 'sort_type', 'minprice', 'maxprice', 'mincommission', 'maxcommission', 'minsale', 'maxsale', 'ispg', 'isunion', 'goods_sign']),
  vip: new Set(['channelType', 'sourceType', 'jxCode', 'fieldName', 'order', 'openId', 'realCall', 'chanTag', 'offset']),
};

const TB_PAGESIZES = new Set([1, 2, 10, 20, 50, 100]);

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function buildListParams(platform: string, query: Record<string, unknown>): Record<string, string | number | undefined> {
  const page = clampInt(query.page ?? query.pageindex, 1, 10_000, 1);
  const size = clampInt(query.size ?? query.pagesize, 1, 100, platform === 'vip' ? 20 : 10);
  const params: Record<string, string | number | undefined> = { keyword: query.keyword as string | undefined };

  if (platform === 'jd' || platform === 'vip') {
    params.pageindex = page;
    params.pagesize = size;
  } else if (platform === 'pdd') {
    params.page = page;
    params.page_size = size;
  } else {
    // tb：游标分页；pagesize 只允许特定档位，取不超过 size 的最大档
    const snapped = [...TB_PAGESIZES].filter((n) => n <= size).pop() ?? 1;
    params.pagesize = snapped;
    if (page > 1 && !query.min_id && !query.tb_p) {
      throw new HttpError(400, 'TB_CURSOR_REQUIRED', '淘宝分页为游标式：翻页请传上一页返回的 min_id（或 tb_p）');
    }
  }

  const pass = LIST_PASS[platform];
  for (const [k, v] of Object.entries(query)) {
    if (pass.has(k) && typeof v === 'string' && v !== '') params[k] = v;
  }
  return params;
}

async function listHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const platform = String(req.params.platform ?? '');
    if (!PLATFORMS.has(platform)) throw new HttpError(404, 'BAD_PLATFORM', `不支持的平台：${platform}`);

    const cfg = await resolveHjkConfig(req.query.site as string | undefined);
    const params = buildListParams(platform, req.query);

    // vip：实测（2026-09-21）必须带 channelType=1 + sourceType=0 才返回 goodsInfoList；
    // 传 openId=default_open_id/realCall 反而污染请求导致恒空，故仅在调用方显式传入时透传。
    // 关键词搜索走专用 goodsquery 端点（D先生 定稿 2026-09-29：vip 搜索单独接口，支持 keyword/价格区间/排序）；
    // 无词浏览仍走 goodslist（channelType 注入仅限 goodslist，goodsquery 传了反而污染）
    const useQuery = platform === 'vip' && String(params.keyword ?? '').trim() !== '';
    if (platform === 'vip' && !useQuery) {
      params.channelType = (params.channelType as string) ?? '1';
      params.sourceType = (params.sourceType as string) ?? '0';
    }

    const endpoint = useQuery ? 'vip/goodsquery' : `${platform}/goodslist`;
    const { payload } = await hjkCall(endpoint, params, cfg.apikey);
    const size = Number(params.pagesize ?? params.page_size ?? 10);
    const { items, hasMore, cursor } = extractList(platform, payload, size);

    res.json({
      ok: true,
      data: {
        platform,
        page: clampInt(req.query.page ?? req.query.pageindex, 1, 10_000, 1),
        size,
        hasMore,
        cursor, // tb 游标分页凭据：翻页回传 min_id=
        items: items.map((it) => normalizeGoods(platform, it)),
      },
    });
  } catch (e) {
    next(e);
  }
}

async function detailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const platform = String(req.params.platform ?? '');
    if (!PLATFORMS.has(platform)) throw new HttpError(404, 'BAD_PLATFORM', `不支持的平台：${platform}`);
    if (platform === 'tb') throw new HttpError(404, 'NO_DETAIL_API', '淘宝无商品详情端点，请用列表条目数据渲染');

    const cfg = await resolveHjkConfig(req.query.site as string | undefined);
    const goodsId = String(req.query.goods_id ?? '').trim();
    if (!goodsId) throw new HttpError(400, 'BAD_PARAM', '缺少 goods_id');

    const params: Record<string, string | number | undefined> = { goods_id: goodsId };
    if (platform === 'pdd') {
      const sign = String(req.query.goods_sign ?? '').trim();
      if (!sign) throw new HttpError(400, 'BAD_PARAM', '拼多多详情缺少 goods_sign');
      params.goods_sign = sign;
    }

    const { payload } = await hjkCall(`${platform}/goodsdetail`, params, cfg.apikey);
    const raw = payload.data;
    // vip 详情的 data 是数组（最多 10 个 sku），其余平台是对象；防御式取第一个对象值
    let item: Record<string, unknown>;
    if (Array.isArray(raw)) {
      item = (raw[0] as Record<string, unknown> | undefined) ?? {};
    } else {
      const data = (raw ?? {}) as Record<string, unknown>;
      item =
        ((data.data as Record<string, unknown>) ?? null) ??
        ((data.goods as Record<string, unknown>) ?? null) ??
        ((data.goodsInfo as Record<string, unknown>) ?? null) ??
        data;
    }
    res.json({ ok: true, data: { platform, goods: normalizeGoods(platform, item) } });
  } catch (e) {
    next(e);
  }
}

/** GET /api/goods/self/list?page=&size=&keyword= → 自营商品（站内闭环；唯一与 CPS 并列的自有数据面）
 *  站点解析：登录用户 JWT siteId 优先；匿名请求按 ?site=（站点 code）解析——商品为公开信息允许匿名浏览，
 *  交易（下单/支付）仍要求登录（trade.ts requireUser 把守）。
 *  契约对齐 normalizeGoods：{id,title,shortTitle,price,finalPrice,coupon,pic,sales,shop} */
goodsRouter.get('/goods/self/list', optionalUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    let siteId = req.user?.siteId ?? '';
    if (!siteId) {
      const code = String(req.query.site ?? '').trim();
      if (!code) {
        res.json({ ok: true, data: { items: [], hasMore: false, anonymous: true } });
        return;
      }
      const { rows: srows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [code]);
      if (!srows[0]) {
        res.json({ ok: true, data: { items: [], hasMore: false, anonymous: true } });
        return;
      }
      siteId = String(srows[0].site_id);
    }
    const page = clampInt(req.query.page, 1, 10_000, 1);
    const size = clampInt(req.query.size, 1, 100, 10);
    const keyword = String(req.query.keyword ?? '').trim();
    const kwCond = keyword ? `AND title ILIKE $4` : '';
    const kwParam = keyword ? [`%${keyword}%`] : [];
    const { rows } = await pool.query(
      `SELECT goods_id, title, main_imgs, skus
         FROM self_goods
        WHERE site_id = $1::uuid AND status = 'on' ${kwCond}
        ORDER BY created_at DESC
        LIMIT $2::int OFFSET $3::int`,
      [siteId, size + 1, (page - 1) * size, ...kwParam],
    );
    const hasMore = rows.length > size;
    const items = rows.slice(0, size).map((r) => {
      const skus = Array.isArray(r.skus) ? (r.skus as { price?: number }[]) : [];
      const prices = skus.map((k) => Number(k.price)).filter((n) => Number.isFinite(n));
      const imgs = Array.isArray(r.main_imgs) ? (r.main_imgs as string[]) : [];
      return {
        id: String(r.goods_id),
        title: String(r.title),
        shortTitle: String(r.title),
        price: prices.length ? Math.max(...prices) : null,
        finalPrice: prices.length ? Math.min(...prices) : null,
        coupon: null,
        pic: imgs[0] ?? '',
        sales: null,
        shop: '自营',
      };
    });
    res.json({ ok: true, data: { items, hasMore } });
  } catch (e) {
    next(e);
  }
});

goodsRouter.get('/goods/:platform/list', listHandler);
goodsRouter.get('/goods/:platform/detail', detailHandler);
