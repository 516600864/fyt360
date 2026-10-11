// 佣金与元宝结算配置（admin-33）：会员等级比例（member_level）+ 规则块（platform_config 站点维度）
// 2026-10-11 站点级化（docs/结算配置站点级化设计评审.md）：每站独立档位与规则；
// 写权限 = 站点负责人（is_owner）或平台管理员代写；读全后台开放。
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, requireOwnerOrPlatform, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';

export const commissionRouter = Router();

const CONFIG_KEYS = ['ingot_rule', 'withdraw_rule', 'dist_alloc'] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];
const NULL_UUID = '00000000-0000-0000-0000-000000000000';

/** 解析结算配置的目标站点（query.site / x-fyt-site；平台管理员缺省 site-a） */
async function resolveTargetSite(req: Request, admin: AdminJwtPayload): Promise<{ siteId: string; code: string }> {
  const code = String(req.query.site ?? req.headers['x-fyt-site'] ?? '') || 'site-a';
  const { rows } = await pool.query(`SELECT site_id::text AS id FROM site WHERE code = $1 LIMIT 1`, [code]);
  if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
  const siteId = String(rows[0].id);
  assertSiteAccess(admin, siteId);
  return { siteId, code };
}

/** 站点规则读取（fallback 链：站点行 → 平台键 → 代码默认） */
export async function siteRule(key: ConfigKey, siteId: string): Promise<unknown> {
  const { rows: siteRow } = await pool.query(
    `SELECT value FROM platform_config WHERE key = $1 AND site_id = $2::uuid LIMIT 1`, [key, siteId]);
  if (siteRow[0]?.value) return siteRow[0].value;
  const { rows: platRow } = await pool.query(
    `SELECT value FROM platform_config WHERE key = $1 AND site_id IS NULL LIMIT 1`, [key]);
  return platRow[0]?.value ?? null;
}

/** GET /api/admin/commission/config?site= → 等级表 + 规则 + 汇总（按站） */
commissionRouter.get('/config', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId } = await resolveTargetSite(req, req.admin!);
    const { rows: levels } = await pool.query(
      `SELECT code, name, sort, ingot_price, self_rate, direct_rate, team_rate, "desc", status
         FROM member_level WHERE site_id = $1::uuid AND status = 'active' ORDER BY sort`, [siteId]);
    const rules: Record<string, unknown> = {};
    for (const k of CONFIG_KEYS) {
      rules[k] = await siteRule(k, siteId)
        ?? (k === 'ingot_rule' ? { self_return: 100, invite_reward: 500 }
          : k === 'withdraw_rule' ? { min_amount: 10, fee_rate: 0, per_txn_limit: 5000 }
          : { items: [] });
    }
    const { rows: stat } = await pool.query(
      `SELECT
         COALESCE((SELECT SUM(t.amount) FROM ingot_tx t JOIN "user" u ON u.user_id = t.user_id
                    WHERE t.amount > 0 AND u.site_id = $1::uuid), 0)                          AS ingot_granted_total,
         (SELECT COUNT(*) FROM member_level WHERE site_id = $1::uuid AND status = 'active')   AS levels_active,
         COALESCE((SELECT SUM(cf.amount) FROM commission_flow cf JOIN "user" u ON u.user_id = cf.user_id
                    WHERE cf.status IN ('estimated','available')
                      AND cf.created_at >= date_trunc('day', now()) AND u.site_id = $1::uuid), 0) AS today_estimate`,
      [siteId],
    );
    res.json({
      ok: true,
      data: {
        site: await pool.query(`SELECT code FROM site WHERE site_id = $1::uuid`, [siteId]).then((r) => r.rows[0]?.code),
        levels: levels.map((l) => ({
          code: l.code,
          name: l.name,
          sort: l.sort,
          ingot_price: Number(l.ingot_price),
          self_rate: Number(l.self_rate),
          direct_rate: Number(l.direct_rate),
          team_rate: Number(l.team_rate),
          desc: l.desc,
        })),
        rules,
        stats: {
          ingot_granted_total: Number(stat[0].ingot_granted_total),
          levels_active: Number(stat[0].levels_active),
          today_estimate: Number(stat[0].today_estimate),
        },
      },
    });
  } catch (e) { next(e); }
});

/** PATCH /api/admin/commission/levels/:code?site= → 编辑本站等级档位（兑换价/三跳比例） */
commissionRouter.patch('/levels/:code', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId } = await resolveTargetSite(req, req.admin!);
    await requireOwnerOrPlatform(req.admin!, siteId);
    const code = String(req.params.code ?? '');
    const { ingot_price, self_rate, direct_rate, team_rate } = req.body ?? {};
    const num = (v: unknown, max: number, label: string): number => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > max) throw new HttpError(400, `${label}取值非法`, 'BAD_REQUEST');
      return n;
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    if (ingot_price !== undefined) { params.push(Math.round(num(ingot_price, 1e9, '兑换价'))); sets.push(`ingot_price = $${params.length}`); }
    if (self_rate !== undefined) { params.push(num(self_rate, 1, '自购比例')); sets.push(`self_rate = $${params.length}`); }
    if (direct_rate !== undefined) { params.push(num(direct_rate, 1, '直推比例')); sets.push(`direct_rate = $${params.length}`); }
    if (team_rate !== undefined) { params.push(num(team_rate, 1, '间推比例')); sets.push(`team_rate = $${params.length}`); }
    if (!sets.length) throw new HttpError(400, '无可更新字段', 'BAD_REQUEST');
    params.push(code, siteId);
    const { rows } = await pool.query(
      `UPDATE member_level SET ${sets.join(', ')}
        WHERE code = $${params.length - 1}::text AND site_id = $${params.length}::uuid RETURNING code`,
      params,
    );
    if (!rows[0]) throw new HttpError(404, '等级不存在', 'LEVEL_NOT_FOUND');
    res.json({ ok: true, data: { code: rows[0].code } });
  } catch (e) { next(e); }
});

/** PUT /api/admin/commission/config/:key?site= → 更新本站规则块（白名单键） */
commissionRouter.put('/config/:key', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId } = await resolveTargetSite(req, req.admin!);
    await requireOwnerOrPlatform(req.admin!, siteId);
    const key = String(req.params.key ?? '') as ConfigKey;
    if (!CONFIG_KEYS.includes(key)) throw new HttpError(400, '不支持的配置键', 'BAD_REQUEST');
    const value = req.body?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, 'value 须为对象', 'BAD_REQUEST');
    }
    await pool.query(
      `INSERT INTO platform_config (key, site_id, value, updated_by) VALUES ($1, $2::uuid, $3::jsonb, $4)
       ON CONFLICT (key, COALESCE(site_id, '${NULL_UUID}'::uuid))
       DO UPDATE SET value = $3::jsonb, updated_at = now(), updated_by = $4`,
      [key, siteId, JSON.stringify(value), req.admin!.adminId],
    );
    res.json({ ok: true, data: { key } });
  } catch (e) { next(e); }
});
