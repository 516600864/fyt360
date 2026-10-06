// 数据看板聚合（admin-29 重构版）：净收益口径
//
// ⛔ 口径铁律（决策 #38，D先生 2026-10-04 拍板）：
//   净收益 = 毛收入 − 现金支出
//   CPS/直充的**成交额不经我手**（钱在蚂蚁星球侧结算，我方只拿佣金/返佣），
//   所以 GMV 永不进收益，只能用 commission。成交额另开一条**灰行**仅作流量参考。
//
//   毛收入 = CPS佣金(含直充返佣) + 到店团购毛利
//     · CPS佣金 = SUM(commission) WHERE provider <> 'self'（直充=recharge 是 CPS 的一种形态，不单列）
//     · 团购毛利 = self收款 − self成本快照 − self佣金 − self手续费
//   现金支出 = 分销佣金 + 用户提现 + 支付手续费 + 自营退款
//     · 元宝发放**不在此列**（元宝非现金，铁律；只作负债率参考）
//
// ⛔⛔ 退款口径（2026-10-04 D先生拍板，修正上一版"按订单金额计支出"的错账）：
//   **CPS / 直充退款的钱从未进过我们的账户**（钱在蚂蚁星球侧结算，我方只拿佣金），
//   拿它当现金支出等于凭空扣钱。正确处理只有一条：
//     ① 退款单的**佣金不计毛收入**（净收益自然回落，这就是全部影响）
//     ② 退款**不进现金支出**，支出账房里不出现「退款」这一行
//   只有**自营单**退款才是真金白银流出（我们实收过微信支付）→ 才计支出。
//   实测：全库 590 单 refunded 全部为 CPS，自营退款 0 单，chargeback_at 恒空。
//
//   ⛔ 自营单也有 commission，已在「团购毛利」里扣除，绝不在 CPS佣金 里再收一次（防双扣）。
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';

export const dashboardRouter = Router();

/** 站点过滤（与 orders.ts 同口径）：平台超管=全站点；站点角色=权限白名单 */
async function resolveSiteScope(admin: AdminJwtPayload, code: string): Promise<string[]> {
  const isPlatform = admin.role === 'platform_admin';
  if (code) {
    const { rows } = await pool.query(`SELECT site_id::text AS id FROM site WHERE code = $1 LIMIT 1`, [code]);
    if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    assertSiteAccess(admin, String(rows[0].id));
    return [String(rows[0].id)];
  }
  if (isPlatform) {
    const { rows } = await pool.query(`SELECT site_id::text AS id FROM site`);
    return rows.map((r) => String(r.id));
  }
  if (!admin.siteIds.length) throw new HttpError(403, '无站点权限', 'SITE_FORBIDDEN');
  return admin.siteIds;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RANGES = new Set(['today', 'yesterday', '7d', '30d', 'custom']);
const MAX_CUSTOM_DAYS = 92;

/** 本地日期 → YYYY-MM-DD（不能用 toISOString，那是 UTC，会差 8 小时） */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/**
 * 时间区间 → [from, to) 半开区间。
 * ⛔ 口径固定 paid_at（下单时间，决策 #42）。结算/状态更新时间是另外两种口径，
 *    混用会让「今日净收益」含义漂移，这里不提供切换。
 */
function resolveRange(q: Record<string, unknown>): { from: string; to: string; days: number; key: string } {
  const key = String(q.range ?? 'today');
  if (!RANGES.has(key)) throw new HttpError(400, '时间区间不合法', 'BAD_RANGE');
  const today = ymd(new Date());
  if (key === 'custom') {
    const from = String(q.from ?? '');
    const to = String(q.to ?? '');
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      throw new HttpError(400, '自定义区间须传 from/to（YYYY-MM-DD）', 'BAD_RANGE');
    }
    if (from > to) throw new HttpError(400, '开始日期不得晚于结束日期', 'BAD_RANGE');
    const days = Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000) + 1;
    if (days > MAX_CUSTOM_DAYS) throw new HttpError(400, `自定义区间最长 ${MAX_CUSTOM_DAYS} 天`, 'BAD_RANGE');
    return { from, to: shiftDays(to, 1), days, key };
  }
  if (key === 'today') return { from: today, to: shiftDays(today, 1), days: 1, key };
  if (key === 'yesterday') return { from: shiftDays(today, -1), to: today, days: 1, key };
  if (key === '7d') return { from: shiftDays(today, -6), to: shiftDays(today, 1), days: 7, key };
  return { from: shiftDays(today, -29), to: shiftDays(today, 1), days: 30, key };
}

/**
 * 自营单判定。
 * ⛔ 刻意**不带表别名前缀**（旧版写成 `o.provider = 'self'`）：
 *    一旦某段 SQL 用了别的别名（o2/o3），插进去就直接
 *    `missing FROM-clause entry for table "o"` 500。纯表达式任何别名下都成立。
 */
const SELF = `provider = 'self'`;

/**
 * 未退款单过滤（退款口径铁律，见文件头注释）。
 * ⛔ 同样**不带表别名前缀**，与 SELF 同理；refund_status 可能为 NULL，用 COALESCE 兜成 'none'。
 * ⛔ 只在"算收入"的聚合里用；commission_flow / withdraw 的子查询不套这个
 *    （钱一旦打出去就是既成事实，与订单后续是否退款无关）。
 */
const NOT_REFUNDED = `COALESCE(refund_status, 'none') <> 'refunded'`;

/**
 * GET /api/admin/dashboard/summary?site=&range=today|yesterday|7d|30d|custom&from=&to=
 */
dashboardRouter.get('/summary', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? ''));
    const ph = sites.map((_, i) => `$${i + 1}`).join(',');
    const rg = resolveRange(req.query as Record<string, unknown>);
    // 上一个等长区间（环比基准）
    const pf = shiftDays(rg.from, -rg.days);
    const pt = shiftDays(rg.to, -rg.days);

    // 区间端点全部走绑定参数（$n+1 起），杜绝拼接
    //
    // ⛔⛔ CloudBase PG 网关铁律（2026-10-04 踩坑，排查 40 分钟）：
    //    **parameters 数组长度必须与 SQL 里 $n 占位符个数严格一致，多一个或少一个整条 SQL 直接失败**
    //    （报 DATABASE_EXEC_ERROR / 42883，不告诉你是哪个参数，很容易误判成 SQL 语法错）。
    //    所以每条查询都必须传「自己那份」参数，不能图省事共用一个统一数组。
    //    下面 5 组参数的差异就在于每条 SQL 用了哪几个占位符。
    const n = sites.length;
    const F = `$${n + 1}`;
    const T = `$${n + 2}`;
    const PF = `$${n + 3}`;
    const PT = `$${n + 4}`;
    const pCur = [...sites, rg.from, rg.to];               // 用到 $1..F,$T
    const pCurPrev = [...sites, rg.from, rg.to, pf, pt];   // 用到 $1..F,$T,$PF,$PT

    // ── 1. 毛收入账房 + 成交额灰行（当前区间 & 环比区间一次取回）──
    //    ⛔ 所有收入聚合统一 FILTER 掉 refunded：退款单佣金不计收入（决策 #38 补充口径）
    const { rows: revRows } = await pool.query(
      `SELECT
         COALESCE(SUM(o.commission) FILTER (WHERE NOT (${SELF}) AND ${NOT_REFUNDED}), 0)::float AS cps_cur,
         COALESCE(SUM(o.commission) FILTER (WHERE NOT (${SELF}) AND ${NOT_REFUNDED} AND o.paid_at >= ${PF} AND o.paid_at < ${PT}), 0)::float AS cps_prev,
         COALESCE(SUM(o.pay_price) FILTER (WHERE NOT (${SELF}) AND ${NOT_REFUNDED}), 0)::float AS gmv_cps_cur,
         COALESCE(SUM(o.pay_price) FILTER (WHERE NOT (${SELF}) AND ${NOT_REFUNDED} AND o.paid_at >= ${PF} AND o.paid_at < ${PT}), 0)::float AS gmv_cps_prev,
         COALESCE(SUM(o.pay_price) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED}), 0)::float AS self_cur,
         COALESCE(SUM(o.pay_price) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED} AND o.paid_at >= ${PF} AND o.paid_at < ${PT}), 0)::float AS self_prev,
         COALESCE(SUM(o.commission) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED}), 0)::float AS self_comm_cur,
         COALESCE(SUM(o.commission) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED} AND o.paid_at >= ${PF} AND o.paid_at < ${PT}), 0)::float AS self_comm_prev,
         COALESCE(SUM(o.cost_amount) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED}), 0)::float AS self_cost_cur,
         COALESCE(SUM(o.cost_amount) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED} AND o.paid_at >= ${PF} AND o.paid_at < ${PT}), 0)::float AS self_cost_prev,
         COUNT(*) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED})::int AS self_cnt,
         COUNT(*) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED} AND o.cost_amount IS NULL)::int AS self_cost_missing       FROM "order" o
       WHERE o.site_id::text IN (${ph}) AND o.paid_at >= ${F} AND o.paid_at < ${T}`,
      pCurPrev,
    );
    const rev = revRows[0] ?? {};

    // ── 2. 支付手续费：仅自营有真实微信支付流水（CPS 钱不经我手）。
    //       费率取站点配置 site_payment.commission_rate，**不写死 0.6%**。
    //       ⛔ 手续费只在区间内有实收时才查；跨多站点时用 IN 展开，不要塞进 ARRAY[]::text[]
    //          （$n 展开进数组字面量会触发 uuid = text 类型错误）。
    const { rows: feeRows } = await pool.query(
      `SELECT COALESCE(sp.commission_rate, 0)::float AS rate,
              COALESCE((
                SELECT SUM(o2.pay_price) FROM "order" o2
                 WHERE o2.site_id::text IN (${ph}) AND o2.provider = 'self'
                   AND o2.payment_no IS NOT NULL AND o2.payment_no <> ''
                   AND o2.paid_at >= ${F} AND o2.paid_at < ${T}
              ), 0)::float AS self_paid_gmv
         FROM (SELECT 1) x
         LEFT JOIN site_payment sp ON sp.site_id IN (SELECT site_id FROM site WHERE site_id::text IN (${ph}))
        GROUP BY sp.commission_rate`,
      pCur,
    );
    const feeRate = Number(feeRows[0]?.rate ?? 0) || 0;
    const selfPaidGmv = num(feeRows[0]?.self_paid_gmv);
    const selfFeeCur = selfPaidGmv * feeRate;

    // ── 3. 现金支出：分销佣金（commission_flow 三级明细）+ 用户提现（withdraw 已打款）──
    const { rows: expRows } = await pool.query(
      `SELECT
         COALESCE((SELECT SUM(cf.amount) FROM commission_flow cf JOIN "order" o3 ON o3.id = cf.order_id
                    WHERE o3.site_id::text IN (${ph}) AND o3.paid_at >= ${F} AND o3.paid_at < ${T}), 0)::float AS comm_dist,
         COALESCE((SELECT SUM(cf.amount) FROM commission_flow cf JOIN "order" o3 ON o3.id = cf.order_id
                    WHERE o3.site_id::text IN (${ph}) AND o3.paid_at >= ${F} AND o3.paid_at < ${T} AND cf.level = 1), 0)::float AS comm_l1,
         COALESCE((SELECT SUM(cf.amount) FROM commission_flow cf JOIN "order" o3 ON o3.id = cf.order_id
                    WHERE o3.site_id::text IN (${ph}) AND o3.paid_at >= ${F} AND o3.paid_at < ${T} AND cf.level = 2), 0)::float AS comm_l2,
         COALESCE((SELECT SUM(cf.amount) FROM commission_flow cf JOIN "order" o3 ON o3.id = cf.order_id
                    WHERE o3.site_id::text IN (${ph}) AND o3.paid_at >= ${F} AND o3.paid_at < ${T} AND cf.level = 3), 0)::float AS comm_l3,
         COALESCE((SELECT SUM(cf.amount) FROM commission_flow cf JOIN "order" o3 ON o3.id = cf.order_id
                    WHERE o3.site_id::text IN (${ph}) AND o3.paid_at >= ${PF} AND o3.paid_at < ${PT}), 0)::float AS comm_dist_prev,
         COALESCE((SELECT SUM(w.amount) FROM withdraw w JOIN "user" u ON u.user_id = w.user_id
                    WHERE u.site_id::text IN (${ph}) AND w.status = 'paid'
                      AND COALESCE(w.paid_at, w.created_at) >= ${F}::timestamptz
                      AND COALESCE(w.paid_at, w.created_at) < ${T}::timestamptz), 0)::float AS withdraw_out,
         COALESCE((SELECT SUM(w.amount) FROM withdraw w JOIN "user" u ON u.user_id = w.user_id
                    WHERE u.site_id::text IN (${ph}) AND w.status = 'paid'
                      AND COALESCE(w.paid_at, w.created_at) >= ${PF}::timestamptz
                      AND COALESCE(w.paid_at, w.created_at) < ${PT}::timestamptz), 0)::float AS withdraw_prev,
         (SELECT COUNT(*) FROM commission_flow)::int AS comm_flow_rows,
         (SELECT COUNT(*) FROM withdraw)::int AS withdraw_rows`,
      pCurPrev,
    );
    const ex = expRows[0] ?? {};

    // 退款：⛔ 只有**自营单**退款才是我方真实资金流出（我们实收过微信支付）；
    //    CPS / 直充退款的钱从未进过我方账户（钱在蚂蚁星球侧结算），**不进支出**，
    //    它对净收益的唯一影响是"该单佣金不计毛收入"（已在第 1 段 NOT_REFUNDED 落实）。
    const { rows: refundRows } = await pool.query(
      `SELECT
         COALESCE(SUM(o.pay_price) FILTER (WHERE o.refund_status = 'refunded' AND ${SELF}), 0)::float AS refund_cur,
         COALESCE(SUM(o.pay_price) FILTER (WHERE o.refund_status = 'refunded' AND ${SELF}
              AND o.paid_at >= ${PF} AND o.paid_at < ${PT}), 0)::float AS refund_prev,
         COUNT(*) FILTER (WHERE o.refund_status = 'refunded' AND ${SELF})::int AS refund_cnt,
         -- 只作信息展示：被排除在支出外的 CPS 退款（金额 / 单数），让口径可自证
         COUNT(*) FILTER (WHERE o.refund_status = 'refunded' AND NOT (${SELF}))::int AS cps_refund_cnt
       FROM "order" o
       WHERE o.site_id::text IN (${ph}) AND o.paid_at >= ${F} AND o.paid_at < ${T}`,
      pCurPrev,
    );
    const rf = refundRows[0] ?? {};

    // ── 4. KPI：单量 / 已结算（rebate_at 有值）/ 待结算 / 买家数 ──
    //    ⛔ 同样剔掉 refunded：退款单佣金不计收入（否则 KPI 与毛收入两套口径）
    const { rows: kpiRows } = await pool.query(
      `SELECT
         COUNT(*)::int AS orders_cur,
         COUNT(*) FILTER (WHERE o.paid_at >= ${PF} AND o.paid_at < ${PT})::int AS orders_prev,
         COUNT(*) FILTER (WHERE o.rebate_at IS NOT NULL AND ${NOT_REFUNDED})::int AS settled_cnt,
         COUNT(*) FILTER (WHERE o.rebate_at IS NULL AND ${NOT_REFUNDED})::int AS unsettled_cnt,
         COALESCE(SUM(o.commission) FILTER (WHERE o.rebate_at IS NOT NULL AND ${NOT_REFUNDED}), 0)::float AS settled_comm,
         COALESCE(SUM(o.commission) FILTER (WHERE o.rebate_at IS NULL AND ${NOT_REFUNDED}), 0)::float AS unsettled_comm,
         COUNT(DISTINCT o.buyer_id)::int AS buyers
       FROM "order" o
       WHERE o.site_id::text IN (${ph}) AND o.paid_at >= ${F} AND o.paid_at < ${T}`,
      pCurPrev,
    );
    const k = kpiRows[0] ?? {};

    // ── 5. 三线趋势：毛收入 / 现金支出 / 净收益（逐日补零）──
    //    手续费按站点级费率对自营收款按日摊回（费率恒定，摊回口径与总额一致）
    //    ⛔ generate_series 的两个端点必须显式 ::date；否则 PG 在 CTE 里推断不出类型 → 42P18
    //    ⛔ 无 refund 维度：CPS 退款不进支出（决策 #38 补充口径），趋势与总额必须同口径
    const { rows: trendRows } = await pool.query(
      `WITH days AS (
         SELECT generate_series(${F}::date, (${T}::date - interval '1 day')::date, interval '1 day')::date AS day
       ), agg AS (
         SELECT date_trunc('day', o.paid_at)::date AS day,
                COALESCE(SUM(o.commission) FILTER (WHERE NOT (${SELF}) AND ${NOT_REFUNDED}), 0)::float AS cps,
                COALESCE(SUM(o.pay_price) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED}), 0)::float AS self_in,
                COALESCE(SUM(o.cost_amount) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED}), 0)::float AS self_cost,
                COALESCE(SUM(o.commission) FILTER (WHERE ${SELF} AND ${NOT_REFUNDED}), 0)::float AS self_comm,
                COALESCE(SUM(o.pay_price) FILTER (WHERE ${SELF} AND o.refund_status = 'refunded'), 0)::float AS self_refund
           FROM "order" o
          WHERE o.site_id::text IN (${ph}) AND o.paid_at >= ${F} AND o.paid_at < ${T}
          GROUP BY 1
       )
       SELECT to_char(d.day, 'MM-DD') AS label,
              COALESCE(a.cps, 0)::float AS cps,
              COALESCE(a.self_in, 0)::float AS self_in,
              COALESCE(a.self_cost, 0)::float AS self_cost,
              COALESCE(a.self_comm, 0)::float AS self_comm,
              COALESCE(a.self_refund, 0)::float AS self_refund
         FROM days d LEFT JOIN agg a ON a.day = d.day
        ORDER BY d.day`,
      pCur,
    );
    const trend = trendRows.map((r) => {
      const selfIn = num(r.self_in);
      const fee = selfIn * feeRate;
      const gross = num(r.cps) + selfIn - num(r.self_cost) - num(r.self_comm) - fee;
      const out = num(r.self_refund) + fee;
      return { label: String(r.label), gross: round2(gross), expense: round2(out), net: round2(gross - out) };
    });

    // ── 6. 毛收入来源占比（按业务线，只统计 CPS 佣金部分）──
    const { rows: sourceRows } = await pool.query(
      `SELECT COALESCE(o.biz_category, 'other') AS cat, COALESCE(SUM(o.commission), 0)::float AS gross
         FROM "order" o
        WHERE o.site_id::text IN (${ph}) AND o.paid_at >= ${F} AND o.paid_at < ${T}
          AND NOT (${SELF}) AND ${NOT_REFUNDED}
        GROUP BY 1 ORDER BY gross DESC`,
      pCur,
    );

    // ── 7. 元宝负债（只作参考，绝不进支出）──
    const { rows: ingotRows } = await pool.query(
      `SELECT COALESCE(SUM(a.balance), 0)::int AS balance,
              COALESCE(SUM(a.total_earned), 0)::int AS total_earned,
              COALESCE((SELECT SUM(amount) FROM ingot_tx WHERE type = 'ORDER_REBATE'
                         AND created_at >= ${F}::timestamptz AND created_at < ${T}::timestamptz), 0)::int AS issued
         FROM ingot_account a JOIN "user" u ON u.user_id = a.user_id
        WHERE u.site_id::text IN (${ph})`,
      pCur,
    );
    const ing = ingotRows[0] ?? {};

    // ── 8. 最近订单（三时间口径与订单中心一致，决策 #40）──
    const { rows: orderRows } = await pool.query(
      `SELECT o.order_sn, o.provider, o.pay_price::float AS pay_price, o.commission::float AS commission,
              o.cost_amount::float AS cost_amount,
              o.platform_status, o.refund_status, o.fulfill_status,
              o.paid_at, o.settled_at, o.platform_updated_at,
              COALESCE(o.goods_snapshot->>'title', o.goods_snapshot->>'goods_name', o.goods_snapshot->>'name', '') AS title,
              s.name AS site_name
         FROM "order" o JOIN site s ON s.site_id = o.site_id
        WHERE o.site_id::text IN (${ph})
        ORDER BY COALESCE(o.paid_at, o.created_at) DESC LIMIT 6`,
      sites,
    );

    // ── 汇总计算 ──
    const cpsComm = num(rev.cps_cur);
    const selfComm = num(rev.self_comm_cur);
    const selfReceipt = num(rev.self_cur);
    const selfCost = num(rev.self_cost_cur);
    const selfProfit = round2(selfReceipt - selfCost - selfComm - selfFeeCur);
    const grossIncome = round2(cpsComm + selfProfit);

    const prevCps = num(rev.cps_prev);
    const prevSelfProfit = round2(num(rev.self_prev) - num(rev.self_cost_prev) - num(rev.self_comm_prev) - selfFeeCur);
    const prevGross = round2(prevCps + prevSelfProfit);

    const distComm = num(ex.comm_dist);
    const withdrawOut = num(ex.withdraw_out);
    const refundOut = num(rf.refund_cur);
    const cashExpense = round2(distComm + withdrawOut + selfFeeCur + refundOut);
    const prevCashExpense = round2(num(ex.comm_dist_prev) + num(ex.withdraw_prev) + selfFeeCur + num(rf.refund_prev));

    const netIncome = round2(grossIncome - cashExpense);
    const prevNet = round2(prevGross - prevCashExpense);

    res.json({
      ok: true,
      data: {
        sites_count: sites.length,
        range: { key: rg.key, from: rg.from, to: rg.to, days: rg.days, prev_from: pf, prev_to: pt },
        headline: {
          net_income: netIncome,
          net_delta: pct(netIncome, prevNet),
          gross_income: grossIncome,
          gross_delta: pct(grossIncome, prevGross),
          cash_expense: cashExpense,
          expense_delta: pct(cashExpense, prevCashExpense),
          margin_rate: grossIncome > 0 ? round2((netIncome / grossIncome) * 100) : null,
        },
        gross: {
          items: [
            {
              key: 'cps_commission',
              label: 'CPS 佣金（含直充返佣）',
              amount: round2(cpsComm),
              desc: '京东 / 淘宝 / 拼多多 / 美团 / 饿了么 / 唯品会 / 点餐 / 电影票 / 权益直充',
              share: grossIncome > 0 ? round2((cpsComm / grossIncome) * 100) : 0,
              ready: true,
            },
            {
              key: 'self_goods',
              label: '到店团购毛利',
              amount: selfProfit,
              desc: '收款 − 成本 − 佣金 − 手续费',
              share: grossIncome > 0 ? round2((selfProfit / grossIncome) * 100) : 0,
              // 成本未快照的自营单 → 毛利口径不完整，UI 必须提示
              ready: num(rev.self_cost_missing) === 0,
              cost_missing: Number(rev.self_cost_missing ?? 0),
              receipt: round2(selfReceipt),
              cost: round2(selfCost),
              commission: round2(selfComm),
              fee: round2(selfFeeCur),
              orders: Number(rev.self_cnt ?? 0),
            },
          ],
          total: grossIncome,
        },
        expense: {
          items: [
            {
              key: 'dist_commission',
              label: '分销佣金',
              amount: round2(distComm),
              desc: '自购 40% / 直推 10% / 间推 5%',
              share: cashExpense > 0 ? round2((distComm / cashExpense) * 100) : 0,
              ready: Number(ex.comm_flow_rows ?? 0) > 0,
              levels: [
                { label: '自购 40%', amount: round2(num(ex.comm_l1)) },
                { label: '直推 10%', amount: round2(num(ex.comm_l2)) },
                { label: '间推 5%', amount: round2(num(ex.comm_l3)) },
              ],
            },
            {
              key: 'withdraw',
              label: '用户提现',
              amount: round2(withdrawOut),
              desc: '提现审核通过 · 已打款',
              share: cashExpense > 0 ? round2((withdrawOut / cashExpense) * 100) : 0,
              ready: Number(ex.withdraw_rows ?? 0) > 0,
            },
            {
              key: 'pay_fee',
              label: '支付手续费',
              amount: round2(selfFeeCur),
              desc: `微信支付 · 按站点配置费率 ${(feeRate * 100).toFixed(2)}% · 仅自营实收`,
              share: cashExpense > 0 ? round2((selfFeeCur / cashExpense) * 100) : 0,
              ready: selfPaidGmv > 0,
            },
            {
              key: 'refund',
              label: '自营退款',
              amount: round2(refundOut),
              desc: '仅自营到店团购退款（实收过的钱退回）；CPS / 直充退款不经我手，不计支出',
              share: cashExpense > 0 ? round2((refundOut / cashExpense) * 100) : 0,
              ready: true,
              orders: Number(rf.refund_cnt ?? 0),
            },
            {
              key: 'cps_refund',
              label: '第三方退款（不计支出）',
              amount: 0,
              desc: `${Number(rf.cps_refund_cnt ?? 0)} 单 CPS 退款：退款额从未进入我方账户，只体现为该单佣金不计入毛收入`,
              share: 0,
              ready: true,
              orders: Number(rf.cps_refund_cnt ?? 0),
              excluded: true,
            },
          ],
          total: cashExpense,
          ingot_issued: Number(ing.issued ?? 0),
          note: '元宝发放不计入现金支出（元宝非现金，仅作负债率参考）；第三方平台退款不计现金支出（钱未经我方账户），仅不计该单佣金',
        },
        kpi: [
          { key: 'gross', label: '总收入', value: grossIncome, unit: '', sub: `${Number(k.orders_cur ?? 0)} 单 · 佣金口径`, delta: pct(grossIncome, prevGross) },
          { key: 'expense', label: '总支出', value: cashExpense, unit: '', sub: '现金支出（不含元宝）', delta: pct(cashExpense, prevCashExpense) },
          { key: 'settled', label: '已结算', value: Number(k.settled_cnt ?? 0), unit: '单', sub: `佣金 ¥${round2(num(k.settled_comm))}`, delta: null },
          { key: 'unsettled', label: '待结算', value: Number(k.unsettled_cnt ?? 0), unit: '单', sub: `在途佣金 ¥${round2(num(k.unsettled_comm))}`, delta: null },
        ],
        trend,
        sources: sourceRows.map((r) => ({
          key: String(r.cat),
          label: BIZ_CAT_LABEL[String(r.cat)] ?? String(r.cat),
          amount: round2(num(r.gross)),
        })),
        gmv_reference: {
          total: round2(num(rev.gmv_cps_cur) + selfReceipt),
          delta: pct(num(rev.gmv_cps_cur) + selfReceipt, num(rev.gmv_cps_prev) + num(rev.self_prev)),
          note: 'CPS 与直充的成交额全在蚂蚁星球侧结算，我方只拿佣金 / 返佣。此行仅作流量与规模参考，不可与收益混算。',
        },
        ingot: {
          balance: Number(ing.balance ?? 0),
          total_earned: Number(ing.total_earned ?? 0),
          issued: Number(ing.issued ?? 0),
          // 负债率 = 未消耗元宝折 ¥ / 区间毛收入；分母 0 时不编造比例
          liability_rate: grossIncome > 0 ? round2((Number(ing.balance ?? 0) / 100 / grossIncome) * 100) : null,
        },
        recent_orders: orderRows,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** 业务线中文名（毛收入来源占比） */
const BIZ_CAT_LABEL: Record<string, string> = {
  ecommerce: '电商返佣',
  local: '本地生活',
  dining: '点餐',
  movie: '影视票务',
  recharge: '权益直充',
  other: '其他',
};

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
/** 环比：基期为 0 且本期 >0 → null（前端显示「新增」，不显示 +∞） */
function pct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 10000) / 100;
}
