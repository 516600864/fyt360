// 元宝对账（M2.4）：admin 端真数据对账视图
// 口径（§11 / 决策#21）：元宝 1 元 = 100 元宝，按订单实付结算；佣金基数 = order.commission（平台到手收益）
// 对账核对：ingot_tx.ORDER_REBATE 发放合计  vs  已结算订单应付合计 floor(pay_price*INGOT_PER_YUAN)
//   差额≠0 → 结算逻辑或数据异常，对账屏红色告警
// 站点隔离：平台超管可看全平台（可按站点过滤）；站点角色强制白名单
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { INGOT_PER_YUAN } from '../lib/constants.js';

export const ingotRouter = Router();

const TX_TYPES = ['ORDER_REBATE', 'INVITE_REWARD', 'LEVEL_EXCHANGE', 'REFUND_DEDUCT', 'ADMIN_ADJUST'] as const;

/** 解析站点过滤：返回允许查看的 site_id UUID 列表 + 展示用 code 集合 */
async function resolveSiteScope(admin: AdminJwtPayload, code: string): Promise<string[]> {
  const isPlatform = admin.role === 'platform_admin';
  if (code) {
    const { rows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [code]);
    if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    const siteId = String(rows[0].site_id);
    assertSiteAccess(admin, siteId);
    return [siteId];
  }
  if (isPlatform) {
    const { rows } = await pool.query(`SELECT site_id::text AS id FROM site`);
    return rows.map((r) => String(r.id));
  }
  if (!admin.siteIds.length) throw new HttpError(403, '无站点权限', 'SITE_FORBIDDEN');
  return admin.siteIds;
}

/**
 * GET /api/admin/ingot/summary?site=code
 * 对账总览：分类型汇总 + 期末余额/冻结 + 已结算订单核对 + 佣金三跳分布
 */
ingotRouter.get('/summary', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? ''));
    const placeholders = sites.map((_, i) => `$${i + 1}`).join(',');

    // 1. 流水分类型汇总（发放/扣回）
    const { rows: typeRows } = await pool.query(
      `SELECT type, COUNT(*)::int AS cnt, COALESCE(SUM(amount),0)::int AS amount
         FROM ingot_tx WHERE user_id IN (SELECT user_id FROM "user" WHERE site_id IN (${placeholders}))
        GROUP BY type ORDER BY type`,
      sites
    );

    // 2. 期末余额（站点维度账户合计）
    const { rows: accountRows } = await pool.query(
      `SELECT COALESCE(SUM(balance),0)::int AS balance,
              COALESCE(SUM(frozen),0)::int AS frozen,
              COALESCE(SUM(total_earned),0)::int AS total_earned,
              COUNT(*)::int AS accounts
         FROM ingot_account WHERE user_id IN (SELECT user_id FROM "user" WHERE site_id IN (${placeholders}))`,
      sites
    );

    // 3. 已结算订单核对：应付元宝 = floor(pay_price*10) 求和
    //    口径只统计 buyer 是本系统真实用户的订单——uid 为蚂蚁跟单号等外部 id 的历史单
    //    结算时防御跳过（不可能发放），计入应付会让差额恒为负，无对账意义
    const { rows: orderRows } = await pool.query(
      `SELECT COUNT(*)::int AS settled_orders,
              COALESCE(SUM(FLOOR(pay_price * ${INGOT_PER_YUAN})),0)::int AS expect_ingot
         FROM "order" o
        WHERE o.site_id IN (${placeholders}) AND o.rebate_at IS NOT NULL
          AND o.buyer_id IN (SELECT user_id FROM "user" WHERE site_id = o.site_id)`,
      sites
    );
    const rebate = typeRows.find((r) => r.type === 'ORDER_REBATE');
    const refund = typeRows.find((r) => r.type === 'REFUND_DEDUCT');
    // 净发放 = ORDER_REBATE 正流水量 + REFUND_DEDUCT 负流水量（冲销）
    const netRebated = (rebate?.amount ?? 0) + (refund?.amount ?? 0);
    const expectIngoted = orderRows[0]?.expect_ingot ?? 0;
    const drift = netRebated - expectIngoted;

    // 4. 佣金三跳分布（按 level + status）
    const { rows: commissionRows } = await pool.query(
      `SELECT cf.level, cf.status, COUNT(*)::int AS cnt, COALESCE(SUM(cf.amount),0) AS amount
         FROM commission_flow cf
         JOIN "order" o ON o.id = cf.order_id
        WHERE o.site_id IN (${placeholders})
        GROUP BY cf.level, cf.status ORDER BY cf.level, cf.status`,
      sites
    );

    res.json({
      ok: true,
      data: {
        types: typeRows,
        account: accountRows[0] ?? { balance: 0, frozen: 0, total_earned: 0, accounts: 0 },
        recon: {
          settled_orders: orderRows[0]?.settled_orders ?? 0,
          expect_ingot: expectIngoted,
          net_rebated: netRebated,
          drift,
          drift_ok: drift === 0,
        },
        commission: commissionRows,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/admin/ingot/tx?site=code&type=ORDER_REBATE&page=1&size=20
 * 流水分页（新→旧），带用户昵称与订单号
 */
ingotRouter.get('/tx', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? ''));
    const type = String(req.query.type ?? '');
    if (type && !(TX_TYPES as readonly string[]).includes(type)) {
      throw new HttpError(400, 'type 不合法', 'BAD_PARAM');
    }
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const size = Math.min(100, Math.max(1, Number(req.query.size ?? 20) || 20));
    const offset = (page - 1) * size;

    const conds: string[] = [`u.site_id IN (${sites.map((_, i) => `$${i + 1}`).join(',')})`];
    const params: unknown[] = [...sites];
    if (type) {
      params.push(type);
      conds.push(`t.type = $${params.length}`);
    }
    const where = conds.join(' AND ');

    const { rows } = await pool.query(
      `SELECT t.tx_id, t.user_id, u.nickname, t.type, t.ref_id, t.amount,
              t.balance_after, t.remark, t.created_at,
              o.order_sn, o.provider AS order_provider, o.pay_price
         FROM ingot_tx t
         JOIN "user" u ON u.user_id = t.user_id
         LEFT JOIN "order" o ON o.id::text = t.ref_id AND t.type IN ('ORDER_REBATE','REFUND_DEDUCT')
        WHERE ${where}
        ORDER BY t.tx_id DESC
        LIMIT ${size} OFFSET ${offset}`,
      params
    );
    const { rows: cntRows } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ingot_tx t JOIN "user" u ON u.user_id = t.user_id WHERE ${where}`,
      params
    );

    res.json({ ok: true, data: { items: rows, total: cntRows[0]?.total ?? 0, page, size } });
  } catch (e) {
    next(e);
  }
});
