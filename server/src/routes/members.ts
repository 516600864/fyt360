/**
 * 会员管理（51 屏）+ 用户详情抽屉（39B）：
 *   GET    /              列表：q（user_id/昵称/openid）/状态/等级/核销员筛选 + 分页
 *   GET    /:id           360 视图：头部身份 + 统计四宫格（元宝/订单/佣金/团队）
 *   GET    /:id/orders    域·订单
 *   GET    /:id/txs       域·元宝流水
 *   GET    /:id/coupons   域·券包
 *   GET    /:id/verifies  域·核销记录（该用户作为核销员的操作记录）
 *   POST   /:id/adjust    元宝调账（ingot_tx ADMIN_ADJUST 留痕 + admin_audit_log，禁直接改余额）
 *   POST   /:id/status    禁用/启用（禁用即时拦截静默登录）
 * 红线（决策 #32）：调账走流水补记留痕，禁止直接改余额；禁用即时拦截静默登录。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';

export const membersRouter = Router();

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

/** 站点 IN 段 + 参数（参数全字符串，网关铁律） */
function siteScopeSql(sites: string[]): { ph: string; params: string[] } {
  const params = sites.map(String);
  return { ph: params.map((_, i) => `$${i + 1}`).join(','), params };
}

/** 列表/详情共用的用户宽SELECT（等级/元宝/订单数/佣金/核销员章） */
const USER_SELECT = `
  u.user_id, u.nickname, u.avatar, u.status, u.created_at, u.invite_code,
  s.code AS site_code, s.name AS site_name,
  ml.code AS level_code, ml.name AS level_name,
  COALESCE(ia.balance, 0)::int AS ingot_balance,
  (SELECT COUNT(*)::int FROM "order" o WHERE o.buyer_id = u.user_id) AS order_count,
  COALESCE(p.commission_balance, 0)::float AS commission_balance,
  (SELECT COALESCE(SUM(cf.amount), 0)::float FROM commission_flow cf
    WHERE cf.user_id = u.user_id AND cf.status <> 'invalid') AS commission_total,
  EXISTS (SELECT 1 FROM verify_agent va WHERE va.user_id = u.user_id AND va.status = 'active') AS is_verifier,
  (SELECT COUNT(*)::int FROM "user" c WHERE c.parent_id = u.user_id) AS team_size
`;

/** GET /api/admin/members?q=&status=&level=&verifier=&site=&page=&size= */
membersRouter.get('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const { ph, params } = siteScopeSql(sites);
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(String(req.query.size ?? '20'), 10) || 20));

    let extra = '';
    if (String(req.query.q ?? '').trim()) {
      const q = String(req.query.q).trim();
      if (/^\d+$/.test(q)) {
        params.push(q);
        extra += ` AND u.user_id = $${params.length}::bigint`;
      } else {
        params.push(`%${q}%`);
        const k = `$${params.length}`;
        extra += ` AND (u.nickname ILIKE ${k} OR u.openid ILIKE ${k} OR u.h5_openid ILIKE ${k} OR u.invite_code ILIKE ${k})`;
      }
    }
    if (['active', 'banned'].includes(String(req.query.status))) {
      params.push(String(req.query.status));
      extra += ` AND u.status = $${params.length}`;
    }
    if (/^L[123]$/.test(String(req.query.level ?? ''))) {
      params.push(String(req.query.level));
      extra += ` AND ml.code = $${params.length}`;
    }
    if (String(req.query.verifier) === '1') extra += ` AND EXISTS (SELECT 1 FROM verify_agent va WHERE va.user_id = u.user_id AND va.status = 'active')`;

    const { rows } = await pool.query(
      `SELECT ${USER_SELECT}
         FROM "user" u
         JOIN site s ON s.site_id = u.site_id
         LEFT JOIN member m ON m.user_id = u.user_id
         LEFT JOIN member_level ml ON ml.level_id = m.level_id
         LEFT JOIN ingot_account ia ON ia.user_id = u.user_id
         LEFT JOIN promoter p ON p.user_id = u.user_id
        WHERE u.site_id IN (${ph})${extra}
        ORDER BY u.user_id DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (page - 1) * size]
    );

    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM verify_agent va WHERE va.user_id = u.user_id AND va.status = 'active'))::int AS verifiers,
              COUNT(*) FILTER (WHERE u.status = 'banned')::int AS banned_cnt
         FROM "user" u
         LEFT JOIN member m ON m.user_id = u.user_id
         LEFT JOIN member_level ml ON ml.level_id = m.level_id
        WHERE u.site_id IN (${ph})${extra}`,
      params
    );

    res.json({
      ok: true,
      data: {
        items: rows.map((r) => ({
          user_id: Number(r.user_id),
          nickname: r.nickname ?? `用户#${r.user_id}`,
          avatar: r.avatar ?? null,
          status: r.status,
          created_at: r.created_at,
          invite_code: r.invite_code ?? null,
          site_code: r.site_code,
          site_name: r.site_name,
          level: r.level_code ?? 'L1',
          level_name: r.level_name ?? '省心会员',
          ingot_balance: r.ingot_balance,
          order_count: r.order_count,
          commission_balance: r.commission_balance,
          commission_total: r.commission_total,
          is_verifier: !!r.is_verifier,
        })),
        total: cnt[0]?.total ?? 0,
        verifiers: cnt[0]?.verifiers ?? 0,
        banned_cnt: cnt[0]?.banned_cnt ?? 0,
        page,
        size,
      },
    });
  } catch (e) { next(e); }
});

/** 加载单用户（站点权限校验） */
async function loadUser(sites: string[], idRaw: string) {
  const id = String(parseInt(idRaw, 10) || 0);
  if (id === '0') throw new HttpError(400, '无效用户 ID', 'BAD_REQUEST');
  const { ph, params } = siteScopeSql(sites);
  params.push(id);
  const { rows } = await pool.query(
    `SELECT ${USER_SELECT}, u.openid, u.unionid, u.h5_openid, u.parent_id, u.grand_id
       FROM "user" u
       JOIN site s ON s.site_id = u.site_id
       LEFT JOIN member m ON m.user_id = u.user_id
       LEFT JOIN member_level ml ON ml.level_id = m.level_id
       LEFT JOIN ingot_account ia ON ia.user_id = u.user_id
       LEFT JOIN promoter p ON p.user_id = u.user_id
      WHERE u.site_id IN (${ph}) AND u.user_id = $${params.length}::bigint LIMIT 1`,
    params
  );
  if (!rows[0]) throw new HttpError(404, '用户不存在或无权查看', 'USER_NOT_FOUND');
  return rows[0];
}

/** GET /api/admin/members/:id → 360 视图头部 + 统计四宫格 */
membersRouter.get('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const r = await loadUser(sites, req.params.id);
    res.json({
      ok: true,
      data: {
        user_id: Number(r.user_id),
        nickname: r.nickname ?? `用户#${r.user_id}`,
        avatar: r.avatar ?? null,
        openid: r.openid ?? null,
        unionid: r.unionid ?? null,
        h5_openid: r.h5_openid ?? null,
        invite_code: r.invite_code ?? null,
        parent_id: r.parent_id ? Number(r.parent_id) : null,
        status: r.status,
        created_at: r.created_at,
        site_code: r.site_code,
        site_name: r.site_name,
        level: r.level_code ?? 'L1',
        level_name: r.level_name ?? '省心会员',
        is_verifier: !!r.is_verifier,
        stats: {
          ingot_balance: r.ingot_balance,
          order_count: r.order_count,
          commission_total: r.commission_total,
          team_size: r.team_size,
        },
      },
    });
  } catch (e) { next(e); }
});

/** 分页工具（子资源共用） */
function pageArgs(req: Request, params: unknown[], sizeDefault = 10) {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const size = Math.min(50, Math.max(1, parseInt(String(req.query.size ?? String(sizeDefault)), 10) || sizeDefault));
  params.push(size, (page - 1) * size);
  return { page, size, limitPh: `$${params.length - 1}`, offsetPh: `$${params.length}` };
}

/** GET /:id/orders?tab= 域·订单（buyer 视角） */
membersRouter.get('/:id/orders', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const u = await loadUser(sites, req.params.id);
    const { ph, params } = siteScopeSql(sites);
    params.push(String(u.user_id));
    const uidPh = `$${params.length}`;
    const { page, size, limitPh, offsetPh } = pageArgs(req, params);
    const { rows } = await pool.query(
      `SELECT o.order_sn, o.provider, o.provider_order_sn, o.pay_price::float AS pay_price,
              o.commission::float AS commission, o.platform_status, o.fulfill_status, o.refund_status,
              o.goods_snapshot->>'title' AS goods_title, o.created_at
         FROM "order" o
        WHERE o.site_id IN (${ph}) AND o.buyer_id = ${uidPh}::bigint
        ORDER BY o.created_at DESC
        LIMIT ${limitPh} OFFSET ${offsetPh}`,
      params
    );
    res.json({ ok: true, data: { items: rows, page, size } });
  } catch (e) { next(e); }
});

/** GET /:id/txs 域·元宝流水 */
membersRouter.get('/:id/txs', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const u = await loadUser(sites, req.params.id);
    const params: unknown[] = [Number(u.user_id)];
    const { page, size, limitPh, offsetPh } = pageArgs(req, params);
    const { rows } = await pool.query(
      `SELECT type, ref_id, amount, balance_after, remark, created_at
         FROM ingot_tx
        WHERE user_id = $1::bigint
        ORDER BY created_at DESC
        LIMIT ${limitPh} OFFSET ${offsetPh}`,
      params
    );
    res.json({ ok: true, data: { items: rows, page, size } });
  } catch (e) { next(e); }
});

/** GET /:id/coupons 域·券包 */
membersRouter.get('/:id/coupons', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const u = await loadUser(sites, req.params.id);
    const { ph, params } = siteScopeSql(sites);
    params.push(String(u.user_id));
    const uidPh = `$${params.length}`;
    const { page, size, limitPh, offsetPh } = pageArgs(req, params);
    const { rows } = await pool.query(
      `SELECT uc.id, c.name, c.type, c.amount::float AS amount, c.threshold::float AS threshold,
              uc.status, uc.received_at, uc.used_order_id
         FROM user_coupon uc
         JOIN coupon c ON c.id = uc.coupon_id
        WHERE uc.user_id = ${uidPh}::bigint AND c.site_id IN (${ph})
        ORDER BY uc.received_at DESC
        LIMIT ${limitPh} OFFSET ${offsetPh}`,
      params
    );
    res.json({ ok: true, data: { items: rows, page, size } });
  } catch (e) { next(e); }
});

/** GET /:id/codes 域·核销券码（重发券码数据源：该用户全部团购券码 + 核销进度） */
membersRouter.get('/:id/codes', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const u = await loadUser(sites, req.params.id);
    const { ph, params } = siteScopeSql(sites);
    params.push(String(u.user_id));
    const uidPh = `$${params.length}`;
    const { rows } = await pool.query(
      `SELECT gc.coupon_id, gc.code, gc.total_times, gc.used_times, gc.status, gc.expire_at, gc.created_at,
              o.order_sn, o.goods_snapshot->>'title' AS goods_title
         FROM group_coupon gc
         JOIN "order" o ON o.id = gc.order_id
        WHERE o.buyer_id = ${uidPh}::bigint AND o.site_id IN (${ph})
        ORDER BY gc.created_at DESC
        LIMIT 100`,
      params
    );
    res.json({ ok: true, data: { items: rows } });
  } catch (e) { next(e); }
});

/** GET /:id/verifies 域·核销记录（该用户作为核销员的操作） */
membersRouter.get('/:id/verifies', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const u = await loadUser(sites, req.params.id);
    const params: unknown[] = [Number(u.user_id)];
    const { page, size, limitPh, offsetPh } = pageArgs(req, params);
    const { rows } = await pool.query(
      `SELECT vl.id, vl.order_id, vl.times, vl.result, vl.fail_reason, vl.verified_at,
              gc.code AS coupon_code
         FROM verify_log vl
         LEFT JOIN group_coupon gc ON gc.coupon_id = vl.coupon_id
        WHERE vl.verifier_user_id = $1::bigint
        ORDER BY vl.verified_at DESC
        LIMIT ${limitPh} OFFSET ${offsetPh}`,
      params
    );
    res.json({ ok: true, data: { items: rows, page, size } });
  } catch (e) { next(e); }
});

/** POST /:id/adjust { amount: ±int, remark } → 单语句 CTE 原子调账（余额不足整单失败）+ 双留痕 */
membersRouter.post('/:id/adjust', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const u = await loadUser(sites, req.params.id);
    const amount = parseInt(String(req.body?.amount ?? ''), 10);
    const remark = String(req.body?.remark ?? '').trim();
    if (!Number.isInteger(amount) || amount === 0) throw new HttpError(400, '调账额度须为非零整数', 'BAD_REQUEST');
    if (Math.abs(amount) > 1000000) throw new HttpError(400, '单笔调账超出上限', 'BAD_REQUEST');
    if (!remark) throw new HttpError(400, '调账必须填写原因（留痕）', 'BAD_REQUEST');

    const refId = `ADJ-${Date.now()}`;
    const { rows: done } = await pool.query(
      `WITH upd AS (
         UPDATE ingot_account SET balance = balance + $3::int, updated_at = now()
          WHERE user_id = $1::bigint AND balance + $3::int >= 0
         RETURNING balance
       )
       INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
       SELECT $1::bigint, 'ADMIN_ADJUST', $2, $3::int, balance, $4 FROM upd
       RETURNING tx_id`,
      [Number(u.user_id), refId, amount, `[管理员调账] ${remark}`]
    );
    if (!done[0]) throw new HttpError(409, '余额不足，扣减失败', 'INGOT_INSUFFICIENT');

    const { rows: acc } = await pool.query(
      `SELECT balance::int AS balance FROM ingot_account WHERE user_id = $1::bigint`,
      [Number(u.user_id)]
    );
    await writeAudit(req, {
      action: 'member.adjust',
      target_type: 'member',
      target_id: String(u.user_id),
      site_id: sites.length === 1 ? sites[0] : null,
      detail: { amount, remark, ref_id: refId, balance_after: acc[0]?.balance ?? null },
    });
    res.json({ ok: true, data: { balance_after: acc[0]?.balance ?? null, ref_id: refId } });
  } catch (e) { next(e); }
});

/** POST /:id/deregister → 处理注销：匿名化资料 + 禁用（不可恢复），双留痕 */
membersRouter.post('/:id/deregister', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const u = await loadUser(sites, req.params.id);
    if (u.status === 'banned' && u.nickname === '已注销用户') {
      throw new HttpError(409, '该用户已注销', 'ALREADY_DEREGISTERED');
    }
    // 单语句原子：匿名化 + 禁用（清空 openid/unionid 使静默登录永久无法命中该记录）
    await pool.query(
      `UPDATE "user" SET nickname = '已注销用户', avatar = NULL, openid = NULL, unionid = NULL,
              h5_openid = NULL, status = 'banned'
        WHERE user_id = $1::bigint`,
      [Number(u.user_id)]
    );
    await writeAudit(req, {
      action: 'member.deregister',
      target_type: 'member',
      target_id: String(u.user_id),
      site_id: sites.length === 1 ? sites[0] : null,
      detail: { former_nickname: u.nickname },
    });
    res.json({ ok: true, data: { status: 'banned', anonymized: true } });
  } catch (e) { next(e); }
});

/** POST /:id/status { status: 'banned'|'active' } → 禁用即时拦截静默登录 */
membersRouter.post('/:id/status', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const u = await loadUser(sites, req.params.id);
    const status = String(req.body?.status ?? '');
    if (!['active', 'banned'].includes(status)) throw new HttpError(400, '状态须为 active/banned', 'BAD_REQUEST');
    if (status === 'banned' && req.admin!.adminId === Number(u.user_id)) {
      throw new HttpError(400, '不能禁用自己', 'BAD_REQUEST');
    }
    await pool.query(`UPDATE "user" SET status = $2 WHERE user_id = $1::bigint`, [Number(u.user_id), status]);
    await writeAudit(req, {
      action: status === 'banned' ? 'member.ban' : 'member.unban',
      target_type: 'member',
      target_id: String(u.user_id),
      site_id: sites.length === 1 ? sites[0] : null,
      detail: { nickname: u.nickname },
    });
    res.json({ ok: true, data: { status } });
  } catch (e) { next(e); }
});
