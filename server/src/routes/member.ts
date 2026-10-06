/**
 * M5 权益会员 C 端（画布 14 会员等级 / 15 元宝明细 / 12 兑换记录 / 19 券包）。
 * 挂载于 /api/me/member/*，requireUser（clogin 签发的 C 端 JWT）。
 * 口径（§3/决策#21）：元宝 1 元 = 100 元宝；唯一消耗 = 兑换会员等级（只升不降）；
 * 兑换记录 = order 表蚂蚁系 provider（mayixingqiu/recharge/movie/dc，只读，积分消耗发生在蚂蚁侧不落库）。
 * 42P18 铁律：SQL 参数全部引用；varchar 列一律 String() 传参；UPDATE/DELETE 的 WHERE/SET 显式 cast。
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireUser } from '../middleware/auth.js';
import { INGOT_PER_YUAN } from '../lib/constants.js';

export const memberRouter = Router();

memberRouter.use(requireUser);

// provider 分类单一真相源在 lib/constants.ts（D先生 2026-10-04 与蚂蚁 pf_type 对齐后统一维护）
import { INGOT_PROVIDERS_SQL as INGOT_PROVIDERS } from '../lib/constants.js';

/** 元宝流水类型 → 列表标题（画布 15） */
const TX_LABEL: Record<string, string> = {
  ORDER_REBATE: '购物返元宝',
  INVITE_REWARD: '邀请奖励',
  CHECKIN_REWARD: '签到奖励',
  LEVEL_EXCHANGE: '兑换会员等级',
  REFUND_DEDUCT: '退款扣回',
  ADMIN_ADJUST: '系统调整',
};

/** GET /api/me/member/level → 会员等级页（画布 14）：我的元宝 + 当前等级 + 三档权益卡 */
memberRouter.get('/level', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { rows: acc } = await pool.query(
      `SELECT balance, frozen, total_earned FROM ingot_account WHERE user_id = $1::bigint LIMIT 1`,
      [userId]
    );
    const { rows: cur } = await pool.query(
      `SELECT ml.level_id, ml.code, ml.name FROM member m JOIN member_level ml ON ml.level_id = m.level_id
        WHERE m.user_id = $1::bigint LIMIT 1`,
      [userId]
    );
    const { rows: levels } = await pool.query(
      `SELECT level_id, code, name, sort, ingot_price, self_rate, direct_rate, team_rate, "desc"
         FROM member_level WHERE status = 'active' ORDER BY sort`
    );
    const balance = Number(acc[0]?.balance ?? 0);
    const curSort = cur[0] ? Number(levels.find((l) => l.level_id === cur[0].level_id)?.sort ?? 0) : 0;
    res.json({
      ok: true,
      data: {
        balance,
        frozen: Number(acc[0]?.frozen ?? 0),
        total_earned: Number(acc[0]?.total_earned ?? 0),
        ingot_per_yuan: INGOT_PER_YUAN,
        current: cur[0] ? { code: cur[0].code, name: cur[0].name } : null,
        levels: levels.map((l) => {
          const price = Number(l.ingot_price);
          const sort = Number(l.sort);
          const isCurrent = cur[0]?.level_id === l.level_id;
          const canBuy = sort > curSort && price > 0;
          return {
            code: l.code,
            name: l.name,
            sort,
            ingot_price: price,
            self_rate: Number(l.self_rate),
            direct_rate: Number(l.direct_rate),
            team_rate: Number(l.team_rate),
            desc: l.desc,
            is_current: isCurrent,
            // 可兑换（更高等级且非 0 价）；不可兑时前端展示灰按钮 + 差额
            exchangeable: canBuy && balance >= price,
            lack: canBuy ? Math.max(price - balance, 0) : 0,
          };
        }),
      },
    });
  } catch (e) { next(e); }
});

/** POST /api/me/member/level/exchange {code} → 元宝兑换等级（CTE 原子扣减 + member 升级，只升不降） */
memberRouter.post('/level/exchange', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    if (!/^L[1-9]$/.test(code)) throw new HttpError(400, '等级码非法', 'BAD_LEVEL');

    const { rows: target } = await pool.query(
      `SELECT level_id, code, name, sort, ingot_price FROM member_level
        WHERE code = $1::text AND status = 'active' LIMIT 1`,
      [code]
    );
    const lv = target[0];
    if (!lv) throw new HttpError(404, '等级不存在', 'LEVEL_NOT_FOUND');
    if (Number(lv.ingot_price) <= 0) throw new HttpError(400, '该等级无需兑换', 'FREE_LEVEL');

    // 当前等级校验（只升不降）
    const { rows: curRows } = await pool.query(
      `SELECT ml.sort, ml.code FROM member m JOIN member_level ml ON ml.level_id = m.level_id
        WHERE m.user_id = $1::bigint LIMIT 1`,
      [userId]
    );
    if (curRows[0]) {
      if (curRows[0].code === code) throw new HttpError(409, '当前已是该等级', 'ALREADY_LEVEL');
      if (Number(curRows[0].sort) >= Number(lv.sort)) throw new HttpError(409, '等级只升不降', 'LEVEL_DOWNGRADE');
    }

    // 原子兑换：余额足额才扣减；LEVEL_EXCHANGE ref_id = level_code（varchar 列 → String 传参不适用，此处是字面码）
    const price = Number(lv.ingot_price);
    const { rows: paid } = await pool.query(
      `WITH upd AS (
         UPDATE ingot_account SET balance = balance - $2::int, updated_at = now()
          WHERE user_id = $1::bigint AND balance >= $2::int
         RETURNING balance
       ), tx AS (
         INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
         SELECT $1::bigint, 'LEVEL_EXCHANGE', $3::text, -$2::int, (SELECT balance FROM upd), '兑换' || $4::text
         WHERE EXISTS (SELECT 1 FROM upd)
         RETURNING tx_id
       ), mem AS (
         INSERT INTO member (user_id, level_id, level_exchanged_at)
         SELECT $1::bigint, $5::int, now() WHERE EXISTS (SELECT 1 FROM upd)
         ON CONFLICT (user_id) DO UPDATE SET level_id = $5::int, level_exchanged_at = now()
         RETURNING user_id
       )
       SELECT (SELECT balance FROM upd) AS balance_after, (SELECT tx_id FROM tx) AS tx_id FROM mem`,
      [userId, price, String(lv.code), String(lv.name), Number(lv.level_id)]
    );
    if (!paid[0]) throw new HttpError(400, '元宝不足，邀请好友可赚元宝', 'INSUFFICIENT_INGOT');

    // balance_after 回填（与 ordersync/bindInviter 同款：拆独立语句）
    await pool.query(
      `UPDATE ingot_tx SET balance_after = COALESCE((SELECT balance FROM ingot_account WHERE user_id = $1::bigint), 0)
        WHERE tx_id = $2::bigint`,
      [userId, Number(paid[0].tx_id)]
    );
    res.json({ ok: true, data: { code: lv.code, name: lv.name, cost: price, balance_after: Number(paid[0].balance_after) } });
  } catch (e) { next(e); }
});

/** GET /api/me/member/ingot/summary → 元宝明细头卡（画布 15）：余额 + 本月获取/消耗 + 累计获取 */
memberRouter.get('/ingot/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { rows } = await pool.query(
      `SELECT COALESCE((SELECT balance FROM ingot_account WHERE user_id = $1::bigint LIMIT 1), 0) AS balance,
              COALESCE((SELECT frozen FROM ingot_account WHERE user_id = $1::bigint LIMIT 1), 0) AS frozen,
              COALESCE((SELECT total_earned FROM ingot_account WHERE user_id = $1::bigint LIMIT 1), 0) AS total_earned,
              COALESCE((SELECT SUM(amount) FROM ingot_tx WHERE user_id = $1::bigint AND amount > 0
                         AND created_at >= date_trunc('month', now())), 0)::int AS month_earned,
              COALESCE((SELECT -SUM(amount) FROM ingot_tx WHERE user_id = $1::bigint AND amount < 0
                         AND created_at >= date_trunc('month', now())), 0)::int AS month_spent`,
      [userId]
    );
    const r = rows[0];
    res.json({
      ok: true,
      data: {
        balance: Number(r.balance),
        frozen: Number(r.frozen),
        total_earned: Number(r.total_earned),
        month_earned: Number(r.month_earned),
        month_spent: Number(r.month_spent),
        ingot_per_yuan: INGOT_PER_YUAN,
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/me/member/ingot/flows?filter=all|earn|spend&page&size → 元宝流水（画布 15 列表） */
memberRouter.get('/ingot/flows', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const filter = String(req.query.filter ?? 'all');
    if (!['all', 'earn', 'spend'].includes(filter)) throw new HttpError(400, 'filter 不合法', 'BAD_PARAM');
    const size = Math.min(Math.max(Number(req.query.size) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);

    const conds: string[] = [`t.user_id = $1::bigint`];
    if (filter === 'earn') conds.push(`t.amount > 0`);
    if (filter === 'spend') conds.push(`t.amount < 0`);

    const { rows } = await pool.query(
      `SELECT t.tx_id, t.type, t.amount, t.balance_after, t.remark, t.created_at,
              o.provider AS order_provider, o.goods_snapshot->>'title' AS goods_title,
              o.pay_price::float AS pay_price
         FROM ingot_tx t
         LEFT JOIN "order" o ON o.id::text = t.ref_id AND t.type IN ('ORDER_REBATE','REFUND_DEDUCT')
        WHERE ${conds.join(' AND ')}
        ORDER BY t.tx_id DESC
        LIMIT $2::int OFFSET $3::int`,
      [userId, size, (page - 1) * size]
    );
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ingot_tx t WHERE ${conds.join(' AND ')}`,
      [userId]
    );
    res.json({
      ok: true,
      data: {
        total: Number(cnt[0].total),
        page,
        size,
        items: rows.map((r) => ({
          tx_id: Number(r.tx_id),
          type: r.type,
          title: TX_LABEL[String(r.type)] ?? '元宝变动',
          source: r.type === 'ORDER_REBATE'
            ? (r.order_provider === 'self' ? '自营订单' : 'CPS订单')
            : null,
          detail: r.goods_title ?? r.remark ?? '',
          pay_price: r.pay_price != null ? Number(r.pay_price) : null,
          amount: Number(r.amount),
          balance_after: Number(r.balance_after),
          created_at: r.created_at,
        })),
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/me/member/exchange-records?tab=all|pending|done|refund → 兑换记录（画布 12，蚂蚁系订单只读） */
memberRouter.get('/exchange-records', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const tab = String(req.query.tab ?? 'all');
    if (!['all', 'pending', 'done', 'refund'].includes(tab)) throw new HttpError(400, 'tab 不合法', 'BAD_PARAM');
    const size = Math.min(Math.max(Number(req.query.size) || 20, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);

    // 状态口径与 admin orders.ts 一致：售后 > 履约 > 平台侧
    let tabSql = '';
    if (tab === 'refund') tabSql = ` AND o.refund_status <> 'none'`;
    else if (tab === 'done') tabSql = ` AND o.refund_status = 'none' AND o.fulfill_status IN ('delivered','verified')`;
    else if (tab === 'pending') tabSql = ` AND o.refund_status = 'none' AND o.fulfill_status NOT IN ('delivered','verified')`;

    const { rows } = await pool.query(
      `SELECT o.id, o.order_sn, o.provider, o.platform_status, o.fulfill_status, o.refund_status,
              o.goods_snapshot->>'title' AS goods_title, o.pay_price::float AS pay_price, o.created_at
         FROM "order" o
        WHERE o.buyer_id = $1::bigint
          AND o.provider = ANY(string_to_array($2::text, ','))${tabSql}
        ORDER BY o.created_at DESC
        LIMIT $3::int OFFSET $4::int`,
      [userId, INGOT_PROVIDERS, size, (page - 1) * size]
    );
    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM "order" o
        WHERE o.buyer_id = $1::bigint AND o.provider = ANY(string_to_array($2::text, ','))`,
      [userId, INGOT_PROVIDERS]
    );
    res.json({
      ok: true,
      data: {
        total: Number(cnt[0].total),
        page,
        size,
        items: rows.map((r) => ({
          id: Number(r.id),
          order_sn: r.order_sn,
          provider: r.provider,
          title: r.goods_title ?? '权益兑换',
          pay_price: Number(r.pay_price ?? 0),
          status: r.refund_status === 'applying' ? 'refunding'
            : r.refund_status === 'refunded' ? 'refunded'
            : r.refund_status === 'partial' ? 'refunded'
            : ['delivered', 'verified'].includes(String(r.fulfill_status)) ? 'done' : 'pending',
          status_label: r.refund_status === 'applying' ? '退款审核中'
            : r.refund_status !== 'none' ? '已退款'
            : ['delivered', 'verified'].includes(String(r.fulfill_status)) ? '已到账' : '充值中',
          created_at: r.created_at,
        })),
      },
    });
  } catch (e) { next(e); }
});

/** 券是否可领（与 receive 的 SQL 条件同源，避免两处漂移） */
const RECEIVABLE = `c.site_id = $2::uuid AND c.status = 'active'
   AND (c.valid_from IS NULL OR c.valid_from <= now())
   AND (c.valid_to IS NULL OR c.valid_to > now())
   AND c.issued < c.total`;

/** GET /api/me/member/coupons/available?amount= → 可用于本金额的自营券（确认订单页选券用）
 *  scope='self' 且门槛 ≤ amount，按抵扣额降序；用户未领过的也返回（标 can_receive，券条点击走 receive） */
memberRouter.get('/coupons/available', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const amount = Math.max(0, Number(req.query.amount ?? 0) || 0);
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.type, c.amount::float AS amount, c.threshold::float AS threshold,
              c.valid_to, c.issued, c.total,
              (SELECT uc.id FROM user_coupon uc
                WHERE uc.user_id = $1::bigint AND uc.coupon_id = c.id AND uc.status = 'unused'
                  AND (uc.expire_at IS NULL OR uc.expire_at > now()) LIMIT 1) AS my_user_coupon_id,
              (SELECT uc.id FROM user_coupon uc WHERE uc.user_id = $1::bigint AND uc.coupon_id = c.id LIMIT 1) AS any_user_coupon_id
         FROM coupon c
        WHERE ${RECEIVABLE}
          AND c.scope = 'self'
          AND c.threshold <= $3::numeric
        ORDER BY (CASE c.type WHEN 'cash_off' THEN c.amount ELSE c.threshold * (1 - c.amount / 10) END) DESC`,
      [userId, siteId, amount]
    );
    res.json({
      ok: true,
      data: {
        items: rows.map((r) => ({
          coupon_id: Number(r.id),
          user_coupon_id: r.my_user_coupon_id ? Number(r.my_user_coupon_id) : null,
          name: r.name,
          type: r.type,
          amount: Number(r.amount),
          threshold: Number(r.threshold),
          valid_to: r.valid_to,
          received: !!r.any_user_coupon_id,
          usable: !!r.my_user_coupon_id,
        })),
      },
    });
  } catch (e) { next(e); }
});

/** POST /api/me/member/coupons/:couponId/receive → 领取营销券（档 C）
 *  单语句 CTE 原子：条件 UPDATE coupon.issued+1（校验状态/有效期/库存）→ 成功才 INSERT user_coupon。
 *  幂等：一人一券（uniq_user_coupon 索引），重复领返回已有券而非报错。 */
memberRouter.post('/coupons/:couponId/receive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const couponId = Number(req.params.couponId);
    if (!Number.isInteger(couponId) || couponId <= 0) throw new HttpError(400, '券 ID 不合法', 'BAD_PARAM');

    // 领取前快照校验（错误文案要精确：停用/未开始/已结束/抢完）
    const { rows: cks } = await pool.query(
      `SELECT c.status, c.valid_from, c.valid_to, c.issued, c.total, c.name
         FROM coupon c WHERE c.id = $1::bigint AND c.site_id = $2::uuid LIMIT 1`,
      [couponId, siteId]
    );
    const c = cks[0];
    if (!c) throw new HttpError(404, '券不存在', 'COUPON_NOT_FOUND');
    if (c.status !== 'active') throw new HttpError(409, '券已停用', 'COUPON_DISABLED');
    if (c.valid_from && new Date(c.valid_from).getTime() > Date.now()) throw new HttpError(409, '领取尚未开始', 'COUPON_NOT_STARTED');
    if (c.valid_to && new Date(c.valid_to).getTime() < Date.now()) throw new HttpError(409, '券已结束', 'COUPON_ENDED');
    if (Number(c.issued) >= Number(c.total)) throw new HttpError(409, '券已被领完', 'COUPON_SOLD_OUT');

    // 原子领取：条件 UPDATE（库存守卫）→ RETURNING 才 INSERT
    const { rows: got } = await pool.query(
      `WITH bump AS (
         UPDATE coupon SET issued = issued + 1
          WHERE id = $1::bigint AND site_id = $3::uuid AND status = 'active'
            AND (valid_from IS NULL OR valid_from <= now())
            AND (valid_to IS NULL OR valid_to > now())
            AND issued < total
          RETURNING id, valid_to
       ), ins AS (
         INSERT INTO user_coupon (user_id, coupon_id, status, received_at, expire_at)
         SELECT $2::bigint, bump.id, 'unused', now(), bump.valid_to FROM bump
         ON CONFLICT (user_id, coupon_id) DO NOTHING
         RETURNING id, status
       )
       SELECT (SELECT count(*)::int FROM bump) AS bumped,
              (SELECT count(*)::int FROM ins) AS inserted,
              (SELECT id FROM ins) AS user_coupon_id`,
      [couponId, userId, siteId]
    );
    const r = got[0];
    if (!r.bumped) throw new HttpError(409, '券已被领完', 'COUPON_SOLD_OUT');

    // 已领过（索引冲突）→ 回退本次 issued 增量并返回原券，保持幂等
    if (!r.inserted) {
      await pool.query(`UPDATE coupon SET issued = GREATEST(issued - 1, 0) WHERE id = $1::bigint`, [couponId]);
      const { rows: old } = await pool.query(
        `SELECT id FROM user_coupon WHERE user_id = $1::bigint AND coupon_id = $2::bigint LIMIT 1`,
        [userId, couponId]
      );
      res.json({ ok: true, data: { already: true, user_coupon_id: Number(old[0]?.id ?? 0), name: c.name } });
      return;
    }
    res.json({ ok: true, data: { already: false, user_coupon_id: Number(r.user_coupon_id), name: c.name } });
  } catch (e) { next(e); }
});

/** GET /api/me/member/coupons?tab=unused|used|expired → 我的券包（画布 19；未过期但 valid_to 已过 → 已过期） */
memberRouter.get('/coupons', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const tab = String(req.query.tab ?? 'unused');
    if (!['unused', 'used', 'expired'].includes(tab)) throw new HttpError(400, 'tab 不合法', 'BAD_PARAM');

    const { rows } = await pool.query(
      `SELECT uc.id, uc.status, uc.received_at, uc.used_order_id, uc.expire_at,
              c.id AS coupon_id, c.name, c.type, c.scope, c.amount::float AS amount,
              c.threshold::float AS threshold, c.valid_from, c.valid_to
         FROM user_coupon uc JOIN coupon c ON c.id = uc.coupon_id
        WHERE uc.user_id = $1::bigint
        ORDER BY uc.received_at DESC`,
      [userId]
    );
    const now = Date.now();
    const items = rows.map((r) => {
      // 有效期取领取快照（uc.expire_at），老数据无快照时回退券主表 valid_to
      const exp = r.expire_at ?? r.valid_to;
      const expired = r.status === 'expired' || (r.status === 'unused' && exp && new Date(exp).getTime() < now);
      const eff = r.status === 'used' ? 'used' : expired ? 'expired' : 'unused';
      return {
        id: Number(r.id), // user_coupon.id = 下单抵扣传入的 user_coupon_id
        coupon_id: Number(r.coupon_id),
        name: r.name,
        type: r.type, // cash_off / discount / exchange
        scope: r.scope, // self / rights
        amount: Number(r.amount),
        threshold: Number(r.threshold),
        valid_to: exp,
        received_at: r.received_at,
        used_order_id: r.used_order_id ? Number(r.used_order_id) : null,
        status: eff,
      };
    });
    const filtered = items.filter((i) => i.status === tab);
    res.json({
      ok: true,
      data: {
        counts: {
          unused: items.filter((i) => i.status === 'unused').length,
          used: items.filter((i) => i.status === 'used').length,
          expired: items.filter((i) => i.status === 'expired').length,
        },
        items: filtered,
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/me/member/overview → 我的页头卡（画布 06）：余额/元宝/优惠券数 + 等级 + 用户信息，一次请求 */
memberRouter.get('/overview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const { rows } = await pool.query(
      `SELECT u.user_id, u.nickname, u.avatar, u.invite_code,
         COALESCE((SELECT commission_balance FROM promoter WHERE user_id = u.user_id LIMIT 1), 0) AS balance,
         COALESCE((SELECT balance FROM ingot_account WHERE user_id = u.user_id LIMIT 1), 0)::int AS ingot,
         (SELECT COUNT(*)::int FROM user_coupon uc JOIN coupon c ON c.id = uc.coupon_id
            WHERE uc.user_id = u.user_id AND uc.status = 'unused'
              AND (c.valid_to IS NULL OR c.valid_to > now())) AS coupons,
         ml.code AS level_code, ml.name AS level_name
       FROM "user" u
       LEFT JOIN member m ON m.user_id = u.user_id
       LEFT JOIN member_level ml ON ml.level_id = m.level_id
       WHERE u.user_id = $1::bigint LIMIT 1`,
      [userId]
    );
    if (!rows[0]) throw new HttpError(404, '用户不存在', 'USER_NOT_FOUND');
    const r = rows[0];
    res.json({
      ok: true,
      data: {
        user_id: Number(r.user_id),
        nickname: r.nickname || '微信用户',
        avatar: r.avatar || '',
        invite_code: r.invite_code || '', // 我的页展示，后台新增核销员凭此邀请码
        balance: Number(r.balance),
        ingot: Number(r.ingot),
        coupons: Number(r.coupons),
        level_code: r.level_code || 'L1',
        level_name: r.level_name || '注册会员',
      },
    });
  } catch (e) { next(e); }
});
