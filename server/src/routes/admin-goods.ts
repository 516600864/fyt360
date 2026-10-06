// 商品与品牌（admin-35 自营商品管理 + admin-37 品牌三轨配置中心）
// 自营商品 = self_goods（CPS 商品不入库，铁律）；品牌 = brand_action_cfg（三轨 action 配置）
// 写操作仅限对象级（上下架 / 品牌启停 / 配置保存），聚合视图仍只读（决策#27）
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { resolveHjkConfig } from '../lib/provider.js';
import { fetchFasttype } from '../lib/haojingke.js';

export const adminGoodsRouter = Router();

const SITE_PH = (ids: string[], p = 1): string => ids.map((_, i) => `$${i + p}`).join(',');

async function siteScope(admin: AdminJwtPayload, code: string): Promise<string[]> {
  if (code) {
    const { rows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [code]);
    if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    assertSiteAccess(admin, String(rows[0].site_id));
    return [String(rows[0].site_id)];
  }
  if (admin.role === 'platform_admin') {
    const { rows } = await pool.query(`SELECT site_id::text AS id FROM site`);
    return rows.map((r) => String(r.id));
  }
  if (!admin.siteIds.length) throw new HttpError(403, '无站点权限', 'SITE_FORBIDDEN');
  return admin.siteIds;
}

/** GET /api/admin/redeem/types?site=<code> → 蚂蚁星球积分权益类型列表（实时透传 fasttype，不落库——CPS 铁律）
 *  DIY 编辑器「权益直达」楼层选 cid 用；每项 id 即呼起弹窗的 cid 参数。
 *  fasttype img 字段带规格后缀（…/腾讯视频|12个月（QQ号）!img），拆出规格并入 name。 */
adminGoodsRouter.get('/redeem/types', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteCode = String(req.query.site ?? req.headers['x-fyt-site'] ?? '');
    const { apikey } = await resolveHjkConfig(siteCode || undefined);
    const uid = String(req.query.uid ?? '1');
    // 统一取数：8s 超时 + 5min 缓存 + 并发去重；force=后台编辑场景可加 ?fresh=1 绕过缓存
    const ft = await fetchFasttype(apikey, uid, String(req.query.fresh ?? '') === '1');
    if (!ft.ok) {
      throw new HttpError(502, `蚂蚁星球权益列表获取失败：${ft.message ?? '响应异常'}`, 'UPSTREAM_ERROR');
    }
    const j = { data: ft.data };
    const items = j.data.map((x) => {
      const [rawImg = '', rawSpec = ''] = String(x.img ?? '').split('|');
      const spec = rawSpec.replace(/!img$/, '').trim();
      return {
        cid: Number(x.id),
        name: String(x.cname ?? x.couponName ?? '') + (spec ? ` ${spec}` : ''),
        type: String(x.type ?? ''),
        type_code: String(x.typeCode ?? ''),
        img: rawImg.replace(/!img$/, ''),
        min_points: Number(x.min_points ?? 0),
        max_points: Number(x.max_points ?? 0),
        max_save: Number(x.max_save ?? 0),
      };
    });
    res.json({ ok: true, data: { items, total: items.length } });
  } catch (e) {
    next(e);
  }
});

/** GET /api/admin/self-goods?site=&page=&size=&tab= → 自营商品列表 + tab 计数 */
adminGoodsRouter.get('/self-goods', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = req.admin!;
    const ids = await siteScope(admin, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const size = Math.min(Number(req.query.size) || 20, 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const tab = String(req.query.tab ?? 'all');
    const keyword = String(req.query.keyword ?? '').trim();
    const conds: string[] = [`g.site_id IN (${SITE_PH(ids)})`];
    const params: unknown[] = [...ids];
    if (tab === 'on') conds.push(`g.status = 'on'`);
    if (tab === 'off') conds.push(`g.status = 'off'`);
    if (tab === 'group') conds.push(`g.delivery_type = 'group'`);
    if (keyword) {
      params.push(`%${keyword}%`);
      conds.push(`g.title ILIKE $${params.length}`);
    }
    const where = conds.join(' AND ');

    const { rows: tabRows } = await pool.query(
      `SELECT
         COUNT(*)::int AS all_cnt,
         COUNT(*) FILTER (WHERE status='on')::int AS on_cnt,
         COUNT(*) FILTER (WHERE status='off')::int AS off_cnt,
         COUNT(*) FILTER (WHERE delivery_type='group')::int AS group_cnt
       FROM self_goods g WHERE g.site_id IN (${SITE_PH(ids)})`, ids);
    const tabs = tabRows[0] ?? {};

    const { rows } = await pool.query(
      `SELECT g.goods_id, g.title, g.main_imgs, g.skus, g.delivery_type, g.status, g.cost_price,
              g.created_at, s.code AS site_code, s.name AS site_name
         FROM self_goods g JOIN site s ON s.site_id = g.site_id
        WHERE ${where}
        ORDER BY g.created_at DESC
        LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const items = rows.map((r) => {
      const skus = Array.isArray(r.skus) ? r.skus : [];
      const prices = skus.map((k: { price?: number }) => Number(k.price)).filter((n: number) => Number.isFinite(n));
      const stocks = skus.map((k: { stock?: number }) => Number(k.stock)).filter((n: number) => Number.isFinite(n));
      // 决策#38 + 039：成本是**规格级**的。列表聚合口径：
      //   cost_recorded = 已录成本的规格数 / 总规格数（部分录也算未录全，UI 要说清）
      //   cost_min/max  = 各规格成本区间（供列表一眼看出规格成本差异）
      //   cost_mixed    = 区间非零宽 → 说明各规格成本不同，列表提示"按规格"
      const costNums = skus
        .map((k: { cost?: unknown }) => (k.cost === null || k.cost === undefined || k.cost === '' ? null : Number(k.cost)))
        .filter((n: number | null): n is number => n !== null && Number.isFinite(n));
      const costPrice = r.cost_price === null ? null : Number(r.cost_price);
      return {
        goods_id: r.goods_id,
        title: r.title,
        img: Array.isArray(r.main_imgs) && r.main_imgs[0] ? String(r.main_imgs[0]) : null,
        site: r.site_code,
        site_name: r.site_name,
        price: prices.length ? Math.min(...prices) : null,
        price_max: prices.length ? Math.max(...prices) : null,
        // 兼容旧字段（商品级兜底成本），新 UI 优先读 cost_min/max
        cost_price: costPrice,
        cost_min: costNums.length ? Math.min(...costNums) : null,
        cost_max: costNums.length ? Math.max(...costNums) : null,
        cost_recorded: costNums.length,
        sku_count: skus.length,
        stock: stocks.length ? stocks.reduce((a: number, b: number) => a + b, 0) : 0,
        delivery_type: r.delivery_type,
        status: r.status,
      };
    });
    res.json({ ok: true, data: { tabs, items, page, size } });
  } catch (e) { next(e); }
});

// ---------- 自营商品 CRUD（多规格 SKU 天然支持；2026-09-29 需求更正：履约仅到店团购 group，快递发货已全面移除） ----------

const MAX_SKUS = 20;

type Sku = { sku_id: string; spec: string; price: number; stock: number; cost: number | null };

function parseSkus(raw: unknown): Sku[] {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, '至少需要 1 个 SKU', 'BAD_SKUS');
  if (raw.length > MAX_SKUS) throw new HttpError(400, `SKU 最多 ${MAX_SKUS} 个`, 'BAD_SKUS');
  const seen = new Set<string>();
  return raw.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>;
    const sku_id = String(o.sku_id ?? '').trim() || `s${i + 1}`;
    if (seen.has(sku_id)) throw new HttpError(400, `SKU 标识重复：${sku_id}`, 'BAD_SKUS');
    seen.add(sku_id);
    const spec = String(o.spec ?? '').trim() || '默认';
    const price = Number(o.price);
    const stock = Math.floor(Number(o.stock ?? 0));
    if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, `SKU「${spec}」价格须大于 0`, 'BAD_SKUS');
    if (!Number.isFinite(stock) || stock < 0) throw new HttpError(400, `SKU「${spec}」库存不合法`, 'BAD_SKUS');
    // 决策#38 + 039：成本价是**规格级**的。同一商品的「1件 ¥0.01」和「10件 ¥5.01」
    // 商家结算成本天差地别，用一个商品级成本算两个规格的毛利必错。
    // 空/未传 → null（该规格未录成本，看板显式标「待录入」，绝不写 0 骗人）。
    const cost = parseCostPrice(o.cost);
    // 成本不得高于售价：否则毛利恒负，属于录错而非经营亏损，直接拒。
    if (cost !== null && cost > price) {
      throw new HttpError(400, `SKU「${spec}」成本 ¥${cost} 高于售价 ¥${price}，请检查`, 'BAD_COST_PRICE');
    }
    return { sku_id, spec, price: Math.round(price * 100) / 100, stock, cost };
  });
}

function parseImgArr(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new HttpError(400, '图片字段须为字符串数组', 'BAD_IMGS');
  return v.filter(Boolean);
}

/** 创建/更新共用载荷校验（历史订单走快照，skus 整体重建安全） */
function parseGoodsPayload(b: Record<string, unknown>) {
  const title = String(b.title ?? '').trim();
  if (!title || title.length > 255) throw new HttpError(400, '标题必填且 ≤255 字', 'BAD_TITLE');
  // 2026-09-29 需求更正：自营仅到店团购，快递发货已移除（传 express 一律拒绝，防止旧客户端复活快递链路）
  const delivery_type = 'group';
  if (b.delivery_type === 'express') throw new HttpError(400, '自营已全面移除快递发货，仅支持到店团购/核销', 'BAD_DELIVERY');
  return {
    title,
    delivery_type,
    // 决策#38：商家结算成本价。允许不填（NULL = 未录成本，团购毛利不可算），
    // 但填了就必须是合法非负金额。
    cost_price: parseCostPrice(b.cost_price),
    skus: parseSkus(b.skus),
    main_imgs: parseImgArr(b.main_imgs),
    detail_imgs: parseImgArr(b.detail_imgs),
    video_url: b.video_url ? String(b.video_url) : null,
    freight_tpl: {} as Record<string, unknown>,
  };
}

/**
 * 成本价：空/未传 → NULL（该规格未录成本）；否则必须 ≥0 的两位小数。
 * 负数成本没有业务意义，直接拒。
 * 调用方是 parseSkus（**规格级**成本，迁移 039）——不是商品级。
 */
function parseCostPrice(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, '成本价须为 ≥0 的金额，留空表示未录成本', 'BAD_COST_PRICE');
  return Math.round(n * 100) / 100;
}

/** 写操作站点解析（决策#27：写必须切入具体站点，聚合视图只读；站点上下文由全局 fetch 包装注入 x-fyt-site） */
async function resolveWriteSite(admin: AdminJwtPayload, req: Request): Promise<string> {
  const code = String(req.query.site ?? req.headers['x-fyt-site'] ?? '');
  if (!code) throw new HttpError(400, '写操作须切入具体站点', 'SITE_REQUIRED');
  const { rows } = await pool.query(`SELECT site_id::text AS id FROM site WHERE code = $1 LIMIT 1`, [code]);
  if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
  assertSiteAccess(admin, rows[0].id);
  return rows[0].id;
}

/** POST /api/admin/self-goods → 创建自营商品 */
adminGoodsRouter.post('/self-goods', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await resolveWriteSite(req.admin!, req);
    const p = parseGoodsPayload((req.body ?? {}) as Record<string, unknown>);
    const { rows } = await pool.query(
      `INSERT INTO self_goods (site_id, title, main_imgs, detail_imgs, video_url, skus, freight_tpl, delivery_type, cost_price, status)
       VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5, $6::jsonb, $7::jsonb, $8, $9, 'on')
       RETURNING goods_id`,
      [siteId, p.title, JSON.stringify(p.main_imgs), JSON.stringify(p.detail_imgs), p.video_url,
        JSON.stringify(p.skus), JSON.stringify(p.freight_tpl), p.delivery_type, p.cost_price]);
    res.json({ ok: true, data: { goods_id: Number(rows[0].goods_id) } });
  } catch (e) { next(e); }
});

/** GET /api/admin/self-goods/:id → 详情（完整 skus / detail_imgs / freight_tpl） */
adminGoodsRouter.get('/self-goods/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.goods_id, g.site_id::text AS site_id, s.code AS site_code, g.title, g.main_imgs, g.detail_imgs,
              g.video_url, g.skus, g.freight_tpl, g.delivery_type, g.status, g.cost_price, g.created_at
         FROM self_goods g JOIN site s ON s.site_id = g.site_id
        WHERE g.goods_id = $1::bigint LIMIT 1`,
      [Number(req.params.id)]);
    if (!rows[0]) throw new HttpError(404, '商品不存在', 'GOODS_NOT_FOUND');
    assertSiteAccess(req.admin!, String(rows[0].site_id));
    res.json({ ok: true, data: { ...rows[0], cost_price: rows[0].cost_price === null ? null : Number(rows[0].cost_price) } });
  } catch (e) { next(e); }
});

/** PUT /api/admin/self-goods/:id → 整体更新（含 skus 重建；C 端按 sku_id 扣库存，历史单走快照） */
adminGoodsRouter.put('/self-goods/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '商品 ID 不合法', 'BAD_PARAM');
    const { rows: cur } = await pool.query(`SELECT site_id FROM self_goods WHERE goods_id = $1::bigint LIMIT 1`, [id]);
    if (!cur[0]) throw new HttpError(404, '商品不存在', 'GOODS_NOT_FOUND');
    assertSiteAccess(req.admin!, String(cur[0].site_id));
    const p = parseGoodsPayload((req.body ?? {}) as Record<string, unknown>);
    const { rows } = await pool.query(
      `UPDATE self_goods
          SET title = $2, main_imgs = $3::jsonb, detail_imgs = $4::jsonb, video_url = $5,
              skus = $6::jsonb, freight_tpl = $7::jsonb, delivery_type = $8, cost_price = $9
        WHERE goods_id = $1::bigint
        RETURNING goods_id`,
      [id, p.title, JSON.stringify(p.main_imgs), JSON.stringify(p.detail_imgs), p.video_url,
        JSON.stringify(p.skus), JSON.stringify(p.freight_tpl), p.delivery_type, p.cost_price]);
    res.json({ ok: true, data: { goods_id: Number(rows[0].goods_id) } });
  } catch (e) { next(e); }
});

/** DELETE /api/admin/self-goods/:id → 物理删除（被秒杀活动引用则 409 引导下架；订单只存快照无引用） */
adminGoodsRouter.delete('/self-goods/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '商品 ID 不合法', 'BAD_PARAM');
    const { rows: cur } = await pool.query(`SELECT site_id FROM self_goods WHERE goods_id = $1::bigint LIMIT 1`, [id]);
    if (!cur[0]) throw new HttpError(404, '商品不存在', 'GOODS_NOT_FOUND');
    assertSiteAccess(req.admin!, String(cur[0].site_id));
    const { rows: ref } = await pool.query(`SELECT 1 FROM seckill_activity WHERE goods_id = $1::bigint LIMIT 1`, [id]);
    if (ref[0]) throw new HttpError(409, '商品已被秒杀活动引用，请改用「下架」', 'GOODS_REFERENCED');
    await pool.query(`DELETE FROM self_goods WHERE goods_id = $1::bigint`, [id]);
    res.json({ ok: true, data: { goods_id: id, deleted: true } });
  } catch (e) { next(e); }
});

/** PATCH /api/admin/self-goods/:id/status {status:on|off} → 上下架（对象级写） */
adminGoodsRouter.patch('/self-goods/:id/status', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = String(req.body?.status);
    if (!['on', 'off'].includes(status)) throw new HttpError(400, 'status 须为 on/off', 'BAD_STATUS');
    const { rows } = await pool.query(
      `UPDATE self_goods SET status = $2 WHERE goods_id = $1 RETURNING goods_id, site_id, status`,
      [String(req.params.id), status]);
    if (!rows[0]) throw new HttpError(404, '商品不存在', 'GOODS_NOT_FOUND');
    assertSiteAccess(req.admin!, String(rows[0].site_id));
    res.json({ ok: true, data: { goods_id: rows[0].goods_id, status: rows[0].status } });
  } catch (e) { next(e); }
});

/** GET /api/admin/brands → 品牌三轨列表（action 配置，全站共享配置） */
adminGoodsRouter.get('/brands', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.brand_code, b.name, b.category, c.name AS category_name,
              b.action_type, b.miniapp_cfg, b.h5_cfg, b.health_status, b.enabled, b.site_scope
         FROM brand_action_cfg b JOIN brand_category c ON c.code = b.category
        ORDER BY b.enabled DESC, b.id`);
    res.json({ ok: true, data: { items: rows } });
  } catch (e) { next(e); }
});

/** PATCH /api/admin/brands/:id {enabled?, action_type?, miniapp_cfg?, h5_cfg?} → 品牌配置保存 */
adminGoodsRouter.patch('/brands/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const b = req.body ?? {};
    const sets: string[] = [];
    const params: unknown[] = [];
    if (b.enabled !== undefined) { params.push(Boolean(b.enabled)); sets.push(`enabled = $${params.length}`); }
    if (b.action_type !== undefined) {
      if (!['plugin', 'halfscreen', 'launch'].includes(b.action_type)) throw new HttpError(400, 'action_type 非法', 'BAD_ACTION');
      params.push(b.action_type); sets.push(`action_type = $${params.length}`);
    }
    for (const k of ['miniapp_cfg', 'h5_cfg'] as const) {
      if (b[k] !== undefined) {
        if (typeof b[k] !== 'object' || b[k] === null) throw new HttpError(400, `${k} 须为对象`, 'BAD_CFG');
        params.push(JSON.stringify(b[k])); sets.push(`${k} = $${params.length}::jsonb`);
      }
    }
    if (!sets.length) throw new HttpError(400, '无可更新字段', 'EMPTY_PATCH');
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE brand_action_cfg SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, brand_code, name, action_type, enabled`, params);
    if (!rows[0]) throw new HttpError(404, '品牌不存在', 'BRAND_NOT_FOUND');
    res.json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});
