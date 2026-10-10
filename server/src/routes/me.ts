/**
 * M4 分销 C 端（决策链：M4·分销）：佣金钱包 / 提现 / 邀请推广。
 * 挂载于 /api/me/*，requireUser（clogin 签发的 C 端 JWT）。
 * 余额口径：promoter.commission_balance（结算 +，冲销 -，提现申请原子扣减）。
 * 佣金与元宝相互独立（§3 货币定稿）：佣金=现金可提现，元宝仅兑换等级。
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireUser, optionalUser } from '../middleware/auth.js';
import { INVITE_REWARD_INGOT } from '../lib/constants.js';
import { bindInviter } from './auth.js';
import { settleRebateOnVerify } from './trade.js';
import { refund as wxpayRefund, resolvePayConfig } from '../lib/wxpay.js';

export const meRouter = Router();

// token 解析（clogin JWT → req.user）；不挂 optionalUser 则 requireUser 永远 401
meRouter.use(optionalUser);

/** 提现规则（2026-10-10 微信审核钦定口径：**无提现门槛 + 即时到账**，D先生 指令）
 *  ⛔ MIN_WITHDRAW 门槛已废除（两次拒审主因）；单笔上限保留（风控限额，非门槛）。 */
const MAX_WITHDRAW_PER = 5000;
const CHANNELS = ['wx_wallet'] as const;

/**
 * POST /api/me/bind-invite {invite} → 已登录用户补绑邀请关系（点分享链接进来但 token 已存在的场景）。
 * 绑定规则与登录时一致（bindInviter：parent_id IS NULL 原子抢占 + 邀请人发元宝）。
 */
meRouter.post('/bind-invite', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invite = String(req.body?.invite ?? '').trim();
    if (!invite) throw new HttpError(400, '缺少邀请码', 'BAD_REQUEST');
    const { rows: self } = await pool.query(
      `SELECT site_id::text AS sid FROM "user" WHERE user_id = $1::bigint LIMIT 1`,
      [req.user!.userId]
    );
    if (!self[0]) throw new HttpError(404, '用户不存在', 'USER_NOT_FOUND');
    const bound = await bindInviter(self[0].sid, req.user!.userId, invite);
    res.json({ ok: true, data: { bound } });
  } catch (e) { next(e); }
});

/** GET /api/me/commission/summary → 钱包头卡四数 */
meRouter.get('/commission/summary', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { rows } = await pool.query(
      `SELECT
         COALESCE((SELECT commission_balance FROM promoter WHERE user_id = $1::bigint LIMIT 1), 0) AS balance,
         COALESCE((SELECT SUM(amount) FROM commission_flow WHERE user_id = $1::bigint AND status IN ('available','withdrawn')), 0) AS total,
         COALESCE((SELECT SUM(amount) FROM commission_flow WHERE user_id = $1::bigint AND status = 'estimated'), 0) AS pending,
         COALESCE((SELECT SUM(amount) FROM commission_flow WHERE user_id = $1::bigint AND status = 'available' AND created_at >= date_trunc('day', now())), 0) AS today,
         COALESCE((SELECT SUM(amount) FROM withdraw WHERE user_id = $1::bigint AND status IN ('pending','approved')), 0) AS withdrawing,
         COALESCE((SELECT SUM(amount) FROM withdraw WHERE user_id = $1::bigint AND status = 'paid'), 0) AS withdrawn`,
      [userId]
    );
    const r = rows[0];
    // 会员等级横幅（L2 返利会员 · 自购40% · 直推10%）
    const { rows: lv } = await pool.query(
      `SELECT ml.level_id, ml.name, ml.self_rate, ml.direct_rate
         FROM member m JOIN member_level ml ON ml.level_id = m.level_id
        WHERE m.user_id = $1::bigint LIMIT 1`,
      [userId]
    );
    res.json({
      ok: true,
      data: {
        balance: Number(r.balance),
        total: Number(r.total),
        pending: Number(r.pending),
        today: Number(r.today),
        withdrawing: Number(r.withdrawing),
        withdrawn: Number(r.withdrawn),
        level: lv[0]
          ? { level_id: Number(lv[0].level_id), name: lv[0].name, self_rate: Number(lv[0].self_rate), direct_rate: Number(lv[0].direct_rate) }
          : null,
        min_withdraw: 0, // 2026-10-10 无门槛口径（字段保留兼容旧客户端）
        max_withdraw_per: MAX_WITHDRAW_PER,
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/me/commission/flows?page&size → 佣金+提现混合流水（画布 23 列表） */
meRouter.get('/commission/flows', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const size = Math.min(Math.max(Number(req.query.size) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * size;
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT cf.id, 'commission' AS kind, cf.amount, cf.level, cf.status,
                o.order_sn, o.provider, o.pay_price,
                cf.created_at AS at
           FROM commission_flow cf LEFT JOIN "order" o ON o.id = cf.order_id
          WHERE cf.user_id = $1::bigint AND cf.status <> 'invalid'
         UNION ALL
         SELECT w.id + 1000000000, 'withdraw' AS kind, -w.amount, NULL AS level, w.status,
                NULL AS order_sn, w.channel AS provider, NULL AS pay_price,
                w.created_at AS at
           FROM withdraw w WHERE w.user_id = $1::bigint AND w.status <> 'failed'
       ) t
       ORDER BY at DESC
       LIMIT $2::int OFFSET $3::int`,
      [userId, size, offset]
    );
    const { rows: cnt } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM commission_flow WHERE user_id = $1::bigint AND status <> 'invalid')
            + (SELECT COUNT(*) FROM withdraw WHERE user_id = $1::bigint AND status <> 'failed') AS total`,
      [userId]
    );
    const LEVEL_LABEL = { 1: '自购佣金', 2: '直推佣金', 3: '间推佣金' } as Record<number, string>;
    res.json({
      ok: true,
      data: {
        total: Number(cnt[0].total),
        page,
        size,
        items: rows.map((r) => ({
          id: Number(r.id),
          kind: r.kind,
          amount: Number(r.amount),
          // 佣金流水：类型+来源摘要（画布「自购佣金 · 自营订单」）；提现流水：提现到零钱·状态
          title: r.kind === 'withdraw' ? '提现到零钱' : LEVEL_LABEL[Number(r.level)] ?? '佣金',
          status: r.status,
          // available/paid → 已到账；estimated/pending/approved → 待结算/处理中
          settled: ['available', 'paid'].includes(String(r.status)),
          status_label: r.kind === 'withdraw'
            ? ({ pending: '审核中', approved: '待打款', paid: '成功', rejected: '已驳回' } as Record<string, string>)[String(r.status)] ?? String(r.status)
            : ({ available: '已到账', withdrawn: '已到账', estimated: '待结算' } as Record<string, string>)[String(r.status)] ?? String(r.status),
          detail: r.kind === 'withdraw'
            ? `¥${Math.abs(Number(r.amount)).toFixed(2)} ${String(r.status) === 'paid' ? '已到微信零钱' : '处理中'}`
            : `${r.order_sn ?? ''} ${r.provider ?? ''} 实付¥${Number(r.pay_price ?? 0).toFixed(2)}`.trim(),
          created_at: r.at,
        })),
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/me/withdraw/list?page&size → 我的提现记录（提现页历史） */
meRouter.get('/withdraw/list', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const size = Math.min(Math.max(Number(req.query.size) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const { rows } = await pool.query(
      `SELECT id, amount, channel, status, reject_reason, created_at, paid_at
         FROM withdraw WHERE user_id = $1::bigint ORDER BY created_at DESC
        LIMIT $2::int OFFSET $3::int`,
      [userId, size, (page - 1) * size]
    );
    res.json({
      ok: true,
      data: {
        items: rows.map((r) => ({
          id: Number(r.id),
          amount: Number(r.amount),
          channel: r.channel,
          channel_label: r.channel === 'wx_wallet' ? '微信零钱' : r.channel,
          status: r.status,
          reject_reason: r.reject_reason,
          created_at: r.created_at,
          paid_at: r.paid_at,
        })),
      },
    });
  } catch (e) { next(e); }
});

/** POST /api/me/withdraw {amount, channel} → 提现申请（CTE 原子扣减余额，防超提/并发） */
meRouter.post('/withdraw', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const amount = Math.round(Number(req.body?.amount) * 100) / 100;
    const channel = String(req.body?.channel ?? 'wx_wallet');
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, '提现金额非法', 'BAD_AMOUNT');
    // ⛔ 最低提现门槛已废除（2026-10-10 微信审核钦定：无门槛 + 即时到账）；仅保留单笔上限（风控限额）
    if (amount > MAX_WITHDRAW_PER) throw new HttpError(400, `单笔限额 ¥${MAX_WITHDRAW_PER}`, 'OVER_MAX');
    if (!(CHANNELS as readonly string[]).includes(channel)) throw new HttpError(400, '提现方式暂仅支持微信零钱', 'BAD_CHANNEL');

    // 原子申请：余额足额才扣减并落单（42P18 铁律：参数全引用）
    // ⛔ 即时到账口径（D先生 2026-10-10）：申请即置 paid（无人工审核环节）。
    //    ⚠️ 真实微信商家转账通道接通前，paid = 记账式打款；通道上线后此处切换为
    //    「落单 pending → 调转账 → 微信回调置 paid」，届时需对已 paid 存量补打款对账。
    const { rows } = await pool.query(
      `WITH upd AS (
         UPDATE promoter SET commission_balance = commission_balance - $2::numeric
          WHERE user_id = $1::bigint AND commission_balance >= $2::numeric
         RETURNING 1
       ), ins AS (
         INSERT INTO withdraw (user_id, amount, channel, status, audit_at, paid_at)
         SELECT $1::bigint, $2::numeric, $3::text, 'paid', now(), now() WHERE EXISTS (SELECT 1 FROM upd)
         RETURNING id
       )
       SELECT id FROM ins`,
      [userId, amount, channel]
    );
    if (!rows[0]) throw new HttpError(400, '可提现余额不足', 'INSUFFICIENT_BALANCE');
    res.json({ ok: true, data: { id: Number(rows[0].id), status: 'paid', amount } });
  } catch (e) { next(e); }
});

/** GET /api/me/invite → 邀请推广页数据（画布 25：邀请码+累计邀请/佣金） */
meRouter.get('/invite', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { rows } = await pool.query(
      `SELECT u.invite_code, u.nickname,
              (SELECT COUNT(*)::int FROM "user" c WHERE c.parent_id = u.user_id) AS invited,
              COALESCE((SELECT SUM(amount) FROM commission_flow WHERE user_id = u.user_id AND status IN ('available','withdrawn')), 0) AS commission_total,
              COALESCE((SELECT SUM(amount) FROM ingot_tx WHERE user_id = u.user_id AND type = 'INVITE_REWARD'), 0)::int AS ingot_total,
              (SELECT COUNT(*)::int FROM promoter WHERE user_id = u.user_id) AS is_promoter
         FROM "user" u WHERE u.user_id = $1::bigint LIMIT 1`,
      [userId]
    );
    if (!rows[0]) throw new HttpError(404, '用户不存在', 'USER_NOT_FOUND');
    res.json({
      ok: true,
      data: {
        invite_code: rows[0].invite_code,
        nickname: rows[0].nickname,
        invited: Number(rows[0].invited),
        commission_total: Number(rows[0].commission_total),
        ingot_total: Number(rows[0].ingot_total), // INVITE_REWARD 累计发放（邀请绑定流程实时到账）
        bonus_per_invite: INVITE_REWARD_INGOT,
      },
    });
  } catch (e) { next(e); }
});

/**
 * GET /api/me/orders?tab=all|pending|paid|completed|refund → C 端我的订单（画布 06「我的订单」卡 + 订单 tab）。
 * tab 口径（2026-09-29 定稿）：pending=待付款(created) / paid=已付款(paid 未交付) / completed=已完成(settled 或已交付核销) / refund=退款售后(refund<>'none')。
 * 返回 badges 四计数供 mine 卡角标。
 */
const ORDER_TABS: Record<string, string> = {
  pending: `o.platform_status = 'created'`,
  // 已付款 = 已支付未核销（自营 settled=支付即产券，未核销前仍属已付款；2026-09-29 定稿：核销才完成）
  paid: `o.platform_status = 'paid'
         OR (o.provider = 'self' AND o.platform_status = 'settled' AND o.fulfill_status NOT IN ('delivered','verified'))`,
  completed: `(o.fulfill_status IN ('delivered','verified') OR (o.platform_status = 'settled' AND (o.provider IS NULL OR o.provider <> 'self')))`,
  refund: `o.refund_status <> 'none'`,
};

function cOrderStatus(o: { platform_status: string; fulfill_status: string; refund_status: string; fulfillment?: string | null; provider?: string | null }): string {
  if (o.refund_status === 'applying') return '退款审核中';
  if (o.refund_status === 'refunded') return '已退款';
  if (o.refund_status === 'partial') return '部分退款';
  if (o.platform_status === 'created') return '待付款';
  if (o.platform_status === 'closed') return '已关闭';
  if (o.fulfill_status === 'delivered' || o.fulfill_status === 'verified') return '已完成';
  // 自营到店团购：settled（支付产券）未核销前仍是「已付款」；核销（verified）才已完成（2026-09-29 定稿）
  if (o.provider === 'self' && o.platform_status === 'settled' && o.fulfill_status !== 'verified') return '已付款';
  if (o.platform_status === 'settled') return '已返利';
  if (o.platform_status === 'paid') return '已付款';
  return '处理中';
}

meRouter.get('/orders', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const tab = String(req.query.tab ?? 'all');
    const where = ORDER_TABS[tab] ?? 'TRUE';
    const { rows: badgeRows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE platform_status = 'created')::int AS pending,
         COUNT(*) FILTER (WHERE platform_status = 'paid'
            OR (provider = 'self' AND platform_status = 'settled' AND fulfill_status NOT IN ('delivered','verified')))::int AS paid,
         COUNT(*) FILTER (WHERE fulfill_status IN ('delivered','verified')
            OR (platform_status = 'settled' AND (provider IS NULL OR provider <> 'self')))::int AS completed,
         COUNT(*) FILTER (WHERE refund_status <> 'none')::int AS refund
       FROM "order" WHERE buyer_id = $1::bigint AND site_id = $2::uuid`,
      [userId, siteId]
    );
    const list = await pool.query(
      `SELECT o.id, o.order_sn, o.provider, o.pay_price, o.platform_status, o.fulfill_status, o.refund_status, o.fulfillment,
              o.goods_snapshot->>'title' AS title, o.goods_snapshot->>'pic' AS pic, o.created_at,
              o.promoter_id, o.paid_at, o.settled_at, o.commission,
              CASE WHEN o.promoter_id = o.buyer_id THEN
                ROUND(o.commission * COALESCE((SELECT ml.self_rate FROM member m JOIN member_level ml ON ml.level_id = m.level_id WHERE m.user_id = o.buyer_id LIMIT 1), 0), 2)
              ELSE 0 END::float AS est_rebate
       FROM "order" o
       WHERE o.buyer_id = $1::bigint AND o.site_id = $2::uuid AND ${where}
       ORDER BY o.created_at DESC LIMIT 50`,
      [userId, siteId]
    );
    res.json({
      ok: true,
      data: {
        badges: badgeRows[0],
        items: list.rows.map((o) => ({
          id: Number(o.id),
          order_sn: o.order_sn,
          provider: o.provider,
          pay_price: Number(o.pay_price),
          title: o.title || '商品订单',
          pic: o.pic || '',
          status: cOrderStatus(o),
          platform_status: o.platform_status, // 端上判定「取消订单」入口（仅 created 态自营单）
          created_at: o.created_at,
          est_rebate: Number(o.est_rebate ?? 0), // 自购单预估返利（commission×受益人当前 self_rate）
          is_self_buy: o.promoter_id !== null && Number(o.promoter_id) === userId,
          fulfillment: o.fulfillment ?? 'group', // 自营恒到店团购（2026-09-29 需求更正）
          verify_coupon: o.verify_coupon ?? null,
        })),
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/me/orders/:id → 订单详情（画布 10）：状态横幅/跟单进度/商品/自购返利明细/订单信息 */
meRouter.get('/orders/:id', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '订单 ID 不合法', 'BAD_PARAM');
    const { rows } = await pool.query(
      `SELECT o.id, o.order_sn, o.provider_order_sn, o.provider, o.platform, o.pay_price, o.commission,
              o.platform_status, o.fulfill_status, o.refund_status, o.fulfillment,
              o.goods_snapshot->>'title' AS title, o.goods_snapshot->>'pic' AS pic,
              o.promoter_id, o.created_at, o.paid_at, o.settled_at, o.sku_snapshot,
              CASE WHEN o.promoter_id = o.buyer_id THEN
                ROUND(o.commission * COALESCE((SELECT ml.self_rate FROM member m JOIN member_level ml ON ml.level_id = m.level_id WHERE m.user_id = o.buyer_id LIMIT 1), 0), 2)
              ELSE 0 END::float AS est_rebate,
              COALESCE((SELECT ml.self_rate FROM member m JOIN member_level ml ON ml.level_id = m.level_id WHERE m.user_id = o.buyer_id LIMIT 1), 0)::float AS self_rate,
              (SELECT json_build_object('code', gc.code, 'total_times', gc.total_times, 'used_times', gc.used_times,
                                        'status', gc.status, 'expire_at', gc.expire_at)
                 FROM group_coupon gc WHERE gc.order_id = o.id LIMIT 1) AS verify_coupon
       FROM "order" o
       WHERE o.id = $1::bigint AND o.buyer_id = $2::bigint AND o.site_id = $3::uuid LIMIT 1`,
      [id, userId, siteId]
    );
    if (!rows[0]) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND');
    const o = rows[0];
    res.json({
      ok: true,
      data: {
        id: Number(o.id),
        order_sn: o.order_sn,
        provider: o.provider,
        provider_order_sn: o.provider_order_sn,
        pay_price: Number(o.pay_price),
        title: o.title || '商品订单',
        pic: o.pic || '',
        status: cOrderStatus(o),
        platform_status: o.platform_status, // 原始平台状态（E2E/端上细分用）
        est_rebate: Number(o.est_rebate ?? 0),
        self_rate: Number(o.self_rate ?? 0),
        is_self_buy: o.promoter_id !== null && Number(o.promoter_id) === userId,
        fulfillment: o.fulfillment ?? 'group', // 自营恒到店团购（2026-09-29 需求更正）
        verify_coupon: o.verify_coupon ?? null,
        sku_snapshot: o.sku_snapshot ?? null,
        timeline: {
          submitted_at: o.created_at,   // 提交订单
          confirmed_at: o.paid_at,      // 平台确认（上游付款同步）
          rebated_at: o.settled_at,     // 返利到账（结算）
        },
        created_at: o.created_at,
      },
    });
  } catch (e) { next(e); }
});

/* ============================================================
 * 核销员扫码核销闭环（决策 #25④ 核销员=C 端 user）
 * agent-status：我的页宫格显隐；lookup：扫码后查券；confirm：事务核销一次。
 * 站点隔离：核销员只能核销自己站点（verify_agent.site_id）的券。
 * ============================================================ */

/** GET /api/me/verify/agent-status → 当前用户在所属站点的核销员身份 */
meRouter.get('/verify/agent-status', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const { rows } = await pool.query(
      `SELECT role, status FROM verify_agent WHERE site_id = $1::uuid AND user_id = $2::bigint LIMIT 1`,
      [siteId, userId],
    );
    const a = rows[0];
    if (!a || a.status !== 'active') return res.json({ ok: true, data: { is_agent: false } });
    const { rows: t } = await pool.query(
      `SELECT COUNT(*)::int AS today FROM verify_log WHERE verifier_user_id = $1::bigint AND result = 'success'
        AND verified_at >= date_trunc('day', now())`,
      [userId],
    );
    res.json({ ok: true, data: { is_agent: true, role: a.role, today_count: t[0]?.today ?? 0 } });
  } catch (e) { next(e); }
});

/** GET /api/me/verify/lookup?code= → 扫码后查券（本站点核销员限定） */
meRouter.get('/verify/lookup', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const code = String(req.query.code ?? '').trim().toUpperCase();
    if (!code) throw new HttpError(400, '缺少券码', 'BAD_REQUEST');

    const { rows: ag } = await pool.query(
      `SELECT 1 FROM verify_agent WHERE site_id = $1::uuid AND user_id = $2::bigint AND status = 'active' LIMIT 1`,
      [siteId, userId],
    );
    if (!ag[0]) throw new HttpError(403, '非本站点核销员', 'NOT_AGENT');

    const { rows } = await pool.query(
      `SELECT gc.coupon_id, gc.code, gc.total_times, gc.used_times, gc.status, gc.expire_at, gc.order_id,
              o.goods_snapshot->>'title' AS goods_title, o.goods_snapshot->>'pic' AS pic,
              o.sku_snapshot->>'spec' AS spec, o.pay_price::float AS pay_price, o.order_sn
         FROM group_coupon gc JOIN "order" o ON o.id = gc.order_id
        WHERE gc.code = $1::varchar AND o.site_id = $2::uuid LIMIT 1`,
      [code, siteId],
    );
    if (!rows[0]) throw new HttpError(404, '券不存在或不属于本站点', 'COUPON_NOT_FOUND');
    const c = rows[0];
    const expired = c.expire_at ? new Date(c.expire_at).getTime() < Date.now() : false;
    res.json({
      ok: true,
      data: {
        code: c.code,
        goods_title: c.goods_title ?? '商品',
        pic: c.pic ?? '',
        spec: c.spec ?? '',
        pay_price: Number(c.pay_price ?? 0),
        order_sn: c.order_sn,
        total_times: c.total_times,
        used_times: c.used_times,
        remain_times: Math.max(0, Number(c.total_times) - Number(c.used_times)),
        status: expired && c.status !== 'used' ? 'expired' : c.status,
        expire_at: c.expire_at,
        verifiable: !expired && c.status !== 'used' && Number(c.used_times) < Number(c.total_times),
      },
    });
  } catch (e) { next(e); }
});

/** POST /api/me/verify/confirm {code} → 核销一次。
 * 网关模式无跨语句事务 → 用单语句原子条件 UPDATE（status<>used AND used_times<total AND 未过期）
 * 保证防超额/防过期；每次成功 UPDATE 严格对应一条 verify_log（双击=两次合法核销）。
 */
meRouter.post('/verify/confirm', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    if (!code) throw new HttpError(400, '缺少券码', 'BAD_REQUEST');

    const { rows: ag } = await pool.query(
      `SELECT 1 FROM verify_agent WHERE site_id = $1::uuid AND user_id = $2::bigint AND status = 'active' LIMIT 1`,
      [siteId, userId],
    );
    if (!ag[0]) throw new HttpError(403, '非本站点核销员', 'NOT_AGENT');

    // 原子核销一次：条件不满足（过期/用尽）时 0 行返回
    const { rows: up } = await pool.query(
      `UPDATE group_coupon gc
         SET used_times = gc.used_times + 1,
             status = CASE WHEN gc.used_times + 1 >= gc.total_times THEN 'used' ELSE 'partial' END
        FROM "order" o
        WHERE gc.order_id = o.id AND gc.code = $1::varchar AND o.site_id = $2::uuid
          AND gc.status <> 'used' AND gc.used_times < gc.total_times
          AND (gc.expire_at IS NULL OR gc.expire_at > now())
        RETURNING gc.coupon_id, gc.order_id, gc.used_times, gc.total_times, gc.status`,
      [code, siteId],
    );
    if (!up[0]) {
      // 区分失败原因给诚实文案
      const { rows: c } = await pool.query(
        `SELECT gc.status, gc.used_times, gc.total_times, gc.expire_at FROM group_coupon gc JOIN "order" o ON o.id = gc.order_id
          WHERE gc.code = $1::varchar AND o.site_id = $2::uuid LIMIT 1`,
        [code, siteId],
      );
      if (!c[0]) throw new HttpError(404, '券不存在或不属于本站点', 'COUPON_NOT_FOUND');
      const expired = c[0].expire_at ? new Date(c[0].expire_at).getTime() < Date.now() : false;
      if (expired) throw new HttpError(409, '券已过期，不能核销', 'COUPON_EXPIRED');
      if (c[0].status === 'used' || Number(c[0].used_times) >= Number(c[0].total_times)) {
        throw new HttpError(409, '券已全部核销', 'COUPON_USED');
      }
      throw new HttpError(409, '核销失败，请重试', 'VERIFY_CONFLICT');
    }
    const g = up[0];
    await pool.query(
      `INSERT INTO verify_log (coupon_id, order_id, site_id, verifier_user_id, times, result)
       VALUES ($1::bigint, $2::bigint, $3::uuid, $4::bigint, 1, 'success')`,
      [g.coupon_id, g.order_id, siteId, userId],
    );
    // 全部核销完 → 订单履约完成
    if (g.status === 'used') {
      await pool.query(`UPDATE "order" SET fulfill_status = 'verified' WHERE id = $1::bigint AND fulfill_status <> 'verified'`, [g.order_id]);
    }
    // 返利在核销时触发（2026-09-29 定稿）：首次成功核销即结算（幂等，settled_at 原子抢占）
    try {
      await settleRebateOnVerify(Number(g.order_id));
    } catch (e) {
      console.error('[verify] settleRebateOnVerify failed', g.order_id, e);
    }
    res.json({ ok: true, data: { code, used_times: Number(g.used_times), total_times: Number(g.total_times), status: g.status } });
  } catch (e) { next(e); }
});

/** POST /api/me/verify/refund {code} → 核销员对未核销订单发起全额退款（2026-09-29：核销员有退款权限）。
 * 约束：本站点核销员 + provider='self' + 券未核销（used_times=0）+ 未退款 + 已支付；
 * 微信 V3 退款（受理成功即关单作废券，最终到账以微信侧为准）；未核销时返利未发放，无需冲销。
 */
meRouter.post('/verify/refund', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    if (!code) throw new HttpError(400, '缺少券码', 'BAD_REQUEST');

    const { rows: ag } = await pool.query(
      `SELECT 1 FROM verify_agent WHERE site_id = $1::uuid AND user_id = $2::bigint AND status = 'active' LIMIT 1`,
      [siteId, userId],
    );
    if (!ag[0]) throw new HttpError(403, '非本站点核销员', 'NOT_AGENT');

    const { rows } = await pool.query(
      `SELECT gc.coupon_id, gc.used_times, o.id AS order_id, o.order_sn, o.pay_price::float AS pay_price,
              o.platform_status, o.refund_status, o.provider, o.coupon_id AS user_coupon_id
         FROM group_coupon gc JOIN "order" o ON o.id = gc.order_id
        WHERE gc.code = $1::varchar AND o.site_id = $2::uuid LIMIT 1`,
      [code, siteId],
    );
    const c = rows[0];
    if (!c) throw new HttpError(404, '券不存在或不属于本站点', 'COUPON_NOT_FOUND');
    if (c.provider !== 'self') throw new HttpError(400, '仅自营到店团购订单支持退款', 'NOT_SELF');
    if (c.refund_status !== 'none') throw new HttpError(409, '订单已退款或退款处理中', 'ALREADY_REFUNDED');
    if (!['paid', 'settled'].includes(String(c.platform_status))) throw new HttpError(409, '订单状态不可退款', 'BAD_ORDER_STATE');
    if (Number(c.used_times) > 0) throw new HttpError(409, '券已核销，不能退款', 'COUPON_USED');

    const cfg = await resolvePayConfig(siteId);
    const fen = Math.round(Number(c.pay_price) * 100);
    if (fen <= 0) throw new HttpError(400, '订单金额异常', 'BAD_AMOUNT');
    await wxpayRefund({
      cfg,
      outTradeNo: String(c.order_sn),
      outRefundNo: `RF${c.order_id}`,
      totalFen: fen,
      refundFen: fen,
      reason: '到店团购订单退款（核销员发起）',
    });

    // 原子关单（refund_status='none' 条件防并发双退）+ 作废券
    const { rows: closed } = await pool.query(
      `UPDATE "order" SET refund_status = 'refunded', platform_status = 'closed'
        WHERE id = $1::bigint AND refund_status = 'none' RETURNING id`,
      [c.order_id],
    );
    if (closed[0]) {
      await pool.query(`UPDATE group_coupon SET status = 'used' WHERE coupon_id = $1::bigint`, [c.coupon_id]);
      // 退券（档 C）：营销券退回用户（used → unused，清订单关联）；退库存不涉及（已核销=已消费）
      if (c.user_coupon_id) {
        await pool.query(
          `UPDATE user_coupon SET status = 'unused', used_order_id = NULL
            WHERE id = $1::bigint AND status = 'used' AND used_order_id = $2::bigint`,
          [c.user_coupon_id, c.order_id],
        );
      }
      await pool.query(
        `INSERT INTO verify_log (coupon_id, order_id, site_id, verifier_user_id, times, result)
         VALUES ($1::bigint, $2::bigint, $3::uuid, $4::bigint, 0, 'refund')`,
        [c.coupon_id, c.order_id, siteId, userId],
      );
    }
    res.json({ ok: true, data: { order_sn: c.order_sn, refund_amount: Number(c.pay_price), coupon_refunded: !!c.user_coupon_id } });
  } catch (e) { next(e); }
});
