// 营销中心（admin-40）：优惠券（coupon）+ 秒杀（seckill_activity）+ 分佣开关（platform_config.dist_alloc）
// 拼团无数据面（schema 未建）、Banner 位随 DIY 装修编辑器（admin-30）——两端点如实 501
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';

export const marketingRouter = Router();

async function oneSite(admin: AdminJwtPayload, code: string): Promise<string> {
  if (code) {
    const { rows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [code]);
    if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    assertSiteAccess(admin, String(rows[0].site_id));
    return String(rows[0].site_id);
  }
  if (admin.siteIds.length === 1) return admin.siteIds[0];
  if (admin.role === 'platform_admin') {
    const { rows } = await pool.query(`SELECT site_id::text AS site_id FROM site ORDER BY created_at LIMIT 1`);
    return String(rows[0].site_id);
  }
  throw new HttpError(400, '须指定站点', 'SITE_REQUIRED');
}

/** 券状态推导：active → 排期中(valid_from 未到) / 进行中 / 已结束(valid_to 已过) */
function couponPhase(c: { status: string; valid_from: Date | null; valid_to: Date | null }): string {
  if (c.status === 'disabled') return '已停用';
  const now = Date.now();
  if (c.valid_from && new Date(c.valid_from).getTime() > now) return '排期中';
  if (c.valid_to && new Date(c.valid_to).getTime() < now) return '已结束';
  return '进行中';
}

/** GET /api/admin/marketing/coupons → 券列表（含领取/使用统计） */
marketingRouter.get('/coupons', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.type, c.scope, c.amount, c.threshold, c.total, c.issued,
              c.valid_from, c.valid_to, c.status,
              (SELECT COUNT(*) FROM user_coupon uc WHERE uc.coupon_id = c.id AND uc.status = 'used') AS used_count
         FROM coupon c WHERE c.site_id = $1 ORDER BY c.created_at DESC`,
      [siteId]
    );
    res.json({
      ok: true,
      data: {
        coupons: rows.map((r) => ({
          id: Number(r.id),
          name: r.name,
          type: r.type, // cash_off / discount / exchange
          scope: r.scope, // self 自营 / rights 权益
          amount: Number(r.amount),
          threshold: Number(r.threshold),
          total: r.total,
          issued: Number(r.issued),
          used_count: Number(r.used_count),
          valid_from: r.valid_from,
          valid_to: r.valid_to,
          status: r.status,
          phase: couponPhase(r),
        })),
      },
    });
  } catch (e) { next(e); }
});

/** POST /api/admin/marketing/coupons → 新建券 */
marketingRouter.post('/coupons', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const { name, type, scope, amount, threshold, total, valid_from, valid_to } = req.body ?? {};
    if (!name || typeof name !== 'string') throw new HttpError(400, '券名不能为空', 'BAD_REQUEST');
    if (!['cash_off', 'discount', 'exchange'].includes(type)) throw new HttpError(400, '券类型非法', 'BAD_REQUEST');
    // scope 仅 self：权益/CPS 订单链路不接券（无 user_coupon_id 消费点），开放 rights 只会建出永远用不了的券
    if (scope === 'rights') throw new HttpError(400, '权益订单暂不支持用券，请选择到店团购订单', 'SCOPE_UNSUPPORTED');
    const thr = Math.max(Number(threshold) || 0, 0);
    const tot = Math.max(Math.round(Number(total) || 0), 1);
    // 类型化 amount 校验（2026-10-02）：折扣券算的是 1-amount/10，填 0 = 打 1 折近白送、>10 = 负抵扣
    let amt = 0;
    if (type === 'exchange') {
      amt = 0; // 兑换券按商品全额抵扣，无面额语义
    } else if (type === 'discount') {
      amt = Number(amount);
      if (!Number.isFinite(amt) || amt < 1 || amt > 9.9) {
        throw new HttpError(400, '折扣券需填 1~9.9 折（8.5 表示打 8.5 折）', 'BAD_AMOUNT');
      }
      amt = Math.round(amt * 100) / 100;
    } else {
      amt = Math.max(Number(amount) || 0, 0.01);
    }
    // 有效期区间自检：开始晚于结束是配置错误
    const from = valid_from ? new Date(valid_from) : null;
    const to = valid_to ? new Date(valid_to) : null;
    if (from && to && from >= to) throw new HttpError(400, '有效期「从」必须早于「至」', 'BAD_VALID_RANGE');
    const { rows } = await pool.query(
      `INSERT INTO coupon (site_id, name, type, scope, amount, threshold, total, valid_from, valid_to)
       VALUES ($1, $2, $3, 'self', $4, $5, $6, $7, $8) RETURNING id`,
      [siteId, name.slice(0, 128), type, amt, thr, tot, from, to]
    );
    res.json({ ok: true, data: { id: Number(rows[0].id) } });
  } catch (e) { next(e); }
});

/** PATCH /api/admin/marketing/coupons/:id {status} → 启用/停用 */
marketingRouter.patch('/coupons/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.body?.status === 'disabled' ? 'disabled' : 'active';
    const { rows } = await pool.query(`UPDATE coupon SET status = $2 WHERE id = $1 RETURNING id`, [Number(req.params.id), status]);
    if (!rows[0]) throw new HttpError(404, '券不存在', 'COUPON_NOT_FOUND');
    res.json({ ok: true, data: { id: Number(rows[0].id), status } });
  } catch (e) { next(e); }
});

/** DELETE /api/admin/marketing/coupons/:id → 删除（已发放的券禁止删除，只能停用） */
marketingRouter.delete('/coupons/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(`SELECT issued FROM coupon WHERE id = $1::bigint LIMIT 1`, [Number(req.params.id)]);
    if (!rows[0]) throw new HttpError(404, '券不存在', 'COUPON_NOT_FOUND');
    if (Number(rows[0].issued) > 0) throw new HttpError(409, '已发放的券不可删除，请停用', 'COUPON_ISSUED');
    await pool.query(`DELETE FROM coupon WHERE id = $1::bigint`, [Number(req.params.id)]);
    res.json({ ok: true, data: { id: Number(req.params.id) } });
  } catch (e) { next(e); }
});

/** GET /api/admin/marketing/seckills → 秒杀场次列表 */
marketingRouter.get('/seckills', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const { rows } = await pool.query(
      `SELECT s.id, s.seckill_price, s.start_at, s.end_at, s.stock, s.limit_per_user, s.status,
              g.title AS goods_title
         FROM seckill_activity s JOIN self_goods g ON g.goods_id = s.goods_id
        WHERE s.site_id = $1 ORDER BY s.start_at DESC`,
      [siteId]
    );
    res.json({
      ok: true,
      data: {
        seckills: rows.map((r) => ({
          id: Number(r.id),
          goods_title: r.goods_title,
          seckill_price: Number(r.seckill_price),
          start_at: r.start_at,
          end_at: r.end_at,
          stock: r.stock,
          limit_per_user: r.limit_per_user,
          status: r.status,
        })),
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/admin/marketing/dist-switch → 三级分佣开关（platform_config.dist_alloc 单一真相源） */
marketingRouter.get('/dist-switch', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM platform_config WHERE key = 'dist_alloc' LIMIT 1`);
    res.json({ ok: true, data: { items: rows[0]?.value?.items ?? [] } });
  } catch (e) { next(e); }
});

/** PUT /api/admin/marketing/dist-switch {items} → 更新（仅超管） */
marketingRouter.put('/dist-switch', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.admin!.role !== 'platform_admin') throw new HttpError(403, 'PLATFORM_ONLY', '分佣开关仅平台管理员可修改');
    const items = req.body?.items;
    if (!Array.isArray(items) || items.some((i) => !i || typeof i.key !== 'string' || typeof i.label !== 'string' || typeof i.on !== 'boolean')) {
      throw new HttpError(400, 'items 格式非法', 'BAD_REQUEST');
    }
    await pool.query(
      `UPDATE platform_config SET value = $2::jsonb, updated_at = now(), updated_by = $3::bigint WHERE key = $1::text`,
      ['dist_alloc', JSON.stringify({ items }), req.admin!.adminId]
    );
    res.json({ ok: true, data: { saved: items.length } });
  } catch (e) { next(e); }
});

/** GET /api/admin/marketing/group-buys → 拼团数据面未建，如实 501 */
marketingRouter.get('/group-buys', requireAdmin, async (_req: Request, res: Response) => {
  res.status(501).json({ ok: false, code: 'NOT_IMPLEMENTED', message: '拼团数据面随团购里程碑开放（schema 未建）' });
});
