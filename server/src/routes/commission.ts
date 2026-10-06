// 佣金与元宝结算配置（admin-33）：会员等级比例（member_level）+ 平台规则（platform_config）
// 等级/规则为平台级数据（决策#12/#21），写操作仅超管；读全后台开放
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, type AdminJwtPayload } from '../middleware/auth.js';

export const commissionRouter = Router();

const CONFIG_KEYS = ['ingot_rule', 'withdraw_rule', 'dist_alloc'] as const;
type ConfigKey = (typeof CONFIG_KEYS)[number];

function assertPlatform(admin: AdminJwtPayload): void {
  if (admin.role !== 'platform_admin') throw new HttpError(403, 'PLATFORM_ONLY', '结算规则仅平台管理员可修改');
}

/** GET /api/admin/commission/config → 等级表 + 规则 + 汇总 */
commissionRouter.get('/config', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows: levels } = await pool.query(
      `SELECT code, name, sort, ingot_price, self_rate, direct_rate, team_rate, "desc", status
         FROM member_level WHERE status = 'active' ORDER BY sort`
    );
    const { rows: cfg } = await pool.query(`SELECT key, value FROM platform_config WHERE key = ANY($1)`, [CONFIG_KEYS]);
    const rules: Record<string, unknown> = {};
    for (const k of CONFIG_KEYS) {
      rules[k] = cfg.find((c) => c.key === k)?.value
        ?? (k === 'ingot_rule' ? { self_return: 100, invite_reward: 500 }
          : k === 'withdraw_rule' ? { min_amount: 10, fee_rate: 0, per_txn_limit: 5000 }
          : { items: [] });
    }
    const { rows: stat } = await pool.query(
      `SELECT
         COALESCE((SELECT SUM(amount) FROM ingot_tx WHERE amount > 0), 0)                AS ingot_granted_total,
         (SELECT COUNT(*) FROM member_level WHERE status = 'active')                     AS levels_active,
         COALESCE((SELECT SUM(amount) FROM commission_flow
                    WHERE status IN ('estimated','available')
                      AND created_at >= date_trunc('day', now())), 0)                    AS today_estimate`
    );
    res.json({
      ok: true,
      data: {
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

/** PATCH /api/admin/commission/levels/:code → 编辑等级档位（兑换价/三跳比例） */
commissionRouter.patch('/levels/:code', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertPlatform(req.admin!);
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
    params.push(code);
    const { rows } = await pool.query(
      `UPDATE member_level SET ${sets.join(', ')} WHERE code = $${params.length}::text RETURNING code`,
      params
    );
    if (!rows[0]) throw new HttpError(404, '等级不存在', 'LEVEL_NOT_FOUND');
    res.json({ ok: true, data: { code: rows[0].code } });
  } catch (e) { next(e); }
});

/** PUT /api/admin/commission/config/:key → 更新规则块（白名单键） */
commissionRouter.put('/config/:key', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertPlatform(req.admin!);
    const key = String(req.params.key ?? '') as ConfigKey;
    if (!CONFIG_KEYS.includes(key)) throw new HttpError(400, '不支持的配置键', 'BAD_REQUEST');
    const value = req.body?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new HttpError(400, 'value 须为对象', 'BAD_REQUEST');
    }
    await pool.query(
      `INSERT INTO platform_config (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now(), updated_by = $3`,
      [key, JSON.stringify(value), req.admin!.adminId]
    );
    res.json({ ok: true, data: { key } });
  } catch (e) { next(e); }
});
