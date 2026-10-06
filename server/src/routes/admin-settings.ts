/**
 * 系统设置（admin-50，平台超管 only）：供应商凭据矩阵 / RBAC 角色 / 管理员账号 CRUD / 操作日志。
 * 数据面：provider_config（凭据跟 site_id 走，决策#25①）、role（001 三内置角色）、
 *        admin_user + admin_user_site、admin_audit_log（001 已建，本文件首接读写）。
 * 安全：apikey/api_secret 永不回传原文（掩码+布尔）；审计只记成功写操作。
 */
import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';

export const settingsRouter = Router();

const PROVIDERS = ['mayixingqiu', 'wechat_mini', 'wechat_mp'] as const;
const maskKey = (v: string | null) =>
  v ? (v.length > 10 ? `${v.slice(0, 3)}•••••${v.slice(-4)}` : '••••') : '';
const maskAppid = (v: string | null) =>
  v ? (v.length > 8 ? `${v.slice(0, 2)}••••••${v.slice(-3)}` : '••••') : '';

/** 平台超管 only（系统设置 platformOnly，服务端强制） */
function requirePlatform(req: Request, _res: Response, next: NextFunction): void {
  if (req.admin?.role !== 'platform_admin') {
    next(new HttpError(403, '系统设置仅平台超管可访问', 'PLATFORM_ONLY'));
    return;
  }
  next();
}

settingsRouter.use(requireAdmin, requirePlatform);

/** GET /api/admin/settings/overview → 凭据矩阵（站点 tab 数据源）+ 审计概览 */
settingsRouter.get('/overview', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.site_id::text AS site_id, s.code, s.name,
              pc.provider, pc.apikey, pc.api_secret, pc.status AS pc_status, pc.updated_at
         FROM site s
         LEFT JOIN provider_config pc ON pc.site_id = s.site_id
        ORDER BY s.created_at`,
    );
    const bySite = new Map<string, any>();
    for (const r of rows) {
      if (!bySite.has(r.site_id)) {
        bySite.set(r.site_id, { site_id: r.site_id, code: r.code, name: r.name, providers: {} });
      }
      if (r.provider) {
        bySite.get(r.site_id).providers[r.provider] = {
          configured: true,
          key_masked: maskKey(r.apikey),
          appid_masked: r.provider === 'wechat_mini' ? maskAppid(r.apikey) : '',
          has_secret: r.api_secret != null && String(r.api_secret).length > 0,
          status: r.pc_status,
          updated_at: r.updated_at ?? null,
        };
      }
    }
    const sites = [...bySite.values()].map((s: any) => ({
      ...s,
      providers: Object.fromEntries(PROVIDERS.map((p) => [p, s.providers[p] ?? { configured: false, key_masked: '', appid_masked: '', has_secret: false, status: '', updated_at: null }])),
    }));

    let audit = { total: 0, last_30d: 0, latest_at: null as string | null };
    try {
      const { rows: a } = await pool.query(
        `SELECT count(*)::int AS n, max(created_at)::text AS latest FROM admin_audit_log`,
      );
      const { rows: d } = await pool.query(
        `SELECT count(*)::int AS n FROM admin_audit_log WHERE created_at > now() - interval '30 days'`,
      );
      audit = { total: a[0]?.n ?? 0, last_30d: d[0]?.n ?? 0, latest_at: a[0]?.latest ?? null };
    } catch { /* 表未就绪，诚实归零 */ }

    res.json({ ok: true, data: { providers: PROVIDERS, sites, audit } });
  } catch (e) { next(e); }
});

/** GET /api/admin/settings/roles → 内置角色（RBAC 矩阵数据源） */
settingsRouter.get('/roles', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(`SELECT role_code, name, permissions FROM role ORDER BY role_code`);
    res.json({ ok: true, data: { roles: rows.map((r) => ({ ...r, builtin: true, permissions: r.permissions ?? [] })) } });
  } catch (e) { next(e); }
});

/** GET /api/admin/settings/admins → 账号列表 + 绑定站点 */
settingsRouter.get('/admins', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.admin_id::text AS admin_id, a.username, a.role, a.status, a.must_change_password, a.created_at::text AS created_at,
              COALESCE(json_agg(s.name ORDER BY s.created_at) FILTER (WHERE s.site_id IS NOT NULL), '[]') AS sites
         FROM admin_user a
         LEFT JOIN admin_user_site us ON us.admin_id = a.admin_id
         LEFT JOIN site s ON s.site_id = us.site_id
        GROUP BY a.admin_id, a.username, a.role, a.status, a.must_change_password, a.created_at
        ORDER BY a.created_at`,
    );
    res.json({ ok: true, data: { admins: rows } });
  } catch (e) { next(e); }
});

const ROLE_RE = /^[a-z_]{3,32}$/;

/** POST /api/admin/settings/admins — 新建账号 {username, password, role, site_ids[]} */
settingsRouter.post('/admins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '');
    const role = String(req.body?.role ?? '').trim();
    const siteIds: string[] = Array.isArray(req.body?.site_ids) ? req.body.site_ids.map(String) : [];
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) throw new HttpError(400, '用户名须 3~32 位字母数字-_', 'BAD_USERNAME');
    if (password.length < 8) throw new HttpError(400, '初始密码至少 8 位', 'BAD_PASSWORD');
    if (!ROLE_RE.test(role)) throw new HttpError(400, '角色非法', 'BAD_ROLE');
    const { rows: roleRows } = await pool.query(`SELECT role_code FROM role WHERE role_code = $1::text LIMIT 1`, [role]);
    if (!roleRows[0]) throw new HttpError(400, '角色不存在', 'ROLE_NOT_FOUND');
    // ⛔ 站点绑定**不再强制**：原「站点角色须绑定至少一个站点」与「建站必须选负责人」
    //   构成死锁（建站要人 → 建人要站 → 站不存在 → 建不了人），2026-10-05 破环。
    //   正确顺序：先建空账号 → 建无主站 → 把账号加为成员并「设为负责人」。
    //   空账号登录后 siteIds=[]，前端显式提示「尚未分配站点」，不崩不锁死。

    const dup = await pool.query(`SELECT 1 FROM admin_user WHERE username = $1::text LIMIT 1`, [username]);
    if (dup.rows[0]) throw new HttpError(409, '用户名已存在', 'USERNAME_TAKEN');

    const { rows: created } = await pool.query(
      `INSERT INTO admin_user (username, password_hash, role, must_change_password)
       VALUES ($1::text, $2::text, $3::text, TRUE) RETURNING admin_id::text AS id`,
      [username, await bcrypt.hash(password, 10), role],
    );
    const adminId = created[0].id;
    for (const sid of siteIds) {
      await pool.query(
        `INSERT INTO admin_user_site (admin_id, site_id) VALUES ($1::bigint, $2::uuid) ON CONFLICT DO NOTHING`,
        [adminId, sid],
      );
    }
    await writeAudit(req, { action: 'admin.create', target_type: 'admin', target_id: username, detail: { role, sites: siteIds.length } });
    res.json({ ok: true, data: { admin_id: adminId } });
  } catch (e) { next(e); }
});

/** PUT /api/admin/settings/admins/:id — 编辑 {role?, site_ids?, status?, password?}；禁止改自己的角色/状态 */
settingsRouter.put('/admins/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const { rows: cur } = await pool.query(`SELECT admin_id::text AS id, username, role, status FROM admin_user WHERE admin_id::text = $1::text LIMIT 1`, [id]);
    if (!cur[0]) throw new HttpError(404, '账号不存在', 'ADMIN_NOT_FOUND');
    if (id === String(req.admin!.adminId) && (req.body?.role !== undefined || req.body?.status !== undefined)) {
      throw new HttpError(400, '不能修改自己的角色或状态（防锁死）', 'SELF_LOCKOUT');
    }

    const role = req.body?.role !== undefined ? String(req.body.role) : cur[0].role;
    if (!ROLE_RE.test(role)) throw new HttpError(400, '角色非法', 'BAD_ROLE');
    const status = ['active', 'disabled'].includes(String(req.body?.status)) ? String(req.body.status) : cur[0].status;

    await pool.query(`UPDATE admin_user SET role = $1::text, status = $2::text, updated_at = now() WHERE admin_id::text = $3::text`, [role, status, id]);

    if (Array.isArray(req.body?.site_ids)) {
      const siteIds: string[] = req.body.site_ids.map(String);
      await pool.query(`DELETE FROM admin_user_site WHERE admin_id::text = $1::text`, [id]);
      for (const sid of siteIds) {
        await pool.query(
          `INSERT INTO admin_user_site (admin_id, site_id) VALUES ($1::bigint, $2::uuid) ON CONFLICT DO NOTHING`,
          [id, sid],
        );
      }
    }

    let pwdReset = false;
    if (req.body?.password) {
      const pwd = String(req.body.password);
      if (pwd.length < 8) throw new HttpError(400, '重置密码至少 8 位', 'BAD_PASSWORD');
      await pool.query(`UPDATE admin_user SET password_hash = $1::text, must_change_password = TRUE, updated_at = now() WHERE admin_id::text = $2::text`, [
        await bcrypt.hash(pwd, 10), id,
      ]);
      pwdReset = true;
    }

    await writeAudit(req, { action: pwdReset ? 'admin.reset_password' : 'admin.update', target_type: 'admin', target_id: cur[0].username, detail: { role, status } });
    res.json({ ok: true, data: { admin_id: id } });
  } catch (e) { next(e); }
});

const MODULES = ['auth', 'provider', 'payment', 'tabbar', 'schema', 'admin'];

/** GET /api/admin/settings/audit?operator=&module=&site=&days=&limit= → 操作日志 */
settingsRouter.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const conds: string[] = [];
    const params: string[] = [];
    if (req.query.operator) { params.push(String(req.query.operator)); conds.push(`a.username = $${params.length}::text`); }
    if (req.query.module && MODULES.includes(String(req.query.module))) { params.push(String(req.query.module)); conds.push(`l.target_type = $${params.length}::text`); }
    if (req.query.site) { params.push(String(req.query.site)); conds.push(`l.site_id::text = $${params.length}::text`); }
    const days = Math.min(Math.max(Number(req.query.days) || 0, 0), 365);
    if (days > 0) { params.push(String(days)); conds.push(`l.created_at > now() - ($${params.length}::text || ' days')::interval`); }
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    params.push(String(limit));

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT l.id::text AS id, l.created_at::text AS created_at, a.username,
              s.code AS site_code, s.name AS site_name,
              l.action, l.target_type, l.target_id, l.ip
         FROM admin_audit_log l
         LEFT JOIN admin_user a ON a.admin_id = l.admin_id
         LEFT JOIN site s ON s.site_id = l.site_id
        ${where}
        ORDER BY l.created_at DESC
        LIMIT $${params.length}::int`,
      params,
    );
    res.json({ ok: true, data: { items: rows, modules: MODULES } });
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════
// ⑤ 企业微信客服（迁移 040，D先生 2026-10-05）
// ══════════════════════════════════════════════════════════════
// 存储：site.kf_corp_id / kf_url / kf_status（**跟 site_id 走**，决策#27 站点隔离）
//   ⛔ 不塞 provider_config —— 那张表是「上游供给方凭据」（蚂蚁星球/微信开放平台），
//      企微客服是我方自有服务通道，混进去会让「供应商凭据」矩阵出现非供应商条目。
//
// 客服链接含 token（work.weixin.qq.com/kfid/...?token=xxx），属半敏感凭据：
//   管理台读写均回显完整串（超管自己填自己看），但**列表态掩码**；
//   C 端公开只读接口才完整下发（端上要拿它真跳转）。
const maskKfUrl = (v: string | null) => {
  if (!v) return '';
  // 保留域名前缀 + 尾部 6 位，足够辨认是哪个客服账号
  const tail = v.slice(-6);
  return `${v.slice(0, 30)}•••••${tail}`;
};

/** corpId 格式：企业微信企业 ID 形如 ww + 16 位十六进制（大小写混写合法）。
 *  这里只做**形状**校验，不做真实性校验——填错了只能在小程序端表现为「ID 不一致」，
 *  服务端无法离线验真（要调微信接口才有意义，而那是无谓的外部依赖）。 */
function parseKfCorpId(v: unknown): string | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim().replace(/\s/g, ''); // ⛔ 前后/中间空格会让微信报「ID 不一致」（官方已知坑）
  if (!/^ww[0-9a-zA-Z]{10,32}$/.test(s)) {
    throw new HttpError(400, '企业ID 形如 ww 开头的一串字符（企业微信「我的企业」→ 企业信息 可复制）', 'BAD_KF_CORP_ID');
  }
  return s;
}

/** 客服链接：必须是企业微信官方域名。
 *  ⛔ 域名白名单是安全边界——端上会直接跳转/把它交给微信 SDK，
 *    放任任意 URL 等于把端上变成任意跳转器（可被用于钓鱼外链）。 */
function parseKfUrl(v: unknown): string | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  let u: URL;
  try { u = new URL(s); } catch { throw new HttpError(400, '客服链接格式不合法（应为 https://work.weixin.qq.com/kfid/... 完整链接）', 'BAD_KF_URL'); }
  if (u.protocol !== 'https:') throw new HttpError(400, '客服链接必须 https', 'BAD_KF_URL');
  const ok = u.hostname === 'work.weixin.qq.com'
    || u.hostname === 'work.weixin.qq.com.cn'
    || u.hostname.endsWith('.weixin.qq.com');
  if (!ok) throw new HttpError(400, '客服链接仅允许企业微信官方域名（work.weixin.qq.com）', 'BAD_KF_URL');
  return s;
}

/** GET /api/admin/settings/kf?site_id=xxx → 该站点客服配置（链接掩码回显） */
settingsRouter.get('/kf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = String(req.query.site_id ?? '');
    if (!siteId) throw new HttpError(400, '须指定 site_id（客服配置跟站点走）', 'SITE_REQUIRED');
    const { rows } = await pool.query(
      `SELECT site_id::text AS site_id, code, name, kf_corp_id, kf_url, kf_status
         FROM site WHERE site_id = $1::uuid LIMIT 1`,
      [siteId],
    );
    if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    res.json({
      ok: true,
      data: {
        site_id: rows[0].site_id,
        code: rows[0].code,
        name: rows[0].name,
        corp_id: rows[0].kf_corp_id,
        kf_url: rows[0].kf_url,                    // 完整串：超管自己填自己看
        kf_url_masked: maskKfUrl(rows[0].kf_url),  // 列表/日志里用这个
        status: rows[0].kf_status,
        // 开通前置条件：corpId 与客服链接缺一不可（缺任一端上必然呼不起）
        can_enable: Boolean(rows[0].kf_corp_id && rows[0].kf_url),
      },
    });
  } catch (e) { next(e); }
});

/** POST /api/admin/settings/kf → 保存客服配置 */
settingsRouter.post('/kf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const siteId = String(b.site_id ?? '');
    if (!siteId) throw new HttpError(400, '须指定 site_id（客服配置跟站点走）', 'SITE_REQUIRED');

    const corpId = parseKfCorpId(b.corp_id);
    const kfUrl = parseKfUrl(b.kf_url);
    let status = b.status === 'active' ? 'active' : 'disabled';
    // ⛔ 缺项时强制 disabled：标成 active 只会让端上点了没反应（比明确未开通更难排查）
    if (!corpId || !kfUrl) {
      if (status === 'active') {
        throw new HttpError(400, '企业ID 与客服链接都填了才能开通（小程序端需要企业ID，H5 端需要客服链接）', 'KF_INCOMPLETE');
      }
      status = 'disabled';
    }

    const { rows } = await pool.query(
      `UPDATE site SET kf_corp_id = $2::varchar, kf_url = $3::text, kf_status = $4::varchar
        WHERE site_id = $1::uuid
      RETURNING site_id::text AS site_id, code, name, kf_corp_id, kf_url, kf_status`,
      [siteId, corpId, kfUrl, status],
    );
    if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');

    await writeAudit(req, {
      site_id: siteId,
      action: 'settings.kf_save',
      target_type: 'settings',
      target_id: rows[0].code,
      detail: { status, corp_id_masked: maskAppid(corpId), kf_url_masked: maskKfUrl(kfUrl) },
    });

    res.json({
      ok: true,
      data: {
        ...rows[0],
        kf_url_masked: maskKfUrl(kfUrl),
        can_enable: Boolean(corpId && kfUrl),
      },
    });
  } catch (e) { next(e); }
});
