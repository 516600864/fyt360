// 订单中心（admin-32）：全平台聚合订单列表，真数据
// 类型口径：self=自营 / PROVIDER_CPS=CPS 供应链 / PROVIDER_INGOT=积分兑换(蚂蚁星球，只读)
//   ⚠️ provider 分类已与蚂蚁星球 pf_type 对齐（D先生 2026-10-04），常量单一真相源在 lib/constants.ts，
//      新增 provider 桶务必同步那里，否则本tab 会漏数据。
// 售后 = refund_status <> 'none'；用户脱敏展示（昵称首字+**）
// 站点隔离：平台超管=全站点（决策#27 聚合只读）；站点角色=权限白名单
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import {
  CPS_PROVIDERS_SQL as CPS_PROVIDERS,
  INGOT_PROVIDERS_SQL as INGOT_PROVIDERS,
  TYPE_FILTER_GROUPS,
  TYPE_FILTER_ITEMS,
  STATUS_FILTER_SEGMENTS,
  STATUS_WHITELIST,
  TIME_FIELDS,
  resolveTimeField,
} from '../lib/constants.js';

export const ordersRouter = Router();

async function resolveSiteScope(admin: AdminJwtPayload, code: string): Promise<string[]> {
  const isPlatform = admin.role === 'platform_admin';
  if (code) {
    const { rows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [code]);
    if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    const siteId = String(rows[0].site_id);
    assertSiteAccess(admin, siteId);
    return [siteId];
  }
  if (isPlatform) {
    const { rows } = await pool.query(`SELECT site_id::text AS id FROM site`);
    return rows.map((r) => String(r.id));
  }
  if (!admin.siteIds.length) throw new HttpError(403, '无站点权限', 'SITE_FORBIDDEN');
  return admin.siteIds;
}

function tabCondition(tab: string): string {
  switch (tab) {
    case 'self': return `o.provider = 'self'`;
    case 'cps': return `o.provider = ANY(string_to_array('${CPS_PROVIDERS}', ','))`;
    case 'ingot': return `o.provider = ANY(string_to_array('${INGOT_PROVIDERS}', ','))`;
    case 'after': return `o.refund_status <> 'none'`;
    default: return 'TRUE';
  }
}

/** 三维状态机 → 展示文案。
 *  优先级铁律（2026-10-02 修）：**未支付/已关闭必须先于履约维度判定**。
 *  建单时 fulfill_status 默认就带 'pending'，若先判履约，未付款单会被误显示成「待核销」——
 *  业务上未付款根本不该进入履约阶段。正确顺序：售后 > 支付态(未付/已关闭) > 履约 > 平台结算态。 */
function statusLabel(o: { refund_status: string; fulfill_status: string; platform_status: string; fulfillment?: string | null }): string {
  if (o.refund_status === 'applying') return '退款审核中';
  if (o.refund_status === 'refunded') return '已退款';
  if (o.refund_status === 'partial') return '部分退款';
  if (o.platform_status === 'created') return '待支付';
  if (o.platform_status === 'closed') return '已关闭';
  if (o.fulfill_status === 'delivered') return '已收货';
  if (o.fulfill_status === 'verified') return '已核销';
  if (o.fulfill_status === 'pending') return o.fulfillment === 'group' ? '待核销' : '待发货';
  if (o.platform_status === 'settled') return '已结算';
  if (o.platform_status === 'paid') return '已付款';
  return '待支付';
}

function orderType(provider: string): 'self' | 'cps' | 'ingot' {
  if (provider === 'self') return 'self';
  if (INGOT_PROVIDERS.split(',').includes(provider)) return 'ingot';
  return 'cps';
}

/** 展示状态的 SQL 镜像（与 statusLabel 优先级逐一对应，供状态筛选精确命中）。
 *  顺序铁律同statusLabel：created/closed 必须在 fulfill_status 之前。 */
const STATUS_CASE = `(CASE
    WHEN o.refund_status = 'applying' THEN '退款审核中'
    WHEN o.refund_status = 'refunded' THEN '已退款'
    WHEN o.refund_status = 'partial' THEN '部分退款'
    WHEN o.platform_status = 'created' THEN '待支付'
    WHEN o.platform_status = 'closed' THEN '已关闭'
    WHEN o.fulfill_status = 'delivered' THEN '已收货'
    WHEN o.fulfill_status = 'verified' THEN '已核销'
    WHEN o.fulfill_status = 'pending' THEN (CASE WHEN o.fulfillment = 'group' THEN '待核销' ELSE '待发货' END)
    WHEN o.platform_status = 'settled' THEN '已结算'
    WHEN o.platform_status = 'paid' THEN '已付款'
    ELSE '待支付' END)`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 逗号分隔多值参数 → 白名单过滤后的数组（防注入：不在白名单里的一律丢弃）。
 *  前端多选用 `types=a,b,c` / `statuses=x,y` 传参，逗号分隔而非数组，兼容 URL 与网关。 */
function multiValue(raw: unknown, whitelist: string[] | null): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  const items = s.split(',').map((x) => x.trim()).filter(Boolean);
  if (!whitelist) return items;
  const set = new Set(whitelist);
  return items.filter((x) => set.has(x));
}

/**
 * 类型多选 → SQL。选中项 value 走 TYPE_FILTER_ITEMS 展平成 provider 桶。
 * ⚠️ ingot 是聚合项（dc+recharge+movie），与单桶项有重叠 → 必须用 IN 而不是 OR 等值，
 *    且多个 value 的桶要去重，否则同一单被重复计入（COUNT 不受影响但会拖慢）。
 */
function typeFilterSql(values: string[], params: unknown[]): string | null {
  const known = values.filter((v) => TYPE_FILTER_ITEMS[v]);
  if (!known.length) return null;
  const buckets = [...new Set(known.flatMap((v) => TYPE_FILTER_ITEMS[v]))];
  params.push(buckets.join(','));
  return `o.provider = ANY(string_to_array($${params.length}, ','))`;
}

/**
 * 支付方式筛选（admin-32B）。
 * ⚠️ 真实库现状：**只有自营单有真实微信支付流水**（self 49 单里 24 单有 payment_no，
 *    其余 6900+ CPS 单 payment_no 全空——钱不是经我手收的）。
 *    所以「支付方式」只能对自营单生效，UI 必须标注口径，否则筛出来 0 条会被当成 bug。
 *    值：online=有线上支付流水 / offline=无（未支付或走线下）。
 */
const PAY_METHODS = ['online', 'offline'] as const;
function payFilterSql(values: string[], params: unknown[]): string | null {
  const vs = multiValue(values.join(','), [...PAY_METHODS]);
  if (!vs.length) return null;
  const parts: string[] = [];
  if (vs.includes('online')) parts.push(`o.payment_no IS NOT NULL AND o.payment_no <> ''`);
  if (vs.includes('offline')) parts.push(`(o.payment_no IS NULL OR o.payment_no = '')`);
  if (!parts.length) return null;
  return `(${parts.join(' OR ')})`;
}

/** 列表筛选构造：关键词 / 时间口径 / 区间 / 类型多选 / 状态多选 / 支付方式 → SQL。
 *  计数、列表、导出、角标四处共用，保证口径一致；返回值形如 " AND ..."，无筛选时为空串。
 *  ⚠️ 时间必须走 time_field 白名单列，不能再默认 created_at（决策 #42）。 */
function extraFilters(q: Record<string, unknown>, params: unknown[]): string {
  const conds: string[] = [];
  const keyword = String(q.keyword ?? '').trim();
  if (keyword) {
    params.push(`%${keyword}%`);
    const k = `$${params.length}`;
    conds.push(`(o.order_sn ILIKE ${k} OR o.provider_order_sn ILIKE ${k} OR o.goods_snapshot->>'title' ILIKE ${k})`);
  }

  // 类型多选（types=jd,meituan）；兼容旧参数 type=jd（新前端只传 types）
  const knownTypes = Object.keys(TYPE_FILTER_ITEMS);
  let typeValues = multiValue(q.types, knownTypes);
  if (!typeValues.length) {
    const legacy = String(q.type ?? '').trim();
    if (legacy && knownTypes.includes(legacy)) typeValues = [legacy];
  }
  const typeSql = typeFilterSql(typeValues, params);
  if (typeSql) conds.push(typeSql);

  // 状态多选（statuses=已付款,已结算），白名单=9 个合法文案
  const statuses = multiValue(q.statuses, STATUS_WHITELIST);
  if (statuses.length) {
    params.push(statuses.join(','));
    conds.push(`${STATUS_CASE} = ANY(string_to_array($${params.length}, ','))`);
  }

  const paySql = payFilterSql(multiValue(q.pay, [...PAY_METHODS]), params);
  if (paySql) conds.push(paySql);

  // 时间区间：按 time_field 选列（决策 #42，默认 paid_at）
  const tf = resolveTimeField(q.time_field);
  const col = `o.${TIME_FIELDS[tf].column}`;
  const from = String(q.from ?? '');
  const to = String(q.to ?? '');
  if (DATE_RE.test(from)) {
    params.push(from);
    conds.push(`${col} >= $${params.length}::date`);
  }
  if (DATE_RE.test(to)) {
    params.push(to);
    conds.push(`${col} < ($${params.length}::date + interval '1 day')`);
  }
  return conds.length ? ` AND ${conds.join(' AND ')}` : '';
}

/** 排序列同样跟着时间口径走：筛「结算时间」就该按结算时间倒序，不能永远按状态更新排。 */
function orderBySql(raw: unknown): string {
  return `COALESCE(o.${TIME_FIELDS[resolveTimeField(raw)].column}, o.created_at) DESC`;
}

/** GET /api/admin/orders/sites → 筛选下拉的站点选项（超管=全站；站点角色=自身权限站点） */
ordersRouter.get('/sites', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = req.admin!;
    let rows: { code: string; name: string }[];
    if (admin.role === 'platform_admin') {
      ({ rows } = await pool.query(`SELECT code, name FROM site ORDER BY created_at`));
    } else if (admin.siteIds.length) {
      const ids: string[] = admin.siteIds;
      const ph = ids.map((_, i) => `$${i + 1}`).join(',');
      ({ rows } = await pool.query(`SELECT code, name FROM site WHERE site_id IN (${ph}) ORDER BY created_at`, ids));
    } else {
      rows = [];
    }
    res.json({ ok: true, data: { sites: rows } });
  } catch (e) { next(e); }
});

/** GET /api/admin/orders/filter-options?tab=&site=&time_field=&from=&to=
 *  → admin-32B 筛选台角标：每个类型项 / 每个状态项在**当前范围**下的单数。
 *
 *  设计动机（D先生）：「不用筛完才知道有没有数据」。所以角标必须与列表同口径——
 *  同样受tab/site/时间区间约束，但**排除自身这一维**（选了京东，角标仍显示美团有多少，
 *  否则勾一个归零就再也无法横向比较）。
 *  ⚠️ 网关 exec-pgsql 单次返回上限 1000 行（DATABASE_RESULT_EXCEED_MAX_ROWS），
 *    这里是纯聚合查询，返回行数 = provider 桶数（≤20），安全。 */
ordersRouter.get('/filter-options', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tab = String(req.query.tab ?? 'all');
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const ph = sites.map((_, i) => `$${i + 1}`).join(',');
    const params: unknown[] = [...sites];
    let tabSql = tabCondition(tab);
    if (tab !== 'all' && tab !== 'self' && tab !== 'after') {
      params.push(tab === 'cps' ? CPS_PROVIDERS : INGOT_PROVIDERS);
      tabSql = `o.provider = ANY(string_to_array($${params.length}, ','))`;
    }
    // 角标口径：只带 tab + 时间（+站点），**不带** types/statuses/pay/keyword
    const tf = resolveTimeField(req.query.time_field);
    const col = `o.${TIME_FIELDS[tf].column}`;
    const conds: string[] = [];
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (DATE_RE.test(from)) { params.push(from); conds.push(`${col} >= $${params.length}::date`); }
    if (DATE_RE.test(to)) { params.push(to); conds.push(`${col} < ($${params.length}::date + interval '1 day')`); }
    const extra = conds.length ? ` AND ${conds.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT o.provider, ${STATUS_CASE} AS st, COUNT(*)::int AS cnt
         FROM "order" o
        WHERE o.site_id IN (${ph}) AND ${tabSql}${extra}
        GROUP BY 1, 2`,
      params
    );

    const byProvider = new Map<string, number>();
    const byStatus = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      const c = Number(r.cnt || 0);
      total += c;
      byProvider.set(String(r.provider), (byProvider.get(String(r.provider)) ?? 0) + c);
      byStatus.set(String(r.st), (byStatus.get(String(r.st)) ?? 0) + c);
    }
    // provider 桶 → 类型项（ingot 是聚合项，会与 dc/movie/recharge 重复计数，这里按桶反查即可）
    const groups = TYPE_FILTER_GROUPS.map((g) => ({
      key: g.key,
      label: g.label,
      items: g.items.map((i) => ({
        value: i.value,
        label: i.label,
        count: i.providers.reduce((s, p) => s + (byProvider.get(p) ?? 0), 0),
      })),
    }));
    const segments = STATUS_FILTER_SEGMENTS.map((s) => ({
      key: s.key,
      label: s.label,
      hint: s.hint,
      items: s.items.map((label) => ({ label, count: byStatus.get(label) ?? 0 })),
      count: s.items.reduce((sum, x) => sum + (byStatus.get(x) ?? 0), 0),
    }));
    res.json({ ok: true, data: { groups, segments, total, time_field: tf } });
  } catch (e) { next(e); }
});

/** GET /api/admin/orders?tab=&site=&page=&size=&keyword=&types=&statuses=&pay=&time_field=&from=&to= */
ordersRouter.get('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tab = String(req.query.tab ?? 'all');
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const ph = sites.map((_, i) => `$${i + 1}`).join(',');
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(String(req.query.size ?? '20'), 10) || 20));

    // 计数参数：站点 + 共享筛选（与列表同口径）
    const countParams: unknown[] = [...sites];
    const countExtra = extraFilters(req.query, countParams);

    // 各 tab 计数（一次聚合）
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS all_cnt,
              COUNT(*) FILTER (WHERE o.provider = 'self')::int AS self_cnt,
              COUNT(*) FILTER (WHERE o.provider = ANY(string_to_array('${CPS_PROVIDERS}', ',')))::int AS cps_cnt,
              COUNT(*) FILTER (WHERE o.provider = ANY(string_to_array('${INGOT_PROVIDERS}', ',')))::int AS ingot_cnt,
              COUNT(*) FILTER (WHERE o.refund_status <> 'none')::int AS after_cnt
         FROM "order" o
        WHERE o.site_id IN (${ph})${countExtra}`,
      countParams
    );

    // 列表（tab 条件参数化 + 共享筛选）
    const listParams: unknown[] = [...sites];
    let tabSql = tabCondition(tab);
    if (tab !== 'all' && tab !== 'self' && tab !== 'after') {
      listParams.push(tab === 'cps' ? CPS_PROVIDERS : INGOT_PROVIDERS);
      tabSql = `o.provider = ANY(string_to_array($${listParams.length}, ','))`;
    }
    const listExtra = extraFilters(req.query, listParams);
    listParams.push(size, (page - 1) * size);
    const limitPh = `$${listParams.length - 1}`;
    const offsetPh = `$${listParams.length}`;

    const { rows } = await pool.query(
      `SELECT o.id, o.order_sn, o.provider, o.provider_order_sn, o.pay_price::float AS pay_price,
              o.commission::float AS commission, o.platform_status, o.fulfill_status, o.refund_status,
              o.fulfillment, o.coupon_id, o.coupon_discount::float AS coupon_discount,
              o.goods_snapshot->>'title' AS goods_title,
              o.goods_snapshot->>'goods_amount' AS goods_amount_raw,
              o.goods_snapshot->>'coupon_name' AS coupon_name,
              o.created_at,
              -- ⛔ 三个时间必须分开展示（D先生 2026-10-04「下单时间是不是搞错了」）：
              --   paid_at=下单时间/ settled_at=完成时间/ platform_updated_at=上游最近状态更新时间
              --   结算滞后 p50=12天/max=31天，三者混成一个「时间」必然被误判为数据错。
              o.paid_at, o.settled_at, o.platform_updated_at,
              o.biz_category, o.biz_channel,
              s.code AS site_code, s.name AS site_name,
              u.nickname AS buyer_nickname, o.buyer_id AS buyer_id
         FROM "order" o
         JOIN site s ON s.site_id = o.site_id
         LEFT JOIN "user" u ON u.user_id = o.buyer_id
        WHERE o.site_id IN (${ph}) AND ${tabSql}${listExtra}
        ORDER BY ${orderBySql(req.query.time_field)}
        LIMIT ${limitPh} OFFSET ${offsetPh}`,
      listParams
    );

    // 当页订单的佣金三级分配明细（自购/直推/间推 + 受益人昵称与等级；含 invalid 作废记录供前端展示全貌）
    const ids = rows.map((r) => r.id).filter(Boolean);
    const flowByOrder = new Map<number, Array<{ level: number; user_id: number; nickname: string | null; level_name: string | null; amount: number; status: string }>>();
    if (ids.length) {
      const flowParams = [...ids];
      const flowPh = flowParams.map((_, i) => `$${i + 1}`).join(',');
      const { rows: flows } = await pool.query(
        `SELECT cf.order_id, cf.level, cf.user_id, u.nickname, ml.name AS level_name,
                cf.amount::float AS amount, cf.status
           FROM commission_flow cf
           LEFT JOIN "user" u ON u.user_id = cf.user_id
           LEFT JOIN member m ON m.user_id = cf.user_id
           LEFT JOIN member_level ml ON ml.level_id = m.level_id
          WHERE cf.order_id IN (${flowPh})
          ORDER BY cf.order_id, cf.level`,
        flowParams
      );
      for (const f of flows) {
        const arr = flowByOrder.get(f.order_id) ?? [];
        arr.push(f);
        flowByOrder.set(f.order_id, arr);
      }
    }

    const items = rows.map((r) => ({
      id: r.id,
      order_sn: r.order_sn,
      provider_sn: r.provider_order_sn,
      type: orderType(r.provider),
      provider: r.provider,
      site_code: r.site_code,
      site_name: r.site_name,
      goods_title: r.goods_title ?? '—',
      pay_price: r.pay_price,
      commission: r.commission,
      // 积分兑换单不展示佣金（与元宝体系无关）
      commission_visible: orderType(r.provider) !== 'ingot',
      // 佣金三级分配明细（level 1=自购 2=直推 3=间推）；平台盈余=commission-Σ有效分配，前端计算
      commissions: flowByOrder.get(r.id) ?? [],
      buyer: r.buyer_nickname
        ? `${String(r.buyer_nickname).slice(0, 1)}**`
        : r.buyer_id
          ? `用户#${r.buyer_id}`
          : '未归因',
      status: statusLabel(r),
      fulfillment: r.fulfillment ?? null, // self 单恒 group 到店核销（2026-09-29 需求更正）；CPS/直充 null
      coupon: r.coupon_id
        ? { user_coupon_id: Number(r.coupon_id), name: r.coupon_name ?? '营销券', discount: Number(r.coupon_discount ?? 0) }
        : null,
      goods_amount: r.goods_amount_raw ? Number(r.goods_amount_raw) : null,
      created_at: r.created_at,
      // ⛔ 三个时间分别下发（D先生 2026-10-04）：下单 / 完成 / 上游状态更新。
      //    结算滞后 p50=12天、max=31天，合成一个「时间」必然被当成数据错。
      paid_at: r.paid_at ?? null,
      settled_at: r.settled_at ?? null,
      platform_updated_at: r.platform_updated_at ?? null,
      // 订单业务细分（问 2：不能只给「CPS 供应链」）
      biz_category: r.biz_category ?? null,
      biz_channel: r.biz_channel ?? null,
    }));

    res.json({
      ok: true,
      data: {
        tabs: {
          all: countRows[0]?.all_cnt ?? 0,
          self: countRows[0]?.self_cnt ?? 0,
          cps: countRows[0]?.cps_cnt ?? 0,
          ingot: countRows[0]?.ingot_cnt ?? 0,
          after: countRows[0]?.after_cnt ?? 0,
        },
        items,
        page,
        size,
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/admin/orders/export?tab=&site=&keyword= → CSV（当前筛选，≤5000 行） */
ordersRouter.get('/export', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tab = String(req.query.tab ?? 'all');
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const ph = sites.map((_, i) => `$${i + 1}`).join(',');

    const params: unknown[] = [...sites];
    let tabSql = tabCondition(tab);
    // 与列表接口同口径参数化（原来只处理 cps/ingot，self/after 走字面量分支，两处易走偏）
    if (tab !== 'all' && tab !== 'self' && tab !== 'after') {
      params.push(tab === 'cps' ? CPS_PROVIDERS : INGOT_PROVIDERS);
      tabSql = `o.provider = ANY(string_to_array($${params.length}, ','))`;
    }
    const extraSql = extraFilters(req.query, params);

    // ⚠️ **必须分页取**：网关 exec-pgsql 单次返回上限 1000 行（DATABASE_RESULT_EXCEED_MAX_ROWS）。
    //    旧代码 `LIMIT 5000` 一次拉，订单量一旦过千就整段 500 —— 2026-10-04 回填到 6947 单后暴露。
    //    改成 1000 一页循环，最多 EXPORT_MAX_ROWS 行（保持「导出上限 5000」的业务语义不变）。
    const EXPORT_PAGE = 1000;
    const EXPORT_MAX_ROWS = 5000;
    const rows: Array<Record<string, unknown>> = [];
    outer: for (let page = 0; page < EXPORT_MAX_ROWS / EXPORT_PAGE; page++) {
      const pageRows = await pool.query(
        `SELECT o.order_sn, o.provider, o.provider_order_sn, o.pay_price::float AS pay_price,
                o.commission::float AS commission, o.platform_status, o.fulfill_status, o.refund_status,
                o.goods_snapshot->>'title' AS goods_title, o.created_at,
                o.paid_at, o.settled_at, o.platform_updated_at, o.biz_category, o.biz_channel,
                s.code AS site_code, u.nickname AS buyer_nickname, u.user_id AS buyer_id
           FROM "order" o
           JOIN site s ON s.site_id = o.site_id
           LEFT JOIN "user" u ON u.user_id = o.buyer_id
          WHERE o.site_id IN (${ph}) AND ${tabSql}${extraSql}
          ORDER BY ${orderBySql(req.query.time_field)}
          LIMIT ${EXPORT_PAGE} OFFSET ${page * EXPORT_PAGE}`,
        params
      );
      if (!pageRows.rows.length) break;
      rows.push(...(pageRows.rows as Array<Record<string, unknown>>));
      if (pageRows.rows.length < EXPORT_PAGE) break outer;
    }

    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    // ⚠️ 分页取回来的行是 unknown 记录，statusLabel 需要结构化字段 → 这里显式收窄类型
    interface ExportRow {
      order_sn: string; provider: string; biz_channel: string | null; biz_category: string | null;
      pay_price: number; commission: number; platform_status: string; fulfill_status: string;
      refund_status: string; fulfillment?: string | null;
      goods_title: string | null; created_at: string; paid_at: string | null; settled_at: string | null;
      platform_updated_at: string | null; site_code: string; buyer_nickname: string | null; buyer_id: number | null;
    }
    const fmt = (v: unknown) => (v ? esc(new Date(v as string).toLocaleString('zh-CN')) : '""');
    // 三个时间都导出（2026-10-04）：下单/完成/上游状态更新，别再合成一个「创建时间」
    const lines = ['订单号,渠道,业务类型,站点,商品,实付,佣金,状态,用户,下单时间,完成时间,状态更新时间'];
    for (const raw of rows) {
      const r = raw as unknown as ExportRow;
      lines.push([
        esc(r.order_sn), esc(r.biz_channel ?? r.provider), esc(r.biz_category ?? orderType(r.provider)),
        esc(r.site_code), esc(r.goods_title),
        esc(r.pay_price), esc(r.commission), esc(statusLabel(r)),
        esc(r.buyer_nickname
          ? `${String(r.buyer_nickname).slice(0, 1)}**`
          : r.buyer_id ? `用户#${r.buyer_id}` : '未归因'),
        fmt(r.paid_at ?? r.created_at), fmt(r.settled_at), fmt(r.platform_updated_at),
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.send('\ufeff' + lines.join('\n'));
  } catch (e) { next(e); }
});
