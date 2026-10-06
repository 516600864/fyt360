// 四平台 CPS 转链（M2.2）：实时调蚂蚁星球 getunionurl，链接不入库（唯一落库面=订单）
// 推广位=user_id（决策 #25⑦，BIGSERIAL 整型）：
//   jd→positionid(整型) | tb→extend_id | pdd→positionid(JSON {"uid"}) | vip→chanTag
// 未登录一律不注入推广位（平台走默认 pid，订单无归因——order.promoter_id 可空）
// 实测结论（2026-09-21，直连验证）：
//   jd  响应 data=短链字符串（无小程序信息）→ 前端降级复制
//   tb  响应 data.coupon_click_url 二合一链接 + get_tkl=1 时 data.coupon_full_tpwd 淘口令
//   pdd 响应 data.data 短链 + data.alldata.we_app_info{app_id,page_path}（appId 动态返回，勿写死映射）
//   vip 响应 data.urlInfoList[]{url, vipWxUrl}；chanTag 单传即可，openId 不传（与 goodslist 相反，无污染问题）
import { Router, type Request, type Response, type NextFunction } from 'express';
import { hjkCall } from '../lib/haojingke.js';
import { resolveHjkConfig, resolveProvider } from '../lib/provider.js';
import { HttpError } from '../middleware/errors.js';
import { optionalUser } from '../middleware/auth.js';
import { pool } from '../db/client.js';

export const linkRouter = Router();

const PLATFORMS = new Set(['jd', 'tb', 'pdd', 'vip']);

/** 各平台转链透传白名单（不含推广位——推广位由登录态注入；不做备案参数 relation_id/special_id/authority） */
const LINK_PASS: Record<string, Set<string>> = {
  jd: new Set(['goods_id', 'type', 'couponurl', 'giftCouponKey']),
  tb: new Set(['item_id', 'get_tkl', 'title', 'logo']),
  pdd: new Set(['goods_sign']),
  vip: new Set(['goods_id', 'type']),
};

interface LinkResult {
  url: string;
  /** 淘口令（仅 tb，get_tkl=1 时） */
  tkl?: string;
  /** 小程序跳转信息（仅 pdd 实测返回；appId 来自上游响应，动态值） */
  miniAppId?: string;
  miniPath?: string;
  /** 唯品会微信小程序内页路径（仅 vip，如 pages/productDetail/productDetail?...），
   *  供官方小程序 pages/special/special?url= 包装跳转用 */
  vipWxUrl?: string;
}

/** 各平台必填校验 + 白名单参数收集 */
function buildLinkParams(platform: string, query: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  const pass = LINK_PASS[platform];
  for (const [k, v] of Object.entries(query)) {
    if (pass.has(k) && typeof v === 'string' && v.trim() !== '') params[k] = v.trim();
  }

  if (platform === 'jd') {
    // jd 的 type 实测必填（缺省报 -200"类型错误！"）：type=1=goods_id 商品，白名单可覆盖
    params.type = params.type ?? '1';
    if (!params.goods_id) throw new HttpError(400, 'BAD_PARAM', '缺少 goods_id');
  }
  if (platform === 'tb' && !params.item_id) throw new HttpError(400, 'BAD_PARAM', '缺少 item_id');
  if (platform === 'pdd' && !params.goods_sign) throw new HttpError(400, 'BAD_PARAM', '缺少 goods_sign');
  if (platform === 'vip' && !params.goods_id) throw new HttpError(400, 'BAD_PARAM', '缺少 goods_id');

  if (platform === 'tb') {
    // 淘口令标题需 >8 字符（R2），商品名不足时兜底补后缀
    const t = (params.title ?? '').trim();
    params.title = t.length > 8 ? t : t ? `${t}，FYT360 精选好物` : 'FYT360 精选好物';
    params.get_tkl = params.get_tkl ?? '1';
  }
  return params;
}

/** 推广位注入（仅登录态；user_id 为 BIGSERIAL 整型，各平台参数形态见文件头注释） */
function injectPromoter(platform: string, params: Record<string, string>, userId: number): void {
  const uid = String(userId);
  switch (platform) {
    case 'jd':
      // jd 上游强制要求 ≥1 整型推广位（空/0 报"推广位不可为空"）：匿名注入站点默认位 1，
      // 订单 positionId=1 即站点自然流量（无个人归因）；登录态用 user_id
      params.positionid = uid;
      break;
    case 'tb':
      params.extend_id = uid;
      break;
    case 'pdd':
      // pdd 的 positionid 实为 custom_parameters JSON（≤64B），非整型
      params.positionid = JSON.stringify({ uid });
      break;
    case 'vip':
      params.chanTag = uid;
      break;
  }
}

/** 各平台响应差异吸收（实测结构，见文件头） */
function extractLink(platform: string, payload: Record<string, unknown>): LinkResult {
  const data = payload.data;
  switch (platform) {
    case 'jd': {
      // data 即短链字符串
      const url = typeof data === 'string' ? data : String((data as Record<string, unknown> | null)?.data ?? '');
      if (!url) throw new HttpError(502, 'CONVERT_EMPTY', '京东转链未返回链接');
      return { url };
    }
    case 'tb': {
      const d = (data ?? {}) as Record<string, unknown>;
      const url = String(d.coupon_click_url ?? d.coupon_long_url ?? '');
      if (!url) throw new HttpError(502, 'CONVERT_EMPTY', '淘宝转链未返回链接');
      const tkl = d.coupon_full_tpwd ? String(d.coupon_full_tpwd) : undefined;
      return tkl ? { url, tkl } : { url };
    }
    case 'pdd': {
      const d = (data ?? {}) as Record<string, unknown>;
      const alldata = (d.alldata ?? null) as Record<string, unknown> | null;
      const we = (alldata?.we_app_info ?? null) as Record<string, unknown> | null;
      const url = String(d.data ?? alldata?.short_url ?? '');
      if (!url) throw new HttpError(502, 'CONVERT_EMPTY', '拼多多转链未返回链接');
      const out: LinkResult = { url };
      if (we?.app_id && we?.page_path) {
        out.miniAppId = String(we.app_id);
        out.miniPath = String(we.page_path);
      }
      return out;
    }
    case 'vip': {
      const d = (data ?? {}) as Record<string, unknown>;
      const list = (d.urlInfoList ?? []) as Record<string, unknown>[];
      const first = list[0] ?? {};
      const url = String(first.url ?? '');
      if (!url) throw new HttpError(502, 'CONVERT_EMPTY', '唯品会转链未返回链接');
      // vipWxUrl=官方微信小程序内页路径（实测 2026-09-22），前端包装跳小程序用
      const vipWxUrl = first.vipWxUrl ? String(first.vipWxUrl) : undefined;
      return vipWxUrl ? { url, vipWxUrl } : { url };
    }
    default:
      throw new HttpError(404, 'BAD_PLATFORM', '不支持的平台');
  }
}

async function unionHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const platform = String(req.params.platform ?? '');
    if (!PLATFORMS.has(platform)) throw new HttpError(404, 'BAD_PLATFORM', `不支持的平台：${platform}`);

    const cfg = await resolveHjkConfig(req.query.site as string | undefined);
    const params = buildLinkParams(platform, req.query);
    if (req.user) injectPromoter(platform, params, req.user.userId);
    // jd 匿名兜底：上游强制推广位，用站点默认位 1（见 injectPromoter 注释）
    if (platform === 'jd' && !req.user) params.positionid = '1';

    const { payload } = await hjkCall(`${platform}/getunionurl`, params, cfg.apikey);
    const link = extractLink(platform, payload);

    res.json({ ok: true, data: { platform, ...link } });
  } catch (e) {
    next(e);
  }
}

// ── 自营 H5 呼起小程序（URL Scheme，generateScheme）───────────────────────────
// H5 无自营交易链（决策：交易闭环在小程序）→ 自营商品点击直接呼起小程序商品页。
// 凭据跟 site_id 走（provider_config wechat_mini）；env_version 默认 release，
// 小程序提审发布前可用 env=trial（仅体验成员可打开）做真机验证；30 分钟有效。
const SELF_DETAIL_PATH = '/pages/goods/self-detail';

linkRouter.get('/self/launch', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const goodsId = String(req.query.goods_id ?? '').trim();
    if (!/^\d+$/.test(goodsId)) throw new HttpError(400, 'BAD_PARAM', '缺少 goods_id');
    const env = String(req.query.env ?? 'release');
    if (!['release', 'trial', 'develop'].includes(env)) throw new HttpError(400, 'BAD_PARAM', 'env 非法');
    const siteCode = String(req.query.site ?? '');
    const { rows } = await pool.query(
      `SELECT site_id FROM site WHERE code = $1::varchar AND status = 'active' LIMIT 1`,
      [siteCode],
    );
    if (!rows[0]) throw new HttpError(404, 'SITE_NOT_FOUND', '站点不存在或未启用');
    const cred = await resolveProvider(siteCode, 'wechat_mini');
    if (!cred.apikey || !cred.apiSecret) throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', '该站点小程序凭据未配置');

    const t = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid: cred.apikey, secret: cred.apiSecret }),
    });
    const tj = (await t.json().catch(() => null)) as { access_token?: string; errmsg?: string } | null;
    if (!tj?.access_token) throw new HttpError(502, 'WX_TOKEN_ERROR', `获取小程序凭证失败：${tj?.errmsg ?? '响应异常'}`);

    const g = await fetch(`https://api.weixin.qq.com/wxa/generatescheme?access_token=${tj.access_token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jump_wxa: { path: SELF_DETAIL_PATH, query: `id=${goodsId}`, env_version: env },
        is_expire: true,
        expire_type: 1,
        expire_interval: 30,
      }),
    });
    const gj = (await g.json().catch(() => null)) as { openlink?: string; errcode?: number; errmsg?: string } | null;
    if (!gj?.openlink) {
      // 40165=页面不存在：小程序从未提审发布（无线上版本可索引）时 release/trial/develop 全部拒绝
      const msg = gj?.errcode === 40165
        ? '小程序尚未发布正式版本，发布后即可一键呼起（可先搜索「FYT360」小程序使用）'
        : `呼起链接生成失败：${gj?.errmsg ?? `errcode=${gj?.errcode}`}`;
      throw new HttpError(502, 'SCHEME_ERROR', msg);
    }
    res.json({
      ok: true,
      data: { openlink: gj.openlink, appid: cred.apikey, path: SELF_DETAIL_PATH, query: `id=${goodsId}`, env_version: env },
    });
  } catch (e) {
    next(e);
  }
});

// optionalUser：登录态可选——有 token 解析出 user 注入推广位，无 token 匿名转链
linkRouter.get('/:platform/union', optionalUser, unionHandler);
