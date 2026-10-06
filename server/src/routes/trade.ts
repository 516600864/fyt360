/**
 * 自营交易链（画布 03 详情 / 16 确认订单 / 17 收银台 / 18 结果；评审稿已批准 2026-09-28）。
 * 挂载于 /api/trade/*。无购物车：一单一商品；v1 全场包邮；退款仅记录（refund_status='applying'）。
 * 结算语义与 M2.3 同构：元宝 = floor(实付×INGOT_PER_YUAN)，佣金三跳按受益人等级，基数 = 实付×站点固定毛利率。
 * mock-pay：仅当站点无启用支付凭据时可用（真实商户号配置后自动 403），供联调与真实 DB 验证。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireUser, optionalUser } from '../middleware/auth.js';
import { resolvePayConfig, jsapiPrepay, buildPayParams, decryptCallbackResource, type PayConfig } from '../lib/wxpay.js';
import { INGOT_PER_YUAN } from '../lib/constants.js';

export const tradeRouter = Router();

// token 解析前置；不挂 optionalUser 则 requireUser 永远 401（me.ts 同款坑）
tradeRouter.use(optionalUser);

/** GET /api/trade/goods/:id → 自营商品详情（仅本站点 status='on'；实时读库不缓存） */
tradeRouter.get('/goods/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '商品 ID 不合法', 'BAD_PARAM');
    const siteId = req.user?.siteId;
    if (!siteId) throw new HttpError(401, '请先进入小程序首页完成初始化', 'UNAUTHORIZED');
    const { rows } = await pool.query(
      `SELECT goods_id, title, main_imgs, detail_imgs, video_url, skus, delivery_type
         FROM self_goods WHERE goods_id = $1::bigint AND site_id = $2::uuid AND status = 'on' LIMIT 1`,
      [id, siteId],
    );
    if (!rows[0]) throw new HttpError(404, '商品不存在或已下架', 'GOODS_NOT_FOUND');
    const g = rows[0];
    const skus = (g.skus ?? []).map((s: Record<string, unknown>, i: number) => ({
      sku_id: String(s.sku_id ?? `s${i}`),
      spec: String(s.spec ?? '默认'),
      price: Number(s.price ?? 0),
      stock: Number(s.stock ?? 0),
    }));
    res.json({
      ok: true,
      data: {
        goods_id: Number(g.goods_id),
        title: g.title,
        main_imgs: g.main_imgs ?? [],
        detail_imgs: g.detail_imgs ?? [],
        video_url: g.video_url ?? '',
        delivery_type: g.delivery_type,
        skus,
        min_price: Math.min(...skus.map((s: { price: number }) => s.price).filter((p: number) => p > 0)) || 0,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** POST /api/trade/orders → 下单（原子扣库存 + 建单；body: {goods_id, sku_id, num, user_coupon_id?}）
 *  履约定稿（2026-09-29 需求更正）：自营全面移除快递发货，仅到店团购/核销模式——
 *  fulfillment 恒 'group'，不采集收货地址；支付成功后由 settleSelfOrder 产核销券
 *  （group_coupon，复用团购核销链路）。原因：插件支付与微信小程序发货信息管理冲突。
 *  券抵扣（2026-10-02 档 C）：user_coupon_id 传则校验归属/状态/有效期/门槛/自营范围 → 计算抵扣额，
 *  下单即锁券（user_coupon.status='used' + used_order_id，防超发；未支付取消走 /cancel 退回）。 */
tradeRouter.post('/orders', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const goodsId = Number(req.body?.goods_id);
    const skuId = String(req.body?.sku_id ?? '');
    const num = Math.min(5, Math.max(1, Number(req.body?.num ?? 1)));
    if (!Number.isInteger(goodsId) || goodsId <= 0) throw new HttpError(400, '商品 ID 不合法', 'BAD_PARAM');
    if (!skuId) throw new HttpError(400, '缺少 SKU', 'BAD_PARAM');

    // —— 券校验必须前置到扣库存之前（2026-10-02 修：券不合法若在扣库存之后抛错，
    //    订单未建而库存已扣 → 库存泄漏。校验只读，不改状态）——
    const rawUc = req.body?.user_coupon_id;
    const userCouponId = rawUc == null || rawUc === '' || Number(rawUc) === 0 ? 0 : Number(rawUc);
    let discount = 0;
    let lockedCoupon = null;
    if (userCouponId > 0) {
      // 粗价用于门槛预判（真实价以下方扣库存 RETURNING 的 sku 为准，此处仅作阈值校验）
      const { rows: probe } = await pool.query(
        `SELECT (e->>'price')::numeric AS price
           FROM self_goods g, jsonb_array_elements(g.skus) e
          WHERE g.goods_id = $1::bigint AND g.site_id = $2::uuid AND e->>'sku_id' = $3::text LIMIT 1`,
        [goodsId, siteId, skuId],
      );
      const probeAmount = Math.round(Number(probe[0]?.price ?? 0) * num * 100) / 100;
      const { rows: ucs } = await pool.query(
        `SELECT uc.id, uc.status, uc.expire_at, c.name, c.type, c.scope, c.site_id,
                c.amount::float AS amount, c.threshold::float AS threshold, c.valid_to
           FROM user_coupon uc JOIN coupon c ON c.id = uc.coupon_id
          WHERE uc.id = $1::bigint AND uc.user_id = $2::bigint LIMIT 1`,
        [userCouponId, userId]
      );
      const uc = ucs[0];
      if (!uc) throw new HttpError(404, '优惠券不存在', 'COUPON_NOT_FOUND');
      if (uc.site_id !== siteId) throw new HttpError(403, '券不属于本站点', 'COUPON_SITE_MISMATCH');
      if (uc.status !== 'unused') throw new HttpError(409, '券已使用或已过期', 'COUPON_USED');
      const exp = uc.expire_at ?? uc.valid_to;
      if (exp && new Date(exp).getTime() < Date.now()) throw new HttpError(409, '券已过期', 'COUPON_EXPIRED');
      if (uc.scope !== 'self') throw new HttpError(400, '该券不适用于自营商品', 'COUPON_SCOPE');
      if (probeAmount < Number(uc.threshold)) throw new HttpError(409, `未达券门槛（满 ¥${uc.threshold}）`, 'COUPON_THRESHOLD');
    }

    // 原子扣库存（JSONB 单语句：EXISTS 校验 stock>=num 才更新；单语句无并发窗口）
    const { rows: up } = await pool.query(
      `UPDATE self_goods g
         SET skus = (
           SELECT COALESCE(jsonb_agg(
             CASE WHEN e->>'sku_id' = $3::text
                  THEN jsonb_set(e, '{stock}', (((e->>'stock')::int - $4::int))::text::jsonb)
                  ELSE e END
           ), '[]'::jsonb)
           FROM jsonb_array_elements(g.skus) e
         )
        WHERE g.goods_id = $1::bigint AND g.site_id = $2::uuid AND g.status = 'on'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(g.skus) e
                       WHERE e->>'sku_id' = $3::text AND (e->>'stock')::int >= $4::int)
        RETURNING g.title, g.main_imgs, g.skus, g.delivery_type, g.cost_price`,
      [goodsId, siteId, skuId, num],
    );
    if (!up[0]) throw new HttpError(409, '库存不足或商品已下架', 'OUT_OF_STOCK');
    const sku = (up[0].skus as Record<string, unknown>[]).find((s) => String(s.sku_id ?? '') === skuId);
    const unitPrice = Number(sku?.price ?? 0);
    if (unitPrice <= 0) throw new HttpError(500, 'SKU 价格异常', 'BAD_SKU_PRICE');
    // 自营仅到店团购（2026-09-29 需求更正）：fulfillment 恒 group，地址不再采集
    const fulfillment = 'group';

    const goodsAmount = Math.round(unitPrice * num * 100) / 100;
    // 成本快照（决策#38 + 迁移 039）：**按规格取成本**，不是按商品取一个数。
    // 同一商品不同规格的商家结算成本天差地别（「1件 ¥0.01」vs「10件 ¥5.01」，
    // 用商品级单值算毛利必错且错得无声）。取价优先级：
    //   ① skus[].cost（规格级，运营应逐规格录）
    //   ② self_goods.cost_price（商品级兜底，仅为新 SKU 懒得逐个录时用）
    //   ③ 都没有 → NULL，看板标「成本待录入」，不猜。
    // 下单瞬间固化到订单：商品改价/下架后历史账房不能跟着变。
    const skuCostRaw = sku?.cost;
    const fallbackCost = up[0].cost_price === null || up[0].cost_price === undefined ? null : Number(up[0].cost_price);
    const unitCost =
      skuCostRaw === null || skuCostRaw === undefined || skuCostRaw === ''
        ? fallbackCost
        : Number(skuCostRaw);
    const costAmount = unitCost === null || !Number.isFinite(unitCost) ? null : Math.round(unitCost * num * 100) / 100;

    // —— 券抵扣正式计算（价格已确定）——
    if (userCouponId > 0) {
      // expire_at 守卫（2026-10-02）：已过期券必须真拒。
      // 之前只查 status='unused'，运营把 valid_to 改早后，用户券包里已过期的券仍能传 ID 抵扣。
      const { rows: ucs } = await pool.query(
        `SELECT uc.id, c.name, c.type, c.amount::float AS amount, uc.expire_at
           FROM user_coupon uc JOIN coupon c ON c.id = uc.coupon_id
          WHERE uc.id = $1::bigint AND uc.user_id = $2::bigint AND uc.status = 'unused' LIMIT 1`,
        [userCouponId, userId]
      );
      const uc = ucs[0];
      if (!uc) throw new HttpError(409, '优惠券状态已变化，请重新选择', 'COUPON_TAKEN');
      if (uc.expire_at && new Date(uc.expire_at).getTime() < Date.now()) {
        throw new HttpError(409, '优惠券已过期', 'COUPON_EXPIRED');
      }
      if (uc.type === 'cash_off') discount = Math.min(Number(uc.amount), goodsAmount);
      else if (uc.type === 'discount') discount = Math.round(goodsAmount * (1 - Number(uc.amount) / 10) * 100) / 100;
      else discount = goodsAmount; // exchange = 免费兑换
      discount = Math.max(0, Math.min(Math.round(discount * 100) / 100, goodsAmount));
      lockedCoupon = { id: Number(uc.id), name: String(uc.name), type: String(uc.type) };
    }

    // 微信支付不接受 0 元单：抵扣额上限留 0.01（2026-10-02）
    const payPrice = Math.max(0.01, Math.round((goodsAmount - discount) * 100) / 100);
    discount = Math.round((goodsAmount - payPrice) * 100) / 100; // 回写实际抵扣（受 0.01 下限约束）
    // 抵扣实得为 0（如 0.01 商品用 3 元券）→ 不锁券、不落 coupon_id，否则白吞用户一张券
    if (discount <= 0) {
      discount = 0;
      lockedCoupon = null;
    }
    // 微信 out_trade_no 规则 ^[0-9a-zA-Z_\-\|*]+$：用下划线分隔（冒号会被微信拒绝）
    const orderSn = `SELF_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const { rows: ins } = await pool.query(
      `INSERT INTO "order" (order_sn, site_id, provider, platform, pay_price, commission, cost_amount,
                            buyer_id, promoter_id, goods_snapshot, address_snapshot, sku_snapshot,
                            fulfillment, platform_status, fulfill_status, refund_status,
                            coupon_discount)
       VALUES ($1::varchar, $2::uuid, 'self', 'mini', $3::numeric, 0, $10::numeric,
               $4::bigint, $4::bigint,
               $5::jsonb, $6::jsonb, $7::jsonb, $8::varchar, 'created', 'pending', 'none',
               $9::numeric)
       RETURNING id`,
      [
        orderSn, siteId, payPrice, userId,
        JSON.stringify({
          title: up[0].title, pic: (up[0].main_imgs ?? [])[0] ?? '', num,
          goods_id: goodsId, // 取消退单时据此回补库存
          delivery_type: fulfillment,
          goods_amount: goodsAmount,
          ...(costAmount === null ? {} : { unit_cost: unitCost, cost_amount: costAmount }),
          ...(lockedCoupon ? { coupon_name: lockedCoupon.name, coupon_id: lockedCoupon.id } : {}),
        }),
        JSON.stringify({}),
        JSON.stringify({ sku_id: skuId, spec: String(sku?.spec ?? ''), price: unitPrice, num }),
        fulfillment,
        discount,
        costAmount,
      ],
    );
    const orderId = Number(ins[0].id);

    // 锁券：条件 UPDATE（status='unused' + 归属校验）→ 0 行说明并发下已被抢走，回滚订单
    if (lockedCoupon) {
      const { rows: locked } = await pool.query(
        `UPDATE user_coupon SET status = 'used', used_order_id = $3::bigint, used_at = now()
          WHERE id = $1::bigint AND user_id = $2::bigint AND status = 'unused'
          RETURNING id`,
        [lockedCoupon.id, userId, orderId]
      );
      if (!locked.length) {
        await pool.query(`DELETE FROM "order" WHERE id = $1::bigint AND platform_status = 'created'`, [orderId]);
        // 库存回补
        await pool.query(
          `UPDATE self_goods g SET skus = (
             SELECT COALESCE(jsonb_agg(
               CASE WHEN e->>'sku_id' = $3::text
                    THEN jsonb_set(e, '{stock}', (((e->>'stock')::int + $4::int))::text::jsonb)
                    ELSE e END), '[]'::jsonb)
               FROM jsonb_array_elements(g.skus) e)
            WHERE g.goods_id = $1::bigint AND g.site_id = $2::uuid`,
          [goodsId, siteId, skuId, num],
        );
        throw new HttpError(409, '优惠券已被使用，请重新选择', 'COUPON_TAKEN');
      }
      await pool.query(`UPDATE "order" SET coupon_id = $2::bigint WHERE id = $1::bigint`, [orderId, lockedCoupon.id]);
    }

    res.json({
      ok: true,
      data: {
        order_id: orderId, order_sn: orderSn,
        pay_price: payPrice, goods_amount: goodsAmount,
        coupon_discount: discount,
        coupon: lockedCoupon ? { user_coupon_id: lockedCoupon.id, name: lockedCoupon.name } : null,
        fulfillment,
      },
    });
  } catch (e) {
    next(e);
  }
});

/** POST /api/trade/orders/:id/cancel → 取消未支付自营单（created 态）：关单 + 退券 + 回补库存。
 *  档 C 闭环：下单已锁券，未支付订单取消必须把券退回用户（否则券被吞）。已支付不可取消（走退款）。 */
tradeRouter.post('/orders/:id/cancel', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '订单 ID 不合法', 'BAD_PARAM');
    const { rows } = await pool.query(
      `SELECT o.id, o.platform_status, o.coupon_id, o.sku_snapshot, o.goods_snapshot
         FROM "order" o
        WHERE o.id = $1::bigint AND o.buyer_id = $2::bigint AND o.site_id = $3::uuid AND o.provider = 'self' LIMIT 1`,
      [id, req.user!.userId, req.user!.siteId],
    );
    const o = rows[0];
    if (!o) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND');
    if (o.platform_status !== 'created') throw new HttpError(409, '订单状态不可取消', 'BAD_ORDER_STATE');

    // 原子关单（仅 created 可进，幂等）
    const { rows: closed } = await pool.query(
      `UPDATE "order" SET platform_status = 'closed' WHERE id = $1::bigint AND platform_status = 'created' RETURNING id`,
      [id],
    );
    if (!closed.length) throw new HttpError(409, '订单状态不可取消', 'BAD_ORDER_STATE');

    // 退券：used → unused（清 used_order_id，保留 used_at 审计痕迹不动）
    if (o.coupon_id) {
      await pool.query(
        `UPDATE user_coupon SET status = 'unused', used_order_id = NULL
          WHERE id = $1::bigint AND status = 'used' AND used_order_id = $2::bigint`,
        [o.coupon_id, id],
      );
    }
    // 回补库存
    const sku = (o.sku_snapshot ?? {}) as { sku_id?: string; num?: number };
    if (sku.sku_id) {
      const n = Math.max(1, Number(sku.num ?? 1));
      const gid = Number((o.goods_snapshot as { goods_id?: number } | null)?.goods_id ?? 0);
      if (gid > 0) {
        await pool.query(
          `UPDATE self_goods g SET skus = (
             SELECT COALESCE(jsonb_agg(
               CASE WHEN e->>'sku_id' = $3::text
                    THEN jsonb_set(e, '{stock}', (((e->>'stock')::int + $4::int))::text::jsonb)
                    ELSE e END), '[]'::jsonb)
               FROM jsonb_array_elements(g.skus) e)
            WHERE g.goods_id = $1::bigint AND g.site_id = $2::uuid`,
          [gid, req.user!.siteId, String(sku.sku_id), n],
        );
      }
    }
    res.json({ ok: true, data: { order_id: id, coupon_refunded: !!o.coupon_id } });
  } catch (e) {
    next(e);
  }
});

/** POST /api/trade/orders/:id/pay → JSAPI 支付参数（created 单；重复拉取幂等） */
tradeRouter.post('/orders/:id/pay', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { order, cfg } = await loadOwnOrder(req);
    const openid = await userOpenid(req.user!.userId);
    if (!openid) throw new HttpError(409, '缺少支付 openid，请重新进入小程序', 'NO_OPENID');
    const notifyUrl = `${process.env.PUBLIC_BASE_URL ?? 'https://mk.fyt360.cn'}/api/trade/notify/wxpay`;
    const prepayId = await jsapiPrepay({
      cfg,
      outTradeNo: String(order.order_sn),
      description: String(order.title ?? '自营商品'),
      totalFen: Math.round(Number(order.pay_price) * 100),
      openid,
      notifyUrl,
    });
    res.json({ ok: true, data: buildPayParams(prepayId, cfg) });
  } catch (e) {
    next(e);
  }
});

async function loadOwnOrder(req: Request): Promise<{ order: Record<string, unknown>; cfg: PayConfig }> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '订单 ID 不合法', 'BAD_PARAM');
  const { rows } = await pool.query(
    `SELECT o.id, o.order_sn, o.pay_price::float AS pay_price, o.platform_status,
            o.goods_snapshot->>'title' AS title
       FROM "order" o WHERE o.id = $1::bigint AND o.buyer_id = $2::bigint AND o.site_id = $3::uuid AND o.provider = 'self' LIMIT 1`,
    [id, req.user!.userId, req.user!.siteId],
  );
  if (!rows[0]) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND');
  if (rows[0].platform_status !== 'created') throw new HttpError(409, '订单状态不可支付', 'BAD_ORDER_STATE');
  const cfg = await resolvePayConfig(req.user!.siteId);
  return { order: rows[0], cfg };
}

async function userOpenid(userId: number): Promise<string> {
  const { rows } = await pool.query(`SELECT openid FROM "user" WHERE user_id = $1::bigint LIMIT 1`, [userId]);
  return rows[0]?.openid ?? '';
}

/**
 * 自营单支付回调处理（2026-09-29 定稿）：created → paid 推进 + 产核销券。
 * ⚠️ 返利（元宝/佣金）不在支付时发放——核销成功才触发（settleRebateOnVerify），
 * 未核销退款时无返利需冲销，且 settled_at = 核销时间 = 返利到账时间。
 */
async function settleSelfOrder(orderId: number, paymentNo: string): Promise<void> {
  const { rows } = await pool.query(
    `SELECT o.id, o.order_sn, o.site_id::text AS site_id, o.buyer_id::int AS buyer_id, o.pay_price::float AS pay_price,
            o.fulfillment, COALESCE(o.sku_snapshot->>'num', '1') AS sku_num
       FROM "order" o WHERE o.id = $1::bigint AND o.provider = 'self' AND o.platform_status IN ('created','paid') LIMIT 1`,
    [orderId],
  );
  if (!rows[0]) return;
  const o = rows[0];
  // created → paid 一条语句推进（幂等：仅 created 可进入）
  // 网关模式 rowCount = rows.length（恒 0 于无 RETURNING 的 UPDATE）→ 判定一律用 RETURNING 行
  const claimed = await pool.query(
    `UPDATE "order" SET platform_status = 'paid', paid_at = COALESCE(paid_at, now()), payment_no = $2::varchar,
            fulfill_status = 'pending'
       WHERE id = $1::bigint AND platform_status = 'created' RETURNING id`,
    [orderId, paymentNo],
  );
  if (!claimed.rows.length && !paymentNo) return; // 已推进过且无新支付单号 → 幂等退出
  // 到店核销单：支付成功即产核销券（code 确定性 → ON CONFLICT 幂等；次数=购买件数，7 天有效）
  if (o.fulfillment === 'group' && claimed.rows.length) {
    await pool.query(
      `INSERT INTO group_coupon (order_id, code, total_times, status, expire_at)
       VALUES ($1::bigint, $2::varchar, $3::int, 'unused', now() + interval '7 days')
       ON CONFLICT (code) DO NOTHING`,
      [orderId, `GC${orderId}`, Math.max(1, Number(o.sku_num ?? 1))],
    );
  }
}

/**
 * 核销触发的返利结算（2026-09-29 定稿：核销才代表订单完成并触发返利）。
 * 原子抢占 settled_at（IS NULL 条件保证仅首次核销发放一次）→ paid → settled + 元宝 + 佣金三跳。
 * 由 verify/confirm 在每次成功核销后调用（幂等，重复调用无副作用）。
 */
export async function settleRebateOnVerify(orderId: number): Promise<void> {
  const { rows } = await pool.query(
    `SELECT o.id, o.order_sn, o.site_id::text AS site_id, o.buyer_id::int AS buyer_id, o.pay_price::float AS pay_price
       FROM "order" o WHERE o.id = $1::bigint AND o.provider = 'self' LIMIT 1`,
    [orderId],
  );
  if (!rows[0]) return;
  const o = rows[0];
  const cfg = await pool.query(
    `SELECT commission_rate::float AS rate FROM site_payment WHERE site_id = $1::uuid AND status = 'active' LIMIT 1`,
    [o.site_id],
  );
  const rate = Number(cfg.rows[0]?.rate ?? 0.2);
  const commission = Math.round(Number(o.pay_price) * rate * 100) / 100;
  // settled_at = 核销时间（原子抢占：仅 platform_status='paid' 且未结算时进入）
  const settled = await pool.query(
    `UPDATE "order" SET platform_status = 'settled', settled_at = COALESCE(settled_at, now()), commission = $2::numeric
       WHERE id = $1::bigint AND platform_status = 'paid' AND settled_at IS NULL RETURNING id`,
    [orderId, commission],
  );
  if (!settled.rows.length) return;
  // 元宝（与 CPS 同规，拍板 2026-09-28）
  const amount = Math.floor(Number(o.pay_price) * INGOT_PER_YUAN);
  const target = Number(o.buyer_id);
  if (target > 0 && amount > 0) {
    await pool.query(REBATE_SQL, [target, String(orderId), amount, `到店团购订单返元宝 ${o.order_sn}`]);
    await pool.query(BALANCE_FIX_SQL, [target, 'ORDER_REBATE', String(orderId)]);
  }
  // 佣金三跳（自购：target 即买家；基数 = commission）
  if (commission > 0 && target > 0) {
    const { rows: rel } = await pool.query(
      `SELECT u.parent_id::int AS parent_id, u.grand_id::int AS grand_id,
              COALESCE(ml_self.self_rate, 0)::float     AS self_rate,
              COALESCE(ml_parent.direct_rate, 0)::float AS parent_direct,
              COALESCE(ml_grand.team_rate, 0)::float    AS grand_team
         FROM "user" u
         LEFT JOIN member m_self ON m_self.user_id = u.user_id
         LEFT JOIN member_level ml_self ON ml_self.level_id = m_self.level_id
         LEFT JOIN member m_parent ON m_parent.user_id = u.parent_id
         LEFT JOIN member_level ml_parent ON ml_parent.level_id = m_parent.level_id
         LEFT JOIN member m_grand ON m_grand.user_id = u.grand_id
         LEFT JOIN member_level ml_grand ON ml_grand.level_id = m_grand.level_id
        WHERE u.user_id = $1 LIMIT 1`,
      [target],
    );
    if (rel[0]) {
      const jumps: { userId: number; level: number; rate: number }[] = [
        { userId: target, level: 1, rate: Number(rel[0].self_rate) },
        { userId: Number(rel[0].parent_id), level: 2, rate: Number(rel[0].parent_direct) },
        { userId: Number(rel[0].grand_id), level: 3, rate: Number(rel[0].grand_team) },
      ];
      for (const j of jumps) {
        if (!j.userId || j.userId <= 0 || j.rate <= 0) continue;
        const amt = Math.round(commission * j.rate * 100) / 100;
        if (amt <= 0) continue;
        await pool.query(COMMISSION_SQL, [orderId, j.userId, j.level, amt]);
      }
    }
  }
}

// 结算 CTE（ordersync 同款：唯一索引幂等）
const REBATE_SQL = `
WITH tx AS (
  INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
  VALUES ($1, 'ORDER_REBATE', $2, $3, 0, $4)
  ON CONFLICT (user_id, type, ref_id) WHERE type IN ('ORDER_REBATE','REFUND_DEDUCT') DO NOTHING
  RETURNING tx_id
), acc AS (
  INSERT INTO ingot_account (user_id, balance, total_earned) VALUES ($1, $3, $3)
  ON CONFLICT (user_id) DO UPDATE SET
    balance = ingot_account.balance + EXCLUDED.balance,
    total_earned = ingot_account.total_earned + EXCLUDED.total_earned,
    updated_at = now()
  WHERE EXISTS (SELECT 1 FROM tx)
  RETURNING balance
)
SELECT (SELECT count(*)::int FROM tx) AS inserted;
`;
const BALANCE_FIX_SQL = `
UPDATE ingot_tx SET balance_after = COALESCE((SELECT balance FROM ingot_account WHERE user_id = $1), 0)
 WHERE user_id = $1 AND type = $2 AND ref_id = $3 AND balance_after = 0
`;
const COMMISSION_SQL = `
WITH ins AS (
  INSERT INTO commission_flow (order_id, user_id, level, amount, status)
  VALUES ($1, $2, $3, $4, 'available')
  ON CONFLICT (order_id, level) DO NOTHING
  RETURNING user_id, amount
), up AS (
  INSERT INTO promoter (user_id, invite_code, commission_balance)
  SELECT i.user_id, u.invite_code, i.amount
    FROM ins i JOIN "user" u ON u.user_id = i.user_id
  ON CONFLICT (user_id) DO UPDATE SET commission_balance = promoter.commission_balance + EXCLUDED.commission_balance
  RETURNING 1
)
SELECT (SELECT count(*)::int FROM up) AS done;
`;

/**
 * POST /api/trade/orders/:id/mock-pay → 模拟支付成功（联调/验证专用）。
 * 安全边界：仅当该站点无启用支付凭据时可用——真实商户号配置后自动 403，无需下线动作。
 */
tradeRouter.post('/orders/:id/mock-pay', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT o.id, o.platform_status FROM "order" o
        WHERE o.id = $1::bigint AND o.buyer_id = $2::bigint AND o.site_id = $3::uuid AND o.provider = 'self' LIMIT 1`,
      [id, req.user!.userId, req.user!.siteId],
    );
    if (!rows[0]) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND');
    let configured = false;
    try {
      await resolvePayConfig(req.user!.siteId);
      configured = true;
    } catch { /* 未配置 → mock 允许 */ }
    if (configured) throw new HttpError(403, '站点已配置真实支付，mock 通道关闭', 'MOCK_DISABLED');
    if (rows[0].platform_status === 'settled') throw new HttpError(409, '订单已结算', 'BAD_ORDER_STATE');
    await settleSelfOrder(id, `MOCK${Date.now()}`);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** POST /api/trade/notify/wxpay → 微信支付回调（V3 解密；v1 以解密成功+单号核对为验收，验签留 TODO 商户平台证书轮换后补） */
tradeRouter.post('/notify/wxpay', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const resource = req.body?.resource;
    if (!resource?.ciphertext) throw new HttpError(400, '回调缺少 resource', 'BAD_CALLBACK');
    // 单号反查站点 → 对应解密 key（回调不带 site 上下文）
    const probe = await pool.query(
      `SELECT p.site_id::text AS site_id, p.mch_key FROM site_payment p LIMIT 50`,
    );
    let order: { out_trade_no: string; transaction_id: string; trade_state: string } | null = null;
    let siteId = '';
    for (const row of probe.rows) {
      try {
        const j = decryptCallbackResource(
          { mchId: '', apiV3Key: row.mch_key, serialNo: '', privateKeyPem: '', commissionRate: 0, appid: '' },
          resource,
        );
        if (j.out_trade_no) { order = j; siteId = row.site_id; break; }
      } catch { /* key 不匹配，试下一个 */ }
    }
    if (!order) throw new HttpError(400, '回调解密失败', 'DECRYPT_FAIL');
    if (order.trade_state !== 'SUCCESS') {
      res.json({ code: 'SUCCESS', message: '非成功态忽略' });
      return;
    }
    const { rows: o } = await pool.query(
      `SELECT id FROM "order" WHERE order_sn = $1::varchar AND site_id = $2::uuid AND provider = 'self' LIMIT 1`,
      [order.out_trade_no, siteId],
    );
    if (o[0]) await settleSelfOrder(Number(o[0].id), order.transaction_id);
    res.json({ code: 'SUCCESS', message: 'OK' });
  } catch (e) {
    next(e);
  }
});
