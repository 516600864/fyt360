// 分销关系树（admin-39）：user.parent_id/grand_id/great_id 三跳关系 + commission_flow 贡献
// 决策#27：聚合 KPI 超管只读；明细按站点 scope。解绑申诉暂无数据面（显示 0，不造假）
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';

export const distributionRouter = Router();

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

/** GET /api/admin/distribution/summary → 4 KPI */
distributionRouter.get('/summary', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ids = await siteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE parent_id IS NOT NULL)::int AS bound_total,
         COUNT(DISTINCT parent_id) FILTER (WHERE parent_id IS NOT NULL)::int AS active_links,
         COUNT(*) FILTER (WHERE parent_id IS NOT NULL AND created_at >= date_trunc('week', now()))::int AS bound_week
       FROM "user" WHERE site_id IN (${SITE_PH(ids)})`, ids);
    res.json({
      ok: true,
      data: {
        bound_total: rows[0]?.bound_total ?? 0,
        active_links: rows[0]?.active_links ?? 0,
        bound_week: rows[0]?.bound_week ?? 0,
        appeals: 0, // 解绑申诉数据面未建（防篡改锁+申诉流程属后续里程碑），如实显示 0
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/admin/distribution/roots?site= → 绑定人数最多的根用户（明细钻取入口） */
distributionRouter.get('/roots', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ids = await siteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const { rows } = await pool.query(
      `SELECT u.user_id, u.nickname, u.created_at,
              COUNT(c.user_id)::int AS team,
              COALESCE(cw.total, 0)::float AS commission
         FROM "user" u
         LEFT JOIN "user" c ON c.parent_id = u.user_id
         LEFT JOIN LATERAL (
           SELECT SUM(amount)::float AS total FROM commission_flow
            WHERE user_id = u.user_id AND status <> 'invalid'
         ) cw ON TRUE
        WHERE u.site_id IN (${SITE_PH(ids)}) AND u.parent_id IS NOT NULL
        GROUP BY u.user_id, u.nickname, u.created_at, cw.total
        ORDER BY team DESC, commission DESC
        LIMIT 20`, ids);
    res.json({ ok: true, data: { items: rows } });
  } catch (e) { next(e); }
});

/** GET /api/admin/distribution/tree?user_id=&site= → 某用户的三跳下级明细 */
distributionRouter.get('/tree', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ids = await siteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const uid = Number(req.query.user_id);
    if (!Number.isFinite(uid)) throw new HttpError(400, 'user_id 非法', 'BAD_USER');
    const { rows: rootRows } = await pool.query(
      `SELECT user_id, nickname, created_at FROM "user"
        WHERE user_id = $1 AND site_id IN (${SITE_PH(ids, 2)})`, [uid, ...ids]);
    if (!rootRows[0]) throw new HttpError(404, '用户不存在或无站点权限', 'USER_NOT_FOUND');

    const { rows } = await pool.query(
      `SELECT u.user_id, u.nickname, u.parent_id, u.grand_id, u.created_at,
              ml.code AS level_code, ml.name AS level_name,
              (SELECT COUNT(*)::int FROM "user" c WHERE c.parent_id = u.user_id) AS team,
              COALESCE((SELECT SUM(amount)::float FROM commission_flow
                         WHERE user_id = u.user_id AND status <> 'invalid'), 0) AS commission
         FROM "user" u
         LEFT JOIN member m ON m.user_id = u.user_id
         LEFT JOIN member_level ml ON ml.level_id = m.level_id
        WHERE (u.parent_id = $1 OR u.grand_id = $1 OR u.great_id = $1)
          AND u.site_id IN (${SITE_PH(ids, 2)})
        ORDER BY u.created_at`, [uid, ...ids]);
    const items = rows.map((r) => ({
      user_id: r.user_id,
      nickname: r.nickname ?? `用户${r.user_id}`,
      hop: r.parent_id === uid ? 1 : r.grand_id === uid ? 2 : 3,
      level_code: r.level_code ?? 'L1',
      level_name: r.level_name ?? '省心',
      bound_at: r.created_at,
      bound_by: r.parent_id === uid ? '平台发展' : '由上级邀请',
      team: r.team,
      commission: r.commission,
    }));
    res.json({ ok: true, data: { root: rootRows[0], items } });
  } catch (e) { next(e); }
});
