// DIY 页面装修（admin-30）：page-v1 Schema 草稿/发布/读取
// 只产 Schema 不碰代码（§Schema 引擎）；发布 = draft → published（旧 published 归档 offline，历史留痕供 AI 回滚）
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';

export const schemaRouter = Router();

async function oneSite(admin: AdminJwtPayload, code: string): Promise<string> {
  if (code) {
    // 双解析：x-fyt-site 头可能是站点 code（前端注入）或 site_id（历史/手工调用）
    const { rows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 OR site_id::text = $1 LIMIT 1`, [code]);
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

/** 网关 jsonb 可能被二次编码为字符串，统一在此解包 */
function parseJsonb<T>(v: unknown, fallback: T): T {
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return fallback; }
  }
  return (v as T) ?? fallback;
}

/** 页面 key：内置 home/home_h5，或新建页面 page-xxxx（B 方案多页面；端上渲染随 M4 壳页） */
export const PAGE_RE = /^(home|home_h5|page-[a-z0-9]{2,10})$/;
function checkPage(page: string): void {
  if (!PAGE_RE.test(page)) throw new HttpError(400, 'page 非法（home/home_h5/page-xxx）', 'BAD_PAGE');
}

/** 楼层树轻校验：数组、类型白名单、楼层 ≤30（与 page-validate IMPLEMENTED_FLOORS 同步维护） */
const KNOWN_TYPES = ['swiper', 'search-bar', 'nav', 'coupon-strip', 'brand-chips', 'goods-feed', 'notice', 'divider', 'rich-text', 'blank', 'ingot-entry', 'movie-box', 'redeem-entry', 'floor', 'float-btn', 'category-nav', 'member-card', 'brand-matrix', 'activity-floor', 'image-hotzone', 'video-floor', 'countdown', 'popup-modal', 'seckill', 'group-buy-floor', 'coupon-wall', 'invite-floor'];
function checkFloors(floors: unknown): asserts floors is Array<{ type: string; [k: string]: unknown }> {
  if (!Array.isArray(floors)) throw new HttpError(400, 'floors 须为数组', 'BAD_FLOORS');
  if (floors.length > 30) throw new HttpError(400, '楼层超过上限 30', 'TOO_MANY_FLOORS');
  for (const f of floors) {
    if (!f || typeof f.type !== 'string' || !KNOWN_TYPES.includes(f.type)) {
      throw new HttpError(400, `未知楼层类型：${(f as { type?: unknown })?.type ?? '∅'}（已知：${KNOWN_TYPES.join('/')}）`, 'BAD_FLOOR_TYPE');
    }
  }
}

/** GET /api/admin/schema/pages?site= → 该站全部页面（key + title + 最新版本/状态），供 AI 页与 DIY 编辑器下拉 */
schemaRouter.get('/pages', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const { rows } = await pool.query(
      `SELECT page,
              (SELECT schema_json->'title' FROM page_schema p2
                WHERE p2.site_id = p.site_id AND p2.page = p.page AND schema_json->'title' IS NOT NULL
                ORDER BY version DESC LIMIT 1) AS title,
              MAX(version) AS latest_version,
              COUNT(*) FILTER (WHERE status = 'draft') > 0 AS has_draft,
              MAX(updated_at) AS updated_at
         FROM page_schema p WHERE site_id = $1::uuid
        GROUP BY page, site_id
        ORDER BY MIN(CASE page WHEN 'home' THEN 0 WHEN 'home_h5' THEN 1 ELSE 2 END), page`,
      [siteId]);
    res.json({ ok: true, data: rows.map((r) => ({
      page: r.page,
      title: typeof r.title === 'string' ? r.title.replace(/^"|"$/g, '') : (r.page === 'home' ? '小程序首页' : r.page === 'home_h5' ? 'H5 首页' : r.page),
      latest_version: Number(r.latest_version ?? 0),
      has_draft: Boolean(r.has_draft),
      updated_at: r.updated_at,
    })) });
  } catch (e) { next(e); }
});

/** DELETE /api/admin/schema/page?page=page-xxx → 删除装修页全部版本（内置页禁删；带全站引用计数） */
schemaRouter.delete('/page', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const page = String(req.query.page ?? '');
    checkPage(page);
    if (page === 'home' || page === 'home_h5') {
      throw new HttpError(400, '内置首页不可删除', 'BAD_PAGE_PROTECTED');
    }
    // 引用扫描：其他已发布楼层里是否有动作指向此页（诚实告知，不阻断）
    const { rows: refs } = await pool.query(
      `SELECT page FROM page_schema
        WHERE site_id = $1::uuid AND status = 'published' AND page <> $2::text
          AND schema_json::text LIKE $3::text
        GROUP BY page`, [siteId, page, `%"${page}"%`]);
    // RETURNING 铁律：网关 rowCount=rows.length，DELETE 不 RETURNING 恒 0
    const { rows: delRows } = await pool.query(
      `DELETE FROM page_schema WHERE site_id = $1::uuid AND page = $2::text RETURNING id`, [siteId, page]);
    if (!delRows.length) throw new HttpError(404, '页面不存在（可能已删除）', 'PAGE_NOT_FOUND');
    await writeAudit(req, { action: 'schema.page_delete', target_type: 'page_schema', target_id: page, site_id: siteId, detail: { versions_deleted: delRows.length, referenced_by: refs.map((r) => r.page) } });
    res.json({ ok: true, data: { deleted: true, page, versions_deleted: delRows.length, referenced_by: refs.map((r) => r.page) } });
  } catch (e) { next(e); }
});

/** GET /api/admin/schema/current?page=home[&base=published] → base=published 时发布版优先（DIY 编辑器所见=线上）；默认草稿优先（AI 生成→微调→发布）。响应附带 draft_version/draft_updated_at 供草稿提示条 */
schemaRouter.get('/current', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const page = String(req.query.page ?? 'home');
    checkPage(page);
    const draftFirst = String(req.query.base ?? '') !== 'published';
    const { rows } = await pool.query(
      `SELECT version, status, schema_json, updated_at FROM page_schema
        WHERE site_id = $1::uuid AND page = $2::text AND status IN ('draft', 'published')
        ORDER BY CASE status WHEN 'draft' THEN ${draftFirst ? 0 : 1} ELSE ${draftFirst ? 1 : 0} END, version DESC
        LIMIT 1`, [siteId, page]);
    if (!rows[0]) {
      res.json({ ok: true, data: { page, version: 0, status: 'none', floors: null, updated_at: null, draft_version: 0, draft_updated_at: null } });
      return;
    }
    const doc = parseJsonb<{ floors?: unknown }>(rows[0].schema_json, {});
    const { rows: dr } = await pool.query(
      `SELECT MAX(version) AS v, MAX(updated_at) AS u FROM page_schema
        WHERE site_id = $1::uuid AND page = $2::text AND status = 'draft'`, [siteId, page]);
    res.json({
      ok: true,
      data: {
        page, version: rows[0].version, status: rows[0].status,
        floors: Array.isArray(doc.floors) ? doc.floors : null,
        updated_at: rows[0].updated_at,
        draft_version: Number(dr[0]?.v ?? 0),
        draft_updated_at: dr[0]?.u ?? null,
      },
    });
  } catch (e) { next(e); }
});

/** PUT /api/admin/schema/draft {page, floors} → 保存草稿（upsert draft 行，version = max+1） */
schemaRouter.put('/draft', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const page = String(req.body?.page ?? '');
    checkPage(page);
    checkFloors(req.body?.floors);

    // 继承原页面 title（AI 新建页面的中文名存 doc.title；DIY 保存不传 title 时保留）
    let inheritTitle: { title?: string } = {};
    const { rows: trow } = await pool.query(
      `SELECT schema_json FROM page_schema
        WHERE site_id = $1::uuid AND page = $2::text AND schema_json->'title' IS NOT NULL
        ORDER BY version DESC LIMIT 1`, [siteId, page]);
    const tdoc = trow[0]?.schema_json as { title?: unknown } | undefined;
    if (tdoc && typeof tdoc.title === 'string') inheritTitle = { title: tdoc.title };

    const doc = JSON.stringify({ page, floors: req.body?.floors, ...inheritTitle });
    const { rows: exist } = await pool.query(
      `SELECT id, version FROM page_schema
        WHERE site_id = $1::uuid AND page = $2::text AND status = 'draft' LIMIT 1`, [siteId, page]);
    let version: number;
    if (exist[0]) {
      // 注意：exec-pgsql 网关要求参数全部被引用（42P18），此语句只用到 doc/id，勿回传 siteId/page
      const up = await pool.query(
        `UPDATE page_schema SET schema_json = $1::jsonb, source = 'manual', updated_at = now(), version = version + 1
          WHERE id = $2::bigint RETURNING version`, [doc, exist[0].id]);
      version = up.rows[0].version;
    } else {
      const { rows: maxv } = await pool.query(
        `SELECT COALESCE(MAX(version), 0)::int AS v FROM page_schema
          WHERE site_id = $1::uuid AND page = $2::text`, [siteId, page]);
      const ins = await pool.query(
        `INSERT INTO page_schema (site_id, page, schema_json, version, status, source)
         VALUES ($1::uuid, $2::text, $3::jsonb, $4::int, 'draft', 'manual') RETURNING version`,
        [siteId, page, doc, maxv[0].v + 1]);
      version = ins.rows[0].version;
    }
    res.json({ ok: true, data: { page, version, status: 'draft' } });
  } catch (e) { next(e); }
});

/** POST /api/admin/schema/publish {page} → 旧 published 归档 offline，草稿转 published（version+1） */
schemaRouter.post('/publish', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const page = String(req.body?.page ?? '');
    checkPage(page);

    const { rows: archive } = await pool.query(
      `UPDATE page_schema SET status = 'offline', updated_at = now()
        WHERE site_id = $1::uuid AND page = $2::text AND status = 'published' RETURNING id`, [siteId, page]);    const { rows: pub } = await pool.query(
      `UPDATE page_schema SET status = 'published', version = version + 1, updated_at = now()
        WHERE site_id = $1::uuid AND page = $2::text AND status = 'draft' RETURNING version`, [siteId, page]);
    if (!pub[0]) {
      throw new HttpError(404, '无草稿可发布（先保存草稿）', 'NO_DRAFT');
    }
    await writeAudit(req, { action: 'schema.publish', target_type: 'schema', target_id: page, site_id: siteId, detail: { version: pub[0].version } });
    res.json({ ok: true, data: { page, version: pub[0].version, archived: archive.length } });
  } catch (e) { next(e); }
});
