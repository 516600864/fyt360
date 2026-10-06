/**
 * 底部菜单 tabbar-v2（决策#28：custom-tab-bar + 5 壳页，Tab2~5 站点级可配；
 * 决策#30：毛玻璃 4+1 视觉 —— style: classic/glass + fab 悬浮钮「一键查券」）。
 * 挂载于 /api/admin/tabbar；保存后随 GET /api/site/config 的 tabbar 字段下发。
 * 存储形态：site.tabbar = { v:2, items, style, fab }（读侧兼容历史纯数组，lib/tabbar.ts 归一）。
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import {
  normalizeTabbarConfig, sanitizeTabbarMeta,
  TABBAR_STYLE_DEFAULT, TABBAR_FAB_DEFAULT,
  type TabbarItem,
} from '../lib/tabbar.js';

export const tabbarRouter = Router();

/** 站点解析（同 schema.ts oneSite 语义）：显式 code → 兜底单站/超管首站 */
async function adminSiteId(admin: AdminJwtPayload, code: string): Promise<string> {
  if (code) {
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

/** builtin 枚举：home 首页 / rights 会员权益 / life 生活服务(分类) / orders 我的订单 / mine 我的 */
const TABBAR_BUILTIN = ['home', 'rights', 'life', 'orders', 'mine'] as const;

async function validateTabbar(siteId: string, items: unknown): Promise<void> {
  if (!Array.isArray(items)) throw new HttpError(400, 'items 须为数组', 'BAD_ITEMS');
  if (items.length < 2 || items.length > 5) throw new HttpError(400, '菜单项须 2~5 个', 'BAD_ITEM_COUNT');
  const list = items as TabbarItem[];
  list.forEach((it, i) => {
    if (!it || typeof it.name !== 'string' || !it.name.trim()) throw new HttpError(400, `第 ${i + 1} 项缺名称`, 'BAD_NAME');
    if (it.name.trim().length > 5) throw new HttpError(400, `第 ${i + 1} 项名称过长（≤5 字）`, 'BAD_NAME');
  });
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (i === 0) {
      // 首项固定为首页
      if (it.target?.type !== 'builtin' || it.target?.value !== 'home') {
        throw new HttpError(400, '首项必须指向首页（builtin/home）', 'BAD_HOME');
      }
      continue;
    }
    if (it.target?.type !== 'builtin' || !(TABBAR_BUILTIN as readonly string[]).includes(it.target?.value)) {
      // M4：开放 Schema 页目标（type='schema', value='page-xxx'，须已有 published 版本，端上壳页只认 published）
      if (it.target?.type !== 'schema' || !/^page-[a-z0-9]{2,10}$/.test(String(it.target?.value ?? ''))) {
        throw new HttpError(400, `第 ${i + 1} 项目标须为内置页（${TABBAR_BUILTIN.join('/')}）或 Schema 页（page-xxx）`, 'BAD_TARGET');
      }
      const { rows: pub } = await pool.query(
        `SELECT 1 FROM page_schema WHERE site_id = $1::uuid AND page = $2::text AND status = 'published' LIMIT 1`,
        [siteId, it.target.value]
      );
      if (!pub[0]) throw new HttpError(400, `第 ${i + 1} 项指向的 Schema 页「${it.target.value}」尚未发布，请先发布该页面`, 'SCHEMA_NOT_PUBLISHED');
    }
  }
}

/** 默认配置 = mini-01 设计稿定稿：四行 首页/生活服务/会员权益/我的 + FAB 一键查券（生活服务在会员权益前） */
const DEFAULT_ITEMS: TabbarItem[] = [
  { key: 'tab1', name: '首页', icon: '', icon_active: '', target: { type: 'builtin', value: 'home' }, fixed: true },
  { key: 'tab2', name: '生活服务', icon: '', icon_active: '', emoji: '🧭', emoji_active: '🧭', target: { type: 'builtin', value: 'life' } },
  { key: 'tab3', name: '会员权益', icon: '', icon_active: '', emoji: '👑', emoji_active: '👑', target: { type: 'builtin', value: 'rights' } },
  { key: 'tab4', name: '我的', icon: '', icon_active: '', target: { type: 'builtin', value: 'mine' } },
];

/** GET /api/admin/tabbar → 当前站点底部菜单（未配置回默认；输出归一 v2 结构） */
tabbarRouter.get('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await adminSiteId(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const { rows } = await pool.query(`SELECT tabbar FROM site WHERE site_id = $1::uuid LIMIT 1`, [siteId]);
    const norm = normalizeTabbarConfig(rows[0]?.tabbar);
    const customized = !!norm;
    const cfg = norm ?? { items: DEFAULT_ITEMS, style: TABBAR_STYLE_DEFAULT, fab: { ...TABBAR_FAB_DEFAULT } };
    res.json({ ok: true, data: { ...cfg, customized } });
  } catch (e) { next(e); }
});

/** PUT /api/admin/tabbar {items, style?, fab?} → 保存 tabbar-v2（随 /api/site/config 下发） */
tabbarRouter.put('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await adminSiteId(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    await validateTabbar(siteId, req.body?.items);
    const { style, fab } = sanitizeTabbarMeta(req.body?.style, req.body?.fab);
    const payload = { v: 2, items: req.body.items, style, fab };
    await pool.query(`UPDATE site SET tabbar = $2::jsonb, updated_at = now() WHERE site_id = $1::uuid`, [siteId, JSON.stringify(payload)]);
    await writeAudit(req, { action: 'tabbar.save', target_type: 'tabbar', target_id: String(req.body.items.length), site_id: siteId, detail: { style, fab } });
    res.json({ ok: true, data: { saved: true, items: req.body.items.length, style, fab } });
  } catch (e) { next(e); }
});
