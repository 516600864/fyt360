/**
 * 后台账户设置 + 消息中心（033 迁移，决策 #37，2026-10-03）
 *
 * 背景：顶栏账户下拉 5 项里，「个人资料 / 修改密码 / 我的操作日志」三项此前无表无端点；
 *   审计只有 admin-50 的全站视角（/api/admin/settings/audit，platformOnly 看全部人）。
 *
 * 本路由提供：
 *   GET  /api/admin/account/profile   → 读取个人资料（含可编辑 3 字段 + 角色/绑定站点派生）
 *   PATCH /api/admin/account/profile  → 改昵称/头像/邮箱（逐字段校验，写审计）
 *   GET  /api/admin/account/audit/mine→ 我的操作日志（**锁死 admin_id=自己**，无筛选无导出，
 *                                         与 50 屏全站审计是同源不同视角）
 *   GET  /api/admin/account/notifications    → 消息中心三源合并（近 30 天，LIMIT 50）
 *   POST /api/admin/account/notifications/:id/read → 标记已读
 *
 * 消息三源（本体实时派生不落库，只在 admin_notification 存已读态，见 033 迁移文件头）：
 *   order 订单异动 — 退款申请/已退款 + 核销失败 + 平台回调失败
 *   audit 审计回执 — 仅回推 admin_id = 当前用户本人的写操作，闭合决策 #32「元宝调账必须留痕」红线
 *   system 系统公告 — admin_notification(source='system') 自身即本体
 *
 * 挂载于 /api/admin/account。
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, type AdminJwtPayload } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';

export const accountAdminRouter = Router();

/** 邮箱格式（与 033 迁移的 ck_admin_user_email 同款，PG 与应用层双保险） */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** 头像仅接受 http(s) 或站内相对路径，杜绝 javascript: 伪协议 */
const AVATAR_RE = /^(https?:\/\/|\/)/;

const ROLE_LABEL: Record<string, string> = {
  platform_admin: '平台管理员',
  site_admin: '站点管理员',
  readonly: '只读运营',
};

interface ProfileRow {
  admin_id: string;
  username: string;
  nickname: string | null;
  avatar: string | null;
  email: string | null;
  role: string;
  status: string;
  must_change_password: boolean;
  created_at: string;
}

/** 绑定站点列表（admin-50 口径：admin_user_site 白名单；超管无白名单时回退「全部站点（平台工作台）」） */
async function siteListOf(admin: AdminJwtPayload, adminId: string): Promise<Array<{ code: string; name: string; scope: string }>> {
  const { rows } = await pool.query(
    `SELECT s.code, s.name
       FROM admin_user_site us
       JOIN site s ON s.site_id = us.site_id
      WHERE us.admin_id::text = $1::text
      ORDER BY s.created_at`,
    [adminId],
  );
  const list = rows.map((r) => ({ code: String(r.code), name: String(r.name), scope: '绑定站点' }));
  if (!list.length && admin.role === 'platform_admin') {
    // 平台超管本就不绑站（admin_user_site 现状 0 行），聚合视图对超管开放全部站点
    const all = await pool.query(`SELECT code, name FROM site ORDER BY created_at LIMIT 20`);
    return all.rows.map((r) => ({ code: String(r.code), name: String(r.name), scope: '平台工作台' }));
  }
  return list;
}

/** GET /api/admin/account/profile → 个人资料 */
accountAdminRouter.get('/profile', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT admin_id::text AS admin_id, username, nickname, avatar, email, role, status,
              must_change_password, created_at::text AS created_at
         FROM admin_user WHERE admin_id::text = $1::text LIMIT 1`,
      [String(req.admin!.adminId)], // 网关铁律：parameters 须全字符串
    );
    if (!rows[0]) throw new HttpError(404, '账号不存在', 'ADMIN_NOT_FOUND');
    const p = rows[0] as unknown as ProfileRow;
    res.json({
      ok: true,
      data: {
        admin_id: p.admin_id,
        username: p.username,
        // 展示名：nickname 空则回退 username（迁移注释同款口径）
        display_name: p.nickname || p.username,
        nickname: p.nickname ?? '',
        avatar: p.avatar ?? '',
        email: p.email ?? '',
        role: p.role,
        role_label: ROLE_LABEL[p.role] ?? p.role,
        status: p.status,
        must_change_password: p.must_change_password,
        created_at: p.created_at,
        sites: await siteListOf(req.admin!, p.admin_id),
      },
    });
  } catch (e) { next(e); }
});

/** PATCH /api/admin/account/profile → 改昵称/头像/邮箱（只传要改的字段） */
accountAdminRouter.patch('/profile', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const params: string[] = [];

    if (body.nickname !== undefined) {
      const nickname = String(body.nickname).trim();
      if (nickname.length > 64) throw new HttpError(400, '昵称最多 64 字', 'NICKNAME_TOO_LONG');
      params.push(nickname);
      sets.push(`nickname = $${params.length}::text`);
    }
    if (body.email !== undefined) {
      const email = String(body.email).trim();
      if (email && !EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确', 'BAD_EMAIL');
      if (email.length > 128) throw new HttpError(400, '邮箱过长', 'EMAIL_TOO_LONG');
      params.push(email);
      sets.push(`email = $${params.length}::text`);
    }
    if (body.avatar !== undefined) {
      const avatar = String(body.avatar).trim();
      if (avatar && !AVATAR_RE.test(avatar)) {
        throw new HttpError(400, '头像仅支持 http(s) 或站内路径', 'BAD_AVATAR');
      }
      params.push(avatar);
      sets.push(`avatar = $${params.length}::text`);
    }

    if (!sets.length) throw new HttpError(400, '没有需要更新的字段', 'NOTHING_TO_UPDATE');
    // 换头像/邮箱属敏感资料变更，单独记审计（决策 #37 留痕口径与元宝调账一致）
    const sensitive = body.avatar !== undefined || body.email !== undefined;
    params.push(String(req.admin!.adminId));
    const { rows } = await pool.query(
      `UPDATE admin_user SET ${sets.join(', ')}, updated_at = now()
        WHERE admin_id::text = $${params.length}::text
        RETURNING nickname, avatar, email`,
      params,
    );
    await writeAudit(req, {
      action: sensitive ? 'admin.profile_update_sensitive' : 'admin.profile_update',
      target_type: 'admin',
      target_id: req.admin!.username,
      detail: { fields: Object.keys(body).filter((k) => ['nickname', 'avatar', 'email'].includes(k)) },
    });
    const r = (rows[0] ?? {}) as Record<string, unknown>;
    res.json({ ok: true, data: { nickname: r.nickname ?? '', avatar: r.avatar ?? '', email: r.email ?? '' } });
  } catch (e) { next(e); }
});

/** GET /api/admin/account/audit/mine?days=&limit= → 我的操作日志（锁死本人） */
accountAdminRouter.get('/audit/mine', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 管理员视角只有"我自己"，故不提供 operator 参数——防越权看到他人
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const { rows } = await pool.query(
      `SELECT l.id::text AS id, l.created_at::text AS created_at,
              l.action, l.target_type, l.target_id, l.ip,
              s.code AS site_code, s.name AS site_name
         FROM admin_audit_log l
         LEFT JOIN site s ON s.site_id = l.site_id
        WHERE l.admin_id::text = $1::text
          AND l.created_at > now() - ($2::text || ' days')::interval
        ORDER BY l.created_at DESC
        LIMIT $3::int`,
      [String(req.admin!.adminId), String(days), String(limit)], // 网关铁律：parameters 须全字符串
    );
    res.json({ ok: true, data: { days, total: rows.length, items: rows } });
  } catch (e) { next(e); }
});

// ─────────────────────────── 消息中心 ───────────────────────────

interface NotifItem {
  id: string;          // 复合键：source:source_id（已读端点用）
  source: 'order' | 'audit' | 'system';
  title: string;
  desc: string;
  at: string;          // ISO 时间
  nav_key: string;     // 点击落点（menu key 协议，17 屏 v-if 平铺无路由）
  read: boolean;
}

const NAV: Record<string, string> = { order: 'orderlist', audit: 'ingot', system: 'dashboard' };

/** 三源合并。每源独立 try/catch：一源挂了不拖垮整个面板。 */
async function collectNotifications(admin: AdminJwtPayload, siteId: string | null): Promise<NotifItem[]> {
  const days = 30;
  const items: NotifItem[] = [];

  // 源① 订单异动：退款申请/已退款（refund_status <> 'none' 且非 partial 之外的中间态）
  //                     + 核销失败（verify_log.result='fail'）
  //                     + 平台回调失败（platform_status='failed'）
  try {
    const siteCond = siteId ? `AND o.site_id = $1::uuid` : '';
    const params: string[] = siteId ? [siteId] : [];
    const { rows } = await pool.query(
      // ⚠️ order 真实列：主键是 id（非 order_id），金额是 pay_price（非 amount）——001_init.sql 为准
      `SELECT o.id::text AS oid, o.order_sn, o.refund_status, o.platform_status,
              o.pay_price::text AS pay_price, o.created_at::text AS created_at
         FROM "order" o
        WHERE o.created_at > now() - ($${params.length + 1}::text || ' days')::interval
          AND (o.refund_status IN ('applying','refunded') OR o.platform_status = 'failed')
          ${siteCond}
        ORDER BY o.created_at DESC
        LIMIT 20`,
      [...params, String(days)],
    );
    for (const r of rows as Array<Record<string, unknown>>) {
      const refund = String(r.refund_status);
      const title =
        refund === 'applying' ? '退款申请待处理' : refund === 'refunded' ? '订单已退款' : '平台回调失败';
      items.push({
        id: `order:${r.oid}`,
        source: 'order',
        title,
        desc: `订单 ${r.order_sn} · ¥${r.pay_price}`,
        at: String(r.created_at),
        nav_key: NAV.order,
        read: false,
      });
    }
  } catch { /* 单源失败静默，不阻塞其余两源 */ }

  // 源①b 核销失败（独立表，仅站点管理员关心）
  try {
    const siteCond = siteId ? `AND v.site_id = $2::uuid` : '';
    const params: string[] = siteId ? ['1', siteId] : ['1'];
    const { rows } = await pool.query(
      `SELECT v.id::text AS vid, v.coupon_id::text AS cid, v.fail_reason, v.verified_at::text AS verified_at
         FROM verify_log v
        WHERE v.result = 'fail'
          AND v.verified_at > now() - ($1::text || ' days')::interval
          ${siteCond}
        ORDER BY v.verified_at DESC
        LIMIT 10`,
      params,
    );
    for (const r of rows as Array<Record<string, unknown>>) {
      items.push({
        id: `order:verify-${r.vid}`,
        source: 'order',
        title: '到店核销失败',
        desc: `券 ${r.cid} · ${r.fail_reason ?? '原因未记录'}`,
        at: String(r.verified_at),
        nav_key: 'verify',
        read: false,
      });
    }
  } catch { /* ignore */ }

  // 源② 审计回执：**仅本人**的写操作回推（决策 #32 留痕红线的闭环）
  try {
    const { rows } = await pool.query(
      `SELECT l.id::text AS lid, l.action, l.target_type, l.target_id, l.created_at::text AS created_at
         FROM admin_audit_log l
        WHERE l.admin_id::text = $1::text
          AND l.created_at > now() - ($2::text || ' days')::interval
        ORDER BY l.created_at DESC
        LIMIT 20`,
      [String(admin.adminId), String(days)],
    );
    const readable: Record<string, string> = {
      'ingot.adjust': '元宝调账已生效',
      'admin.password_change': '密码修改成功',
      'admin.profile_update': '个人资料已更新',
      'admin.profile_update_sensitive': '头像/邮箱已更新',
      'coupon.reissue': '券码已重发',
      'user.disable': '账号已禁用',
    };
    for (const r of rows as Array<Record<string, unknown>>) {
      const action = String(r.action);
      items.push({
        id: `audit:${r.lid}`,
        source: 'audit',
        title: readable[action] ?? `操作已完成 · ${action}`,
        desc: r.target_id ? `对象 ${r.target_id}` : `模块 ${r.target_type ?? '-'}`,
        at: String(r.created_at),
        nav_key: action.startsWith('ingot.') ? NAV.audit : 'account',
        read: false,
      });
    }
  } catch { /* ignore */ }

  // 源③ 系统公告（唯一本体即落在 admin_notification 的一源）
  try {
    // ⚠️ 占位符必须按 params 实际长度推，不能写死 $1：siteId 为 null 时 params 为空数组，
    //    写死 $1 会把 siteId 顶到 admin_id 的位置上（此坑已踩，表现为 500）。
    const params: string[] = [];
    const conds = [`n.source = 'system'::text`, `n.admin_id::text = $1::text`];
    params.push(String(admin.adminId));
    if (siteId) {
      params.push(siteId);
      conds.push(`n.site_id = $${params.length}::uuid`);
    }
    const { rows } = await pool.query(
      `SELECT n.id::text AS nid, n.source_id, n.read_at::text AS read_at
         FROM admin_notification n
        WHERE ${conds.join(' AND ')}
        ORDER BY n.id DESC
        LIMIT 10`,
      params,
    );
    for (const r of rows as Array<Record<string, unknown>>) {
      items.push({
        id: `system:${r.nid}`,
        source: 'system',
        title: String(r.source_id ?? '系统公告'),
        desc: '平台运营公告',
        at: String(r.read_at),
        nav_key: NAV.system,
        read: true, // 本体行即已下发，默认已读
      });
    }
  } catch { /* ignore */ }

  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50);
}

/** GET /api/admin/account/notifications?site= → 消息中心（三源合并 + 已读态回填） */
accountAdminRouter.get('/notifications', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = req.admin!;
    // 站点上下文：显式 ?site= 优先；否则超管取其白名单首站；站点角色用唯一绑定站
    let siteId: string | null = null;
    const code = String(req.query.site ?? '').trim();
    if (code) {
      const { rows } = await pool.query(`SELECT site_id::text AS site_id FROM site WHERE code = $1 LIMIT 1`, [code]);
      if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
      siteId = String(rows[0].site_id);
    } else if (admin.siteIds.length) {
      siteId = admin.siteIds[0];
    }

    const items = await collectNotifications(admin, siteId);

    // 已读态回填（只查当前人）
    // ⚠️ 不用 (source, source_id) IN ((..),(..)) 复合 IN：占位符极易编号 off-by-one
    //   （本项目已踩：$2 被重复占用 → 网关报 DATABASE_42601「行值条目数不等」→ 端点 500）。
    //   改用 JOIN UNNEST(数组, 数组)：纯数组参数，无逐行占位，行为确定。
    const readSet = new Set<string>();
    if (items.length) {
      const sources: string[] = [];
      const sourceIds: string[] = [];
      for (const it of items) {
        const [source, sourceId] = it.id.split(':');
        sources.push(source);
        sourceIds.push(sourceId);
      }
      const { rows } = await pool.query(
        `SELECT n.source, n.source_id
           FROM admin_notification n
           JOIN UNNEST($2::text[], $3::text[]) AS t(source, source_id)
             ON n.source = t.source AND n.source_id = t.source_id
          WHERE n.admin_id::text = $1::text`,
        [String(admin.adminId), sources, sourceIds],
      );
      for (const r of rows as Array<Record<string, unknown>>) {
        readSet.add(`${String(r.source)}:${String(r.source_id)}`);
      }
    }
    for (const it of items) it.read = readSet.has(it.id);

    res.json({
      ok: true,
      data: {
        // MVP 只需知道有无未读（圆点），不返回数字角标计数
        has_unread: items.some((i) => !i.read),
        total: items.length,
        counts: {
          all: items.length,
          order: items.filter((i) => i.source === 'order').length,
          audit: items.filter((i) => i.source === 'audit').length,
          system: items.filter((i) => i.source === 'system').length,
        },
        items,
      },
    });
  } catch (e) { next(e); }
});

/** POST /api/admin/account/notifications/read → 批量标记已读（body: { ids: string[] }，复合键 source:source_id） */
accountAdminRouter.post('/notifications/read', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).slice(0, 200) : [];
    const pairs = ids
      .map((raw) => String(raw).split(':'))
      .filter((p): p is [string, string] => p.length === 2 && ['order', 'audit', 'system'].includes(p[0]));
    if (!pairs.length) throw new HttpError(400, '没有可标记的通知', 'NOTHING_TO_READ');

    // ⚠️ 两处网关铁律（2026-10-03 实测，均报 42804/42601）：
    //   ① INSERT 的 bigint 列（admin_id）**不能写 ::text cast**，否则报
    //      "column admin_id is of type bigint but expression is of type text"（42P18 家族）。
    //      cast 走 42P18 的坑在 WHERE（比较）侧，VALUES 侧只需字符串传参由网关推断。
    //   ② 复合 VALUES 的占位符必须逐行递增，不能重复用 $1。
    const values = pairs.map((_, i) => `($1, $${2 + i * 2}::text, $${3 + i * 2}::text)`).join(', ');
    const params: string[] = [String(req.admin!.adminId)];
    for (const [source, sourceId] of pairs) params.push(source, sourceId);
    const { rows } = await pool.query(
      // ⚠️ 必须 RETURNING：网关 rowCount = rows.length，判影响行数不给 RETURNING 恒为 0
      `INSERT INTO admin_notification (admin_id, source, source_id)
       VALUES ${values}
       ON CONFLICT (admin_id, source, source_id) DO UPDATE SET read_at = now()
       RETURNING id::text AS id`,
      params,
    );
    res.json({ ok: true, data: { marked: rows.length } });
  } catch (e) { next(e); }
});
