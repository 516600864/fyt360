// 团购核销管理（admin-36）：核销记录（verify_log）+ 团购券（group_coupon）+ 核销员（verify_agent）
// 核销员 = C 端 user（决策 #25④）；无门店实体（schema 未建门店表），核销点=站点维度如实展示
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';

export const verifyRouter = Router();

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

/** GET /api/admin/verify/summary?site= → 顶部三卡 + 底部今日统计 */
verifyRouter.get('/summary', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM verify_log WHERE site_id = $1 AND result = 'success'
            AND verified_at >= date_trunc('day', now()))                                    AS today_count,
         (SELECT COALESCE(SUM(o.pay_price), 0) FROM verify_log v JOIN "order" o ON o.id = v.order_id
           WHERE v.site_id = $1 AND v.result = 'success' AND v.verified_at >= date_trunc('day', now())) AS today_amount,
         (SELECT COUNT(*) FROM group_coupon gc JOIN "order" o ON o.id = gc.order_id
           WHERE o.site_id = $1 AND gc.status IN ('unused','partial')
             AND (gc.expire_at IS NULL OR gc.expire_at > now()))                            AS unverified,
         (SELECT COUNT(*) FROM group_coupon gc JOIN "order" o ON o.id = gc.order_id
           WHERE o.site_id = $1 AND gc.status = 'expired')                                   AS expired_count,
         (SELECT COALESCE(SUM(o.pay_price), 0) FROM group_coupon gc JOIN "order" o ON o.id = gc.order_id
           WHERE o.site_id = $1 AND gc.status = 'expired')                                   AS expired_amount,
         (SELECT COUNT(*) FROM group_coupon gc JOIN "order" o ON o.id = gc.order_id
           WHERE o.site_id = $1 AND gc.status = 'used' AND gc.created_at >= date_trunc('day', now())) AS today_issued,
         (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (v.verified_at - gc.created_at)) / 86400), 0)
            FROM verify_log v JOIN group_coupon gc ON gc.coupon_id = v.coupon_id
           WHERE v.site_id = $1 AND v.result = 'success'
             AND v.verified_at >= now() - interval '7 days')                                 AS avg_days,
         (SELECT COUNT(*) FROM verify_agent WHERE site_id = $1 AND status = 'active')        AS agent_count`,
      [siteId]
    );
    const r = rows[0];
    // 核销率 = 今日已核销 / 今日出票（分母 0 时记 100%）
    const rate = Number(r.today_issued) > 0 ? Math.round((Number(r.today_count) / Number(r.today_issued)) * 100) : 100;
    res.json({
      ok: true,
      data: {
        today_count: Number(r.today_count),
        today_amount: Number(r.today_amount),
        unverified: Number(r.unverified),
        expired_count: Number(r.expired_count),
        expired_amount: Number(r.expired_amount),
        today_issued: Number(r.today_issued),
        avg_days: Math.round(Number(r.avg_days) * 10) / 10,
        agent_count: Number(r.agent_count),
        rate,
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/admin/verify/logs?site=&page= → 核销记录 */
verifyRouter.get('/logs', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const size = Math.min(Math.max(Number(req.query.size) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const { rows } = await pool.query(
      `SELECT v.id, v.times, v.result, v.fail_reason, v.verified_at,
              gc.code, gc.total_times, gc.used_times,
              COALESCE(o.goods_snapshot->>'title', '团购商品') AS goods_title, o.pay_price,
              u.user_id::text AS verifier_id, COALESCE(u.nickname, '核销员' || u.user_id) AS verifier_name,
              s.name AS site_name
         FROM verify_log v
         JOIN group_coupon gc ON gc.coupon_id = v.coupon_id
         JOIN "user" u ON u.user_id = v.verifier_user_id
         JOIN site s ON s.site_id = v.site_id
         LEFT JOIN "order" o ON o.id = v.order_id
        WHERE v.site_id = $1
        ORDER BY v.verified_at DESC
        LIMIT $2 OFFSET $3`,
      [siteId, size, (page - 1) * size]
    );
    const { rows: cnt } = await pool.query(`SELECT COUNT(*) AS total FROM verify_log WHERE site_id = $1`, [siteId]);
    res.json({
      ok: true,
      data: {
        total: Number(cnt[0].total),
        page,
        size,
        items: rows.map((r) => ({
          id: Number(r.id),
          code: r.code,
          goods_title: r.goods_title,
          pay_price: Number(r.pay_price ?? 0),
          times: r.times,
          total_times: r.total_times,
          used_times: r.used_times,
          result: r.result,
          fail_reason: r.fail_reason,
          verified_at: r.verified_at,
          verifier: { id: r.verifier_id, name: r.verifier_name },
          site_name: r.site_name,
        })),
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/admin/verify/agents?site= → 核销员管理 */
verifyRouter.get('/agents', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const { rows } = await pool.query(
      `SELECT a.id, a.role, a.status, a.created_at,
              u.user_id::text AS user_id, COALESCE(u.nickname, '用户' || u.user_id) AS nickname, u.invite_code,
              (SELECT COUNT(*) FROM verify_log v WHERE v.verifier_user_id = u.user_id AND v.result = 'success'
                 AND v.verified_at >= date_trunc('day', now())) AS today_count
         FROM verify_agent a JOIN "user" u ON u.user_id = a.user_id
        WHERE a.site_id = $1
        ORDER BY a.created_at`,
      [siteId]
    );
    res.json({
      ok: true,
      data: {
        agents: rows.map((r) => ({
          id: Number(r.id),
          user: { user_id: r.user_id, nickname: r.nickname, invite_code: r.invite_code },
          role: r.role, // verifier 仅核销 / manager 核销+退款
          status: r.status,
          today_count: Number(r.today_count),
          created_at: r.created_at,
        })),
      },
    });
  } catch (e) { next(e); }
});

/** POST /api/admin/verify/agents {invite_code|user_id} → 新增核销员 */
verifyRouter.post('/agents', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    let userId = Number(req.body?.user_id);
    if (!Number.isFinite(userId) && req.body?.invite_code) {
      const { rows } = await pool.query(`SELECT user_id FROM "user" WHERE invite_code = $1 AND site_id = $2 LIMIT 1`, [String(req.body.invite_code), siteId]);
      if (!rows[0]) throw new HttpError(404, '邀请码对应用户不存在', 'USER_NOT_FOUND');
      userId = Number(rows[0].user_id);
    }
    if (!Number.isFinite(userId)) throw new HttpError(400, '缺少 user_id 或 invite_code', 'BAD_REQUEST');
    const role = req.body?.role === 'manager' ? 'manager' : 'verifier';
    const { rows } = await pool.query(
      `INSERT INTO verify_agent (site_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (site_id, user_id) DO UPDATE SET role = $3, status = 'active' RETURNING id`,
      [siteId, userId, role]
    );
    res.json({ ok: true, data: { id: Number(rows[0].id) } });
  } catch (e) { next(e); }
});

/** PATCH /api/admin/verify/agents/:id {role,status} → 调整核销员 */
verifyRouter.patch('/agents/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (req.body?.role !== undefined) { params.push(req.body.role === 'manager' ? 'manager' : 'verifier'); sets.push(`role = $${params.length}`); }
    if (req.body?.status !== undefined) { params.push(req.body.status === 'disabled' ? 'disabled' : 'active'); sets.push(`status = $${params.length}`); }
    if (!sets.length) throw new HttpError(400, '无可更新字段', 'BAD_REQUEST');
    params.push(Number(req.params.id));
    const { rows } = await pool.query(`UPDATE verify_agent SET ${sets.join(', ')} WHERE id = $${params.length}::bigint RETURNING id`, params);
    if (!rows[0]) throw new HttpError(404, '核销员不存在', 'AGENT_NOT_FOUND');
    res.json({ ok: true, data: { id: Number(rows[0].id) } });
  } catch (e) { next(e); }
});
