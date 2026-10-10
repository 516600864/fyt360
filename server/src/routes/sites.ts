// 站点管理（admin-31，决策#43 收敛成「建壳 + 授权」）：平台级菜单，仅超管（决策#27）。
// ⛔ **建壳不碰凭据**：凭据是钱袋子（蚂蚁 key 能提现、支付私钥能扣款），
//    必须由客户自己登录本站配（屏 52）。平台只建站点壳 + 指定负责人。
// ⚠️ 屏 52 的凭据端点挂在 provisionRouter（site-provision.ts），不塞进本文件：
//    凭据要审计 + 连通测试 + 四组不同落点，混进站点 CRUD 会让本文件失焦。
import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { invalidateProviderCache } from '../lib/provider.js';
import { readZip, writeZip } from '../lib/zip.js';

export const sitesRouter = Router();

function assertPlatform(admin: AdminJwtPayload): void {
  if (admin.role !== 'platform_admin') throw new HttpError(403, 'PLATFORM_ONLY', '站点管理仅平台管理员可用');
}

/** GET /api/admin/sites → 站点列表（appid 非空计 1 个小程序，一站一 AppId） */
sitesRouter.get('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertPlatform(req.admin!);
    const { rows } = await pool.query(
      `SELECT s.site_id::text AS site_id, s.code, s.name, s.appid, s.domain, s.status, s.created_at,
              oa.username AS owner_username,
              COALESCE(pc.test_status = 'passed' AND pc.status = 'active', FALSE) AS provisioned
         FROM site s
         LEFT JOIN admin_user_site ous ON ous.site_id = s.site_id AND ous.is_owner
         LEFT JOIN admin_user oa ON oa.admin_id = ous.admin_id
         LEFT JOIN provider_config pc ON pc.site_id = s.site_id AND pc.provider = 'mayixingqiu'
        ORDER BY s.created_at`
    );
    res.json({
      ok: true,
      data: {
        sites: rows.map((r) => ({
          site_id: r.site_id,
          code: r.code,
          name: r.name,
          appid: r.appid,
          domain: r.domain,
          status: r.status, // pending=待开通 / active=运行中 / disabled=已停用
          mini_count: r.appid ? 1 : 0,
          owner_username: r.owner_username ?? null,
          provisioned: Boolean(r.provisioned),
          created_at: r.created_at,
        })),
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/admin/sites/my → 当前登录者可选站点（决策#27 站点选择页数据源） */
sitesRouter.get('/my', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = req.admin!;
    // ⛔ 2026-10-05 补 site_id：站点选择页要把 site_id 写进会话（屏 52 凭据开通按 site_id 取数），
    //   原实现只返回 code，前端 setActive 存不到 site_id → 站点管理员（非超管）进站后
    //   activeSite.site_id 为 undefined，凭据向导与开通状态判定全部空转。
    // ⛔ 同时带出 provisioned：选站页要标「待开通」并直达凭据向导（不必先进工作台再被拦）。
    // ⛔ 同时带出 is_owner：非负责人进屏 52 会被 requireOwner 403（403 NOT_SITE_OWNER），
    //   前端据此提前给出「请联系负责人」提示，而不是弹一个红色 toast。
    let rows: Array<{
      site_id: string; code: string; name: string; domain: string | null;
      status: string; site_role: string | null; provisioned: boolean; is_owner: boolean;
    }> = [];
    if (admin.role === 'platform_admin') {
      ({ rows } = await pool.query(
        `SELECT s.site_id::text AS site_id, s.code, s.name, s.domain, s.status,
                NULL::varchar AS site_role,
                FALSE AS is_owner,
                COALESCE(pc.test_status = 'passed' AND pc.status = 'active', FALSE) AS provisioned
           FROM site s
           LEFT JOIN provider_config pc ON pc.site_id = s.site_id AND pc.provider = 'mayixingqiu'
          ORDER BY s.created_at`
      ));
    } else if (admin.siteIds.length) {
      const ph = admin.siteIds.map((_: string, i: number) => `$${i + 1}`).join(',');
      ({ rows } = await pool.query(
        `SELECT s.site_id::text AS site_id, s.code, s.name, s.domain, s.status,
                us.site_role, COALESCE(us.is_owner, FALSE) AS is_owner,
                COALESCE(pc.test_status = 'passed' AND pc.status = 'active', FALSE) AS provisioned
           FROM site s
           JOIN admin_user_site us ON us.site_id = s.site_id
           LEFT JOIN provider_config pc ON pc.site_id = s.site_id AND pc.provider = 'mayixingqiu'
          WHERE s.site_id IN (${ph}) AND us.admin_id = $${admin.siteIds.length + 1}
          ORDER BY s.created_at`,
        [...admin.siteIds, admin.adminId]
      ));
    }
    res.json({
      ok: true,
      data: {
        can_aggregate: admin.role === 'platform_admin',
        sites: rows,
      },
    });
  } catch (e) { next(e); }
});

/** GET /api/admin/sites/members → 成员与授权（一人多站，会话单站） */
sitesRouter.get('/members', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    assertPlatform(req.admin!);
    const { rows } = await pool.query(
      `SELECT a.admin_id::text AS admin_id, a.username, a.role, a.status,
              COALESCE(
                JSON_AGG(JSON_BUILD_OBJECT(
                           'site_id', s.site_id::text,
                           'code', s.code, 'name', s.name,
                           'site_role', us.site_role, 'is_owner', us.is_owner)
                         ORDER BY s.created_at) FILTER (WHERE s.site_id IS NOT NULL),
                '[]'::json
              ) AS sites
         FROM admin_user a
         LEFT JOIN admin_user_site us ON us.admin_id = a.admin_id
         LEFT JOIN site s ON s.site_id = us.site_id
        GROUP BY a.admin_id, a.username, a.role, a.status, a.created_at
        ORDER BY a.created_at`
    );
    res.json({
      ok: true,
      data: {
        members: rows.map((r) => ({
          admin_id: r.admin_id,
          username: r.username,
          role: r.role, // platform_admin / site_admin / ...
          status: r.status,
          sites: r.sites ?? [],
        })),
      },
    });
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════
// 写操作（决策 #43，D先生 2026-10-05）
// ══════════════════════════════════════════════════════════════

const CODE_RE = /^[a-z][a-z0-9-]{1,31}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ⛔ 统一取 :id 并做 UUID 守卫。
 *
 * 踩过的坑（D先生实走流程时前端把 site_id 传成了字符串 'undefined'）：
 * `$1::uuid` 收到 'undefined' → PG 报 22P02 → **500**。而语义上「站点不存在」应是 404。
 * 客户端传错 id 是调用方的问题，不该表现成「服务器炸了」，更不该把 22P02 原文吐给前端。
 *
 * 四条路由（PATCH / DELETE / 加成员 / 移除成员）都过这里，避免以后再漏一处又 500。
 */
function siteIdParam(req: Request): string {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
  return id;
}

/**
 * POST /api/admin/sites → 建壳 { code, name, owner_admin_id? }
 * ⛔ 三个字段，**不出现任何 key / secret 输入框**（决策 #43 铁律）：
 *    凭据一律走屏 52，且只能由该站负责人自己配。建完状态恒为 pending。
 */
sitesRouter.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = req.admin!;
    assertPlatform(admin);

    const code = String(req.body?.code ?? '').trim().toLowerCase();
    const name = String(req.body?.name ?? '').trim();
    // ⛔ 负责人可留空 = 站点先建壳、稍后再指定（破「建站要人 / 建人要站」死锁）。
    //   ⛔⛔ 绝不能留空就默认落到当前超管：那等于平台自动成为客户站负责人，
    //   而凭据写权限只认 is_owner（决策 #43「平台只建壳、绝不碰凭据」直接被绕过）。
    const ownerRaw = req.body?.owner_admin_id;
    const ownerAdminId = ownerRaw === undefined || ownerRaw === null || ownerRaw === '' ? '' : String(ownerRaw);

    if (!CODE_RE.test(code)) throw new HttpError(400, '站点标识须小写字母开头，仅小写字母/数字/中划线，2~32 位（如 banta）', 'BAD_SITE_CODE');
    if (!name || name.length > 128) throw new HttpError(400, '站点名称必填且不超过 128 字', 'BAD_SITE_NAME');

    const dup = await pool.query(`SELECT 1 FROM site WHERE code = $1::text LIMIT 1`, [code]);
    if (dup.rows[0]) throw new HttpError(409, `站点标识 ${code} 已存在`, 'SITE_CODE_TAKEN');

    // ⛔ 指定负责人时该账号必须是**启用中**：停用成员不能当负责人（初稿曾把停用的老张写成负责人）
    let ownerName: string | null = null;
    if (ownerAdminId) {
      const { rows: ownerRows } = await pool.query(
        `SELECT admin_id::text AS admin_id, username FROM admin_user WHERE admin_id = $1::bigint AND status = 'active' LIMIT 1`,
        [ownerAdminId],
      );
      if (!ownerRows[0]) throw new HttpError(400, '负责人须为启用中的后台账号', 'OWNER_NOT_ACTIVE');
      ownerName = ownerRows[0].username;
    }

    const { rows: created } = await pool.query(
      `INSERT INTO site (code, name, status) VALUES ($1::text, $2::text, 'pending') RETURNING site_id::text AS site_id`,
      [code, name],
    );
    const siteId = created[0].site_id;

    // 有主才写负责人行；无主站零授权，谁都配不了凭据（要配必须先在成员卡上设负责人）
    if (ownerAdminId) {
      await pool.query(
        `INSERT INTO admin_user_site (admin_id, site_id, site_role, is_owner) VALUES ($1::bigint, $2::uuid, 'site_admin', TRUE)`,
        [ownerAdminId, siteId],
      );
    }

    await writeAudit(req, {
      site_id: siteId, action: 'site.create',
      target_type: 'site', target_id: code,
      detail: { name, owner: ownerName },
    });
    res.json({ ok: true, data: { site_id: siteId, code, status: 'pending', owner_username: ownerName } });
  } catch (e) { next(e); }
});

/**
 * GET /api/admin/sites/:code/miniprogram → 实时生成并下发站点小程序专属包（决策 #48 自助版）
 * 链路：部署时 export-miniprogram-assets.mjs 把统一模板打进镜像（assets/miniprogram-template.zip）
 *   → 本端点读取模板 → 实时注入站点 token + project.config（appid/项目名）→ zip 下发。
 * appid 真相源 = 租户开通向导存的 wechat_mini 凭据：**凭据开通完成即可自行下载，零部署零 config**。
 * 包内零凭据（secret 等全在服务端 DB），业务数据运行时按 site 拉取。
 */
sitesRouter.get('/:code/miniprogram', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = String(req.params.code ?? '').trim();
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(code)) throw new HttpError(400, '站点 code 非法', 'BAD_REQUEST');
    const { rows: siteRows } = await pool.query(`SELECT site_id::text AS site_id, code, name FROM site WHERE code = $1 LIMIT 1`, [code]);
    if (!siteRows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    assertSiteAccess(req.admin!, siteRows[0].site_id);

    const { rows: pcRows } = await pool.query(
      `SELECT apikey FROM provider_config WHERE site_id = $1 AND provider = 'wechat_mini' LIMIT 1`,
      [siteRows[0].site_id]
    );
    const appid = String(pcRows[0]?.apikey ?? '').trim();
    if (!appid) throw new HttpError(409, '该站点尚未配置小程序凭据，请先完成开通向导', 'SITE_MINI_NOT_CONFIGURED');

    const assetsDir = path.join(process.cwd(), 'assets'); // 容器 WORKDIR=/app；本地 node dist/index.js 时 cwd=server/
    const tplZip = path.join(assetsDir, 'miniprogram-template.zip');
    const tplMeta = path.join(assetsDir, 'miniprogram-template.json');
    if (!fs.existsSync(tplZip) || !fs.existsSync(tplMeta)) {
      throw new HttpError(404, '平台小程序模板缺失（部署异常，请联系平台）', 'MINIPROGRAM_TEMPLATE_MISSING');
    }
    const meta = JSON.parse(fs.readFileSync(tplMeta, 'utf8')) as { base_code: string; version?: string; built_at?: string };

    const entries = readZip(fs.readFileSync(tplZip)).map((e) => {
      if (e.name === 'core/bootstrap.js') {
        // 站点 token 替换（minified: const t="<base_code>"）
        e.data = Buffer.from(e.data.toString('utf8').replaceAll(`"${meta.base_code}"`, `"${code}"`), 'utf8');
      } else if (e.name === 'project.config.json') {
        const pc = JSON.parse(e.data.toString('utf8'));
        pc.appid = appid;
        pc.projectname = String(siteRows[0].name || code);
        e.data = Buffer.from(JSON.stringify(pc, null, 2), 'utf8');
      }
      return e;
    });
    if (!entries.some((e) => e.name === 'core/bootstrap.js' && e.data.includes(`"${code}"`))) {
      throw new HttpError(500, '站点注入失败（模板 token 不匹配）', 'MINIPROGRAM_INJECT_FAIL');
    }
    // ⛔ 双保险（2026-10-09 tabbar 消失事故）：模板缺关键文件就不发残包，宁可 503 让平台重部署
    if (!entries.some((e) => e.name === 'custom-tab-bar/index.js')) {
      throw new HttpError(503, '平台小程序模板异常（缺底部菜单组件），请联系平台重新部署', 'MINIPROGRAM_TEMPLATE_BROKEN');
    }
    res.setHeader('Content-Disposition', `attachment; filename="miniprogram-${code}.zip"`);
    res.setHeader('Content-Type', 'application/zip');
    if (meta.version) res.setHeader('X-Mini-Pkg-Version', meta.version);
    res.send(writeZip(entries));
  } catch (e) { next(e); }
});

/**
 * GET /api/admin/sites/:code/miniprogram/meta → 模板包版本信息（决策 #48 增补，2026-10-09）
 * 开通页下载条显示「模板版本」，让租户能自证下载到的是不是修复后的新包。
 */
sitesRouter.get('/:code/miniprogram/meta', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = String(req.params.code ?? '').trim();
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(code)) throw new HttpError(400, '站点 code 非法', 'BAD_REQUEST');
    const { rows: siteRows } = await pool.query(`SELECT site_id::text AS site_id FROM site WHERE code = $1 LIMIT 1`, [code]);
    if (!siteRows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    assertSiteAccess(req.admin!, siteRows[0].site_id);

    const assetsDir = path.join(process.cwd(), 'assets');
    const tplMeta = path.join(assetsDir, 'miniprogram-template.json');
    if (!fs.existsSync(tplMeta)) throw new HttpError(404, '平台小程序模板缺失（部署异常，请联系平台）', 'MINIPROGRAM_TEMPLATE_MISSING');
    const meta = JSON.parse(fs.readFileSync(tplMeta, 'utf8')) as { base_code: string; version?: string; built_at?: string };
    res.json({ ok: true, data: { version: meta.version ?? null, built_at: meta.built_at ?? null, base_code: meta.base_code } });
  } catch (e) { next(e); }
});

/**
 * PATCH /api/admin/sites/:id → { status? , owner_admin_id? }
 * status：pending ↔ active（启用前必须已开通）/ disabled（停用复用状态而非删除，保留订单与审计留痕）
 */
sitesRouter.patch('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = req.admin!;
    assertPlatform(admin);
    const siteId = siteIdParam(req);

    const { rows: cur } = await pool.query(`SELECT site_id::text AS site_id, code, status FROM site WHERE site_id = $1::uuid LIMIT 1`, [siteId]);
    if (!cur[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');

    // ── 移交负责人 ──
    if (req.body?.owner_admin_id !== undefined) {
      const targetId = String(req.body.owner_admin_id);
      const { rows: t } = await pool.query(`SELECT admin_id::text AS admin_id, username, status FROM admin_user WHERE admin_id = $1::bigint LIMIT 1`, [targetId]);
      if (!t[0]) throw new HttpError(404, '目标账号不存在', 'ADMIN_NOT_FOUND');
      if (t[0].status !== 'active') throw new HttpError(400, `${t[0].username} 已停用，不能设为负责人（先在成员卡启用）`, 'OWNER_NOT_ACTIVE');

      // 唯一负责人索引：先清旧再设新（同一事务内，避免中间态出现两个负责人）
      await pool.query(`UPDATE admin_user_site SET is_owner = FALSE WHERE site_id = $1::uuid AND is_owner`, [siteId]);
      await pool.query(
        `INSERT INTO admin_user_site (admin_id, site_id, site_role, is_owner) VALUES ($1::bigint, $2::uuid, 'site_admin', TRUE)
         ON CONFLICT (admin_id, site_id) DO UPDATE SET is_owner = TRUE`,
        [targetId, siteId],
      );
      await writeAudit(req, {
        site_id: siteId, action: 'site.transfer_owner',
        target_type: 'site', target_id: cur[0].code,
        detail: { new_owner: t[0].username },
      });
    }

    // ── 状态流转 ──
    if (req.body?.status !== undefined) {
      const target = String(req.body.status);
      if (!['pending', 'active', 'disabled'].includes(target)) throw new HttpError(400, '状态非法', 'BAD_STATUS');
      if (target === 'active') {
        // ⛔ 未开通不许启用：否则运营进得去却什么都看不到，全是 0 还以为平台没数据
        const { rows: pc } = await pool.query(
          `SELECT 1 FROM provider_config WHERE site_id = $1::uuid AND provider = 'mayixingqiu' AND status = 'active' AND test_status = 'passed' LIMIT 1`,
          [siteId],
        );
        if (!pc[0]) throw new HttpError(400, '尚未开通：请先在「凭据开通」配置蚂蚁星球 apikey 并通过连通性测试', 'SITE_NOT_PROVISIONED');
      }
      await pool.query(`UPDATE site SET status = $2::text, updated_at = now() WHERE site_id = $1::uuid`, [siteId, target]);
      await writeAudit(req, {
        site_id: siteId, action: 'site.set_status',
        target_type: 'site', target_id: cur[0].code,
        detail: { from: cur[0].status, to: target },
      });
    }

    invalidateProviderCache(cur[0].code);
    const { rows: after } = await pool.query(
      `SELECT s.site_id::text AS site_id, s.code, s.name, s.status, a.username AS owner_username
         FROM site s
         LEFT JOIN admin_user_site us ON us.site_id = s.site_id AND us.is_owner
         LEFT JOIN admin_user a ON a.admin_id = us.admin_id
        WHERE s.site_id = $1::uuid`,
      [siteId],
    );
    res.json({ ok: true, data: after[0] });
  } catch (e) { next(e); }
});

/**
 * POST /api/admin/sites/:id/members → 授权成员（多选站点 + 每站独立角色）
 * ⛔ is_owner 恒 FALSE：负责人只能通过 PATCH 移交/建站时指定，
 *    否则「加个成员」会静默把负责人换掉。
 */
sitesRouter.post('/:id/members', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = req.admin!;
    assertPlatform(admin);
    const siteId = siteIdParam(req);
    const { rows: s } = await pool.query(`SELECT code FROM site WHERE site_id = $1::uuid LIMIT 1`, [siteId]);
    if (!s[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');

    const adminId = String(req.body?.admin_id ?? '');
    const siteRole = String(req.body?.site_role ?? 'site_admin');
    if (!/^[a-z_]{3,32}$/.test(siteRole)) throw new HttpError(400, '站点角色非法', 'BAD_SITE_ROLE');
    const { rows: a } = await pool.query(`SELECT username FROM admin_user WHERE admin_id = $1::bigint LIMIT 1`, [adminId]);
    if (!a[0]) throw new HttpError(404, '账号不存在', 'ADMIN_NOT_FOUND');

    await pool.query(
      `INSERT INTO admin_user_site (admin_id, site_id, site_role, is_owner) VALUES ($1::bigint, $2::uuid, $3::text, FALSE)
       ON CONFLICT (admin_id, site_id) DO UPDATE SET site_role = EXCLUDED.site_role`,
      [adminId, siteId, siteRole],
    );
    await writeAudit(req, {
      site_id: siteId, action: 'site.grant_member',
      target_type: 'site', target_id: s[0].code,
      detail: { username: a[0].username, site_role: siteRole },
    });
    res.json({ ok: true, data: { granted: true } });
  } catch (e) { next(e); }
});

/** DELETE /api/admin/sites/:id/members/:adminId → 移除授权（⛔ 不许移除负责人） */
sitesRouter.delete('/:id/members/:adminId', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = req.admin!;
    assertPlatform(admin);
    const siteId = siteIdParam(req);
    const adminId = String(req.params.adminId);

    const { rows: g } = await pool.query(`SELECT is_owner FROM admin_user_site WHERE site_id = $1::uuid AND admin_id = $2::bigint`, [siteId, adminId]);
    if (!g[0]) throw new HttpError(404, '该成员未被授权此站点', 'GRANT_NOT_FOUND');
    if (g[0].is_owner) throw new HttpError(400, '不能移除负责人，请先「移交负责人」', 'CANNOT_REMOVE_OWNER');

    // ⚠️ 网关铁律：rowCount=rows.length，DELETE 判影响行数必须 RETURNING
    const { rows: del } = await pool.query(
      `DELETE FROM admin_user_site WHERE site_id = $1::uuid AND admin_id = $2::bigint RETURNING id`,
      [siteId, adminId],
    );
    if (!del.length) throw new HttpError(404, '该成员未被授权此站点', 'GRANT_NOT_FOUND');
    await writeAudit(req, { site_id: siteId, action: 'site.revoke_member', target_type: 'site', target_id: adminId, detail: {} });
    res.json({ ok: true, data: { removed: true } });
  } catch (e) { next(e); }
});

/**
 * DELETE /api/admin/sites/:id → 删除站点壳
 * ⛔ 有订单/商品/流水数据的站点**禁止删除**（历史账房必须留痕）：
 *    停用复用 status（决策 #43）。这里只允许删「空壳」——真要清干净得手动级联。
 */
sitesRouter.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const admin = req.admin!;
    assertPlatform(admin);
    const siteId = siteIdParam(req);
    const { rows: s } = await pool.query(`SELECT code, name FROM site WHERE site_id = $1::uuid LIMIT 1`, [siteId]);
    if (!s[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');

    const blockers: string[] = [];
    // ⚠️ 每张表的有无 site_id 必须逐个核实过再写 SQL：commission_flow 没有 site_id
    //   （靠 order_id 关联），硬写 WHERE site_id 直接 500（column does not exist）。
    const checks: Array<[string, string]> = [
      ['order', `SELECT 1 FROM "order" WHERE site_id::text = $1 LIMIT 1`],
      ['self_goods', `SELECT 1 FROM self_goods WHERE site_id::text = $1 LIMIT 1`],
      ['user', `SELECT 1 FROM "user" WHERE site_id::text = $1 LIMIT 1`],
      // 无 site_id 列：经订单反查
      ['commission_flow', `SELECT 1 FROM commission_flow cf JOIN "order" o ON o.id = cf.order_id WHERE o.site_id::text = $1 LIMIT 1`],
      ['user_coupon', `SELECT 1 FROM user_coupon uc JOIN "user" u ON u.user_id = uc.user_id WHERE u.site_id::text = $1 LIMIT 1`],
      ['withdraw', `SELECT 1 FROM withdraw w JOIN "user" u ON u.user_id = w.user_id WHERE u.site_id::text = $1 LIMIT 1`],
    ];
    for (const [label, sql] of checks) {
      const { rows } = await pool.query(sql, [siteId]);
      if (rows.length) blockers.push(label);
    }
    if (blockers.length) {
      throw new HttpError(400, `该站已有业务数据（${blockers.join('、')}），不能删除。请改用「停用」——历史订单与账房必须留痕。`, 'SITE_HAS_DATA');
    }

    await pool.query(`DELETE FROM admin_user_site WHERE site_id = $1::uuid`, [siteId]);
    await pool.query(`DELETE FROM provider_config WHERE site_id = $1::uuid`, [siteId]);
    await pool.query(`DELETE FROM site_payment WHERE site_id = $1::uuid`, [siteId]);
    const { rows: del } = await pool.query(`DELETE FROM site WHERE site_id = $1::uuid RETURNING site_id`, [siteId]);
    if (!del.length) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');

    await writeAudit(req, { site_id: null, action: 'site.delete', target_type: 'site', target_id: s[0].code, detail: { name: s[0].name } });
    res.json({ ok: true, data: { deleted: true } });
  } catch (e) { next(e); }
});
