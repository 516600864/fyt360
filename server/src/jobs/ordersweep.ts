/**
 * ordersweep —— 未支付订单超时自动关单（2026-10-02）
 *
 * 业务背景：自营下单即锁券（user_coupon.status='used' + used_order_id）+ 建单即扣库存。
 * 若用户下单后不付款，券与库存会被无限期占用——建8 笔僵尸单是实测后果。
 * 规则：**created 态自营单创建满 PAY_WINDOW_MIN 分钟仍未支付 → 自动关单 + 退券 + 回补库存。**
 *
 * 设计要点：
 *  1. 幂等：UPDATE ... WHERE platform_status='created' 条件更新，重复跑无副作用。
 *  2. 并发安全：先原子关单（拿到 closed 名单），只有成功关单的才退券/回补——不会与用户
 *     「取消订单」端点或支付回调抢同一单（它们也都以 created 为前置条件）。
 *  3. 不碰已支付单：platform_status IN ('paid','settled') 直接排除。
 *  4. 回补库存复用 jsonb_agg + CASE 限定 sku_id（否则整个数组被覆盖）。
 */
import { pool } from '../db/client.js';

export const PAY_WINDOW_MIN = 30; // 待支付窗口（分钟）

export interface SweepResult {
  scanned: number;
  closed: number;
  coupon_refunded: number;
  stock_restored: number;
  details: Array<{ order_id: number; order_sn: string; coupon: boolean; stock: boolean }>;
}

/** 关单 + 退券 + 回补库存（单笔；调用方保证已确认该单仍为 created） */
async function settleOne(o: {
  order_id: number;
  order_sn: string;
  coupon_id: number | null;
  goods_id: number | null;
  sku_id: string | null;
  num: number;
  site_id: string;
}): Promise<{ coupon: boolean; stock: boolean }> {
  // 原子关单：只有仍处于 created 才成功（并发下用户手动取消先到则此处 0 行，直接放弃）
  const { rows: closed } = await pool.query(
    `UPDATE "order" SET platform_status = 'closed'
      WHERE id = $1::bigint AND platform_status = 'created'
      RETURNING id`,
    [o.order_id],
  );
  if (!closed.length) return { coupon: false, stock: false };

  // 退券：used → unused，清订单关联（used_at 保留作审计痕迹）
  let coupon = false;
  if (o.coupon_id) {
    const { rows } = await pool.query(
      `UPDATE user_coupon SET status = 'unused', used_order_id = NULL
        WHERE id = $1::bigint AND status = 'used' AND used_order_id = $2::bigint
        RETURNING id`,
      [o.coupon_id, o.order_id],
    );
    coupon = rows.length > 0;
  }

  // 回补库存
  let stock = false;
  if (o.goods_id && o.sku_id) {
    const { rows } = await pool.query(
      `UPDATE self_goods g SET skus = (
         SELECT COALESCE(jsonb_agg(
           CASE WHEN e->>'sku_id' = $3::text
                THEN jsonb_set(e, '{stock}', (((e->>'stock')::int + $4::int))::text::jsonb)
                ELSE e END), '[]'::jsonb)
           FROM jsonb_array_elements(g.skus) e)
        WHERE g.goods_id = $1::bigint AND g.site_id = $2::uuid
        RETURNING g.goods_id`,
      [o.goods_id, o.site_id, o.sku_id, o.num],
    );
    stock = rows.length > 0;
  }
  return { coupon, stock };
}

/**
 * 扫描并清理超时未支付订单。
 * @param windowMin 超时窗口（分钟），默认 PAY_WINDOW_MIN
 * @param limit 单次处理上限（防一次锁表过久）
 */
export async function runOrdersweep(windowMin: number = PAY_WINDOW_MIN, limit = 200): Promise<SweepResult> {
  // 先取候选（只读），再逐笔条件关单
  const { rows: cands } = await pool.query(
    `SELECT o.id AS order_id, o.order_sn, o.site_id, o.coupon_id,
            o.sku_snapshot, o.goods_snapshot, o.created_at
       FROM "order" o
      WHERE o.provider = 'self'
        AND o.platform_status = 'created'
        AND o.created_at < now() - ($1::int * interval '1 minute')
      ORDER BY o.created_at ASC
      LIMIT $2::int`,
    [windowMin, limit],
  );

  const result: SweepResult = {
    scanned: cands.length,
    closed: 0,
    coupon_refunded: 0,
    stock_restored: 0,
    details: [],
  };

  for (const c of cands) {
    const sku = (c.sku_snapshot ?? {}) as { sku_id?: string; num?: number };
    const goods = (c.goods_snapshot ?? {}) as { goods_id?: number } | null;
    const r = await settleOne({
      order_id: Number(c.order_id),
      order_sn: String(c.order_sn),
      coupon_id: c.coupon_id ? Number(c.coupon_id) : null,
      goods_id: goods?.goods_id ? Number(goods.goods_id) : null,
      sku_id: sku.sku_id ? String(sku.sku_id) : null,
      num: Math.max(1, Number(sku.num ?? 1)),
      site_id: String(c.site_id),
    });
    if (r.coupon || r.stock) {
      result.closed += 1;
      if (r.coupon) result.coupon_refunded += 1;
      if (r.stock) result.stock_restored += 1;
      result.details.push({
        order_id: Number(c.order_id),
        order_sn: String(c.order_sn),
        coupon: r.coupon,
        stock: r.stock,
      });
    }
  }
  return result;
}
