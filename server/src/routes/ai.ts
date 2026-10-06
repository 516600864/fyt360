// AI 动态装修（admin-42）：page_schema 版本历史 + llm_log 留痕 + 回滚 + AI 生成（A1）
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { chatComplete, probeLlm, LlmTruncatedError, type ChatMessage } from '../lib/llm.js';
import { buildGenerateMessages } from '../lib/page-prompt.js';
import { PAGE_RE } from './schema.js';
import { validatePageSchema, validateTheme, extractJson, type ValidatedDoc } from '../lib/page-validate.js';

export const aiRouter = Router();

async function oneSite(admin: AdminJwtPayload, code: string): Promise<string> {
  if (code) {
    const { rows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [code]);
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

/** GET /api/admin/ai/overview?site= → 当前版本 + llm_log 历史 */
aiRouter.get('/overview', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query.site ?? ''));
    const { rows: versions } = await pool.query(
      `SELECT id, page, version, status, source, schema_json, updated_at
         FROM page_schema WHERE site_id = $1
        ORDER BY page, version DESC LIMIT 60`, [siteId]);
    const pages = versions.map((v) => {
      const doc = v.schema_json && typeof v.schema_json === 'object' && !Array.isArray(v.schema_json) ? v.schema_json : {};
      return {
        id: v.id,
        page: v.page,
        title: typeof (doc as { title?: unknown }).title === 'string' ? (doc as { title: string }).title : null,
        version: v.version,
        status: v.status,
        source: v.source,
        floors: Array.isArray(doc.floors) ? doc.floors.map((f: { type: string }) => f.type) : [],
        updated_at: v.updated_at,
        schema_json: v.schema_json,
      };
    });
    const { rows: logs } = await pool.query(
      `SELECT l.id, l.prompt, l.version, l.created_at, l.model, l.duration_ms, l.status, l.page,
              CASE WHEN l.schema_out IS NULL THEN 0
                   WHEN jsonb_typeof(l.schema_out) = 'object' AND jsonb_typeof(l.schema_out->'floors') = 'array'
                   THEN jsonb_array_length(l.schema_out->'floors')
                   ELSE 0 END AS floor_cnt
         FROM llm_log l WHERE l.site_id = $1
        ORDER BY l.created_at DESC LIMIT 10`, [siteId]);
    const probe = await probeLlm();
    res.json({ ok: true, data: { pages, logs, agent_ready: probe.ready, agent_error: probe.error ?? null } });
  } catch (e) { next(e); }
});

/** POST /api/admin/ai/rollback {page, from_version} → 用历史版本覆盖 published（版本 +1，真实写） */
aiRouter.post('/rollback', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const page = String(req.body?.page ?? '');
    const fromVersion = Number(req.body?.from_version);
    if (!PAGE_RE.test(page)) throw new HttpError(400, 'page 非法（home/home_h5/page-xxx）', 'BAD_PAGE');
    if (!Number.isFinite(fromVersion)) throw new HttpError(400, 'from_version 非法', 'BAD_VERSION');

    const { rows: src } = await pool.query(
      `SELECT schema_json FROM page_schema
        WHERE site_id = $1 AND page = $2 AND version = $3 LIMIT 1`, [siteId, page, fromVersion]);
    if (!src[0]) throw new HttpError(404, '历史版本不存在', 'VERSION_NOT_FOUND');

    const { rows: up } = await pool.query(
      `UPDATE page_schema
          SET schema_json = $3::jsonb, version = version + 1, updated_at = now()
        WHERE site_id = $1 AND page = $2 AND status = 'published'
        RETURNING version`, [siteId, page, JSON.stringify(src[0].schema_json)]);
    if (!up[0]) throw new HttpError(404, '无 published 版本', 'NO_PUBLISHED');
    res.json({ ok: true, data: { page, version: up[0].version, restored_from: fromVersion } });
  } catch (e) { next(e); }
});

const MAX_ATTEMPTS = 3; // 首次 + 校验失败回喂重试 2 次

/** 版本楼层 diff（楼层按序对齐：same/changed/added/removed） */
aiRouter.get('/diff', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query.site ?? ''));
    const page = String(req.query.page ?? '');
    const va = Number(req.query.a);
    const vb = Number(req.query.b);
    if (!PAGE_RE.test(page)) throw new HttpError(400, 'page 非法（home/home_h5/page-xxx）', 'BAD_PAGE');
    if (!Number.isFinite(va) || !Number.isFinite(vb)) throw new HttpError(400, 'a/b 须为版本号', 'BAD_VERSION');

    const fetchVer = async (v: number) => {
      const { rows } = await pool.query(
        `SELECT version, status, source, schema_json FROM page_schema
          WHERE site_id = $1 AND page = $2 AND version = $3 LIMIT 1`, [siteId, page, v]);
      if (!rows[0]) throw new HttpError(404, `版本 v${v} 不存在`, 'VERSION_NOT_FOUND');
      const doc = rows[0].schema_json;
      return { version: v, status: rows[0].status as string, source: rows[0].source as string,
        floors: doc && typeof doc === 'object' && Array.isArray((doc as { floors?: unknown }).floors)
          ? (doc as { floors: unknown[] }).floors : [] };
    };
    const A = await fetchVer(va);
    const B = await fetchVer(vb);

    const summary = (f: unknown): string => {
      const o = (f ?? {}) as { type?: string; props?: Record<string, unknown> };
      const pr = o.props ?? {};
      const brief = (v: unknown) => Array.isArray(v) ? `${v.length}项` : String(v ?? '').slice(0, 16);
      switch (o.type) {
        case 'swiper': return `swiper(${brief(pr.items)})`;
        case 'nav': return `nav(${brief(pr.items)})`;
        case 'search-bar': return `search-bar(${brief(pr.placeholder)})`;
        case 'coupon-strip': return `coupon-strip(${brief(pr.amount)})`;
        case 'brand-chips': return `brand-chips(${brief(pr.chips)})`;
        case 'goods-feed': return `goods-feed(${brief(pr.title)})`;
        case 'notice': return `notice(${brief(pr.texts)})`;
        case 'divider': return `divider(${brief(pr.title)})`;
        case 'rich-text': return `rich-text(${brief(pr.title)})`;
        case 'blank': return `blank(${brief(pr.height)})`;
        case 'ingot-entry': return `ingot-entry(${brief(pr.title)})`;
        case 'movie-box': return `movie-box(${brief(pr.title)})`;
        case 'redeem-entry': return `redeem-entry(${brief(pr.title)})`;
        default: return String(o.type ?? '?');
      }
    };

    const diff: { index: number; status: 'same' | 'changed' | 'added' | 'removed'; a?: string; b?: string }[] = [];
    const n = Math.max(A.floors.length, B.floors.length);
    for (let i = 0; i < n; i++) {
      const x = A.floors[i]; const y = B.floors[i];
      if (x && !y) diff.push({ index: i, status: 'removed', a: summary(x) });
      else if (!x && y) diff.push({ index: i, status: 'added', b: summary(y) });
      else diff.push({ index: i, status: JSON.stringify(x) === JSON.stringify(y) ? 'same' : 'changed', a: summary(x), b: summary(y) });
    }
    res.json({ ok: true, data: { page, a: { ...A, floors: undefined }, b: { ...B, floors: undefined },
      diff, stats: {
        same: diff.filter((d) => d.status === 'same').length,
        changed: diff.filter((d) => d.status === 'changed').length,
        added: diff.filter((d) => d.status === 'added').length,
        removed: diff.filter((d) => d.status === 'removed').length,
      } } });
  } catch (e) { next(e); }
});

/** L1 换肤：brief → 12 token 色板 JSON → 校验 → site.theme（端内 theme prop 即时生效） */
const THEME_SYSTEM = `你是 FYT360 平台的配色师。波普风（粗描边+硬阴影）主题，根据运营者描述输出站点配色 token。
可用键（值须为 #hex 或 css gradient）：
primary(主色/玫红系按钮), primary-dark(描边/按压态,须比 primary 深), secondary(辅助/角标), on-primary(primary 上的文字,须保证可读),
bg(页面底色), surface(卡片面), surface-alt(次级面), border-strong(主描边), border-default(弱描边),
text(主文字), text-2(次级), text-3(弱文字)
默认波普风参考：primary #e8336d, primary-dark #a31245, secondary #ffaa1d, on-primary #ffffff, bg #fff6e9, surface #ffffff, surface-alt #fff9ee, border-strong #e8b88a, border-default #f2ddc0, text #2b2b33, text-2 #8c8577, text-3 #b9b0a0。
要求：整组配色协调、明暗层次分明、文字对比度足够（浅底配深字）。只输出 JSON：{"version":1,"tokens":{...}}，不要解释文字。`;

/** 换肤生成专用的 max_tokens 预算。
 *  ⚠️ **不能再用 1200**（2026-10-04 实测踩坑）：hy3 是混合推理模型，`reasoning_tokens` 与正文
 *     **共享同一 max_tokens 预算**。1200 时推理烧掉全部 1200 → content 空串 → finish_reason=length
 *     → 「AI 换肤直接 500」的根因。实测阶梯：
 *       1200 → 推理1200 / 正文  0 字（崩）
 *       2000 → 推理1980 / 正文 59 字（JSON 截断，校验仍失败）
 *       3500 → 推理1926 / 正文281 字（完整）✅
 *       6000 → 推理1811 / 正文281 字（无额外收益，白等 3 秒）
 *     正文 12 个 token 实测 281 字，留 1500+ 余量即可，留太多只会让网关多算 reasoning。 */
const THEME_MAX_TOKENS = 3500;

async function generateTheme(siteId: string, brief: string): Promise<{ tokens: Record<string, string>; durationMs: number; tokensIn: number; tokensOut: number }> {
  const messages: ChatMessage[] = [
    { role: 'system', content: THEME_SYSTEM },
    { role: 'user', content: `配色主题：${brief.trim()}\n\n请输出完整色板 JSON。` },
  ];
  let lastErr = '';
  let result: Awaited<ReturnType<typeof chatComplete>> | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // 每次重试都放大预算：第1 轮若因推理吃掉预算被截断，第2 轮必须给它更多余量，
    // 否则「重试」只是拿同样的预算再撞一次墙（2026-10-04 原 bug 就是死磕 1200）。
    const budget = THEME_MAX_TOKENS + (attempt - 1) * 1500;
    try {
      result = await chatComplete(messages, { maxTokens: budget, temperature: attempt === 1 ? 0.5 : 0.3 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErr = msg;
      // 截断类错误重试有意义（预算已放大）；网关/配额类错误重试没意义，直接抛出省时间
      if (!(e instanceof LlmTruncatedError)) {
        throw new HttpError(502, `AI 通道异常：${msg.slice(0, 200)}`, 'LLM_UPSTREAM_ERROR');
      }
      messages.push({ role: 'user', content: `上次输出被截断（推理占满预算）。请直接输出最终 JSON，不要展开分析。` });
      continue;
    }
    let parsed: unknown;
    try { parsed = extractJson(result.text); } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      messages.push({ role: 'assistant', content: result.text.slice(0, 800) });
      messages.push({ role: 'user', content: `解析失败：${lastErr}。重新输出完整 JSON。` });
      continue;
    }
    const verr = validateTheme(parsed);
    if (!verr) {
      const tokens = (parsed as { tokens: Record<string, string> }).tokens;
      return { tokens, durationMs: result.durationMs, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
    }
    lastErr = verr;
    messages.push({ role: 'assistant', content: result.text.slice(0, 800) });
    messages.push({ role: 'user', content: `${verr}。请修正后重新输出完整 JSON。` });
  }
  await pool.query(
    `INSERT INTO llm_log (site_id, prompt, model, duration_ms, tokens_in, tokens_out, status)
     VALUES ($1::uuid, $2::text, $3::text, $4::int, $5::int, $6::int, 'failed')`,
    [siteId, `[theme] ${brief}\n[最后错误] ${lastErr}`, 'cloudbase/hy3', result?.durationMs ?? 0, result?.tokensIn ?? 0, result?.tokensOut ?? 0]);
  throw new HttpError(502, `换肤生成未产出合法色板（已重试 ${MAX_ATTEMPTS} 次）：${lastErr.slice(0, 300)}`, 'THEME_INVALID');
}

/** 默认波普色板（= THEME_SYSTEM 参考值，「恢复默认」一键回滚用） */
const DEFAULT_THEME_TOKENS: Record<string, string> = {
  primary: '#e8336d', 'primary-dark': '#a31245', secondary: '#ffaa1d', 'on-primary': '#ffffff',
  bg: '#fff6e9', surface: '#ffffff', 'surface-alt': '#fff9ee', 'border-strong': '#e8b88a', 'border-default': '#f2ddc0',
  text: '#2b2b33', 'text-2': '#8c8577', 'text-3': '#b9b0a0',
};

/** 读当前站点 theme（jsonb 字符串形态兼容） */
async function readSiteTheme(siteId: string): Promise<Record<string, string>> {
  const { rows } = await pool.query(`SELECT theme FROM site WHERE site_id = $1::uuid LIMIT 1`, [siteId]);
  const t = rows[0]?.theme;
  return typeof t === 'string' ? JSON.parse(t || '{}') : (t ?? {});
}

/** 应用色板：合并写 site.theme + 旧值存档 llm_log（回滚依据） */
async function applyThemeTokens(siteId: string, incoming: Record<string, string>, brief: string, operator: bigint) {
  const oldTheme = await readSiteTheme(siteId);
  const merged = { ...oldTheme, ...incoming };
  await pool.query(`UPDATE site SET theme = $2::jsonb, updated_at = now() WHERE site_id = $1::uuid`, [siteId, JSON.stringify(merged)]);
  await pool.query(
    `INSERT INTO llm_log (site_id, prompt, schema_out, operator, model, status)
     VALUES ($1::uuid, $2::text, $3::jsonb, $4::bigint, 'cloudbase/hy3', 'ok')`,
    [siteId, brief, JSON.stringify({ prev: oldTheme, tokens: incoming }), operator]);
  return merged;
}

/** 换肤预览留痕（不落 site.theme；失败留痕在 generateTheme 内部已完成） */
async function logThemePreview(siteId: string, brief: string, tokens: Record<string, string>, operator: bigint, durationMs: number, tokensIn: number, tokensOut: number) {
  await pool.query(
    `INSERT INTO llm_log (site_id, prompt, schema_out, operator, model, duration_ms, tokens_in, tokens_out, status)
     VALUES ($1::uuid, $2::text, $3::jsonb, $4::bigint, 'cloudbase/hy3', $5::int, $6::int, $7::int, 'ok')`,
    [siteId, `[theme-preview] ${brief}`, JSON.stringify({ version: 1, tokens }), operator, durationMs, tokensIn, tokensOut]);
}

/** 页面生成完整流程（/generate 与 /retry 共用）：生成 → 校验 → 落 AI 草稿 + llm_log */
async function runPageGeneration(siteId: string, page: string, brief: string, operator: bigint, title?: string) {
  // 当前 published 楼层概要，供 LLM 参考
  const { rows: cur } = await pool.query(
    `SELECT schema_json FROM page_schema
      WHERE site_id = $1 AND page = $2 AND status = 'published'
      ORDER BY version DESC LIMIT 1`, [siteId, page]);
  const curDoc = cur[0]?.schema_json as { floors?: { type: string }[] } | null;
  const currentFloors = Array.isArray(curDoc?.floors)
    ? curDoc!.floors.map((f) => f.type)
    : null;

  // 生成 → 校验 → 失败回喂重试
  let doc: ValidatedDoc | null = null;
  let lastErr = '';
  let result: Awaited<ReturnType<typeof chatComplete>> | null = null;
  const messages: ChatMessage[] = buildGenerateMessages(page, brief, currentFloors);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // 与换肤同理：重试时放大预算。页面 Schema 体积远大于色板（正文可能 2000+ token），
    // 但推理仍吃同一预算，长 brief 时 4000 也可能被推理吃光 → 自适应放大兜底。
    const budget = 4000 + (attempt - 1) * 2000;
    try {
      result = await chatComplete(messages, { maxTokens: budget, temperature: attempt === 1 ? 0.4 : 0.2 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErr = msg;
      if (!(e instanceof LlmTruncatedError)) {
        // 网关/配额/超时类错误重试无意义，直接 502 并带真实原因（别再让前端只看到 500）
        throw new HttpError(502, `AI 通道异常：${msg.slice(0, 200)}`, 'LLM_UPSTREAM_ERROR');
      }
      messages.push({ role: 'user', content: '上次输出被截断。请直接输出最终 JSON，缩短所有文案字段，不要展开分析。' });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = extractJson(result.text);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      messages.push({ role: 'assistant', content: result.text.slice(0, 1500) });
      messages.push({ role: 'user', content: `输出解析失败：${lastErr}。请重新输出完整合法的 JSON（不要围栏、不要解释）。` });
      continue;
    }
    const verr = validatePageSchema(parsed);
    if (!verr) { doc = parsed as ValidatedDoc; break; }
    lastErr = verr;
    messages.push({ role: 'assistant', content: result.text.slice(0, 1500) });
    messages.push({ role: 'user', content: `${verr}。请修正后重新输出完整 JSON（只能使用已实现组件：swiper/search-bar/nav/coupon-strip/brand-chips/goods-feed/notice/divider/rich-text/blank/ingot-entry/movie-box/redeem-entry）。` });
  }
  if (!doc || !result) {
    await pool.query(
      `INSERT INTO llm_log (site_id, prompt, model, duration_ms, tokens_in, tokens_out, status, page)
       VALUES ($1::uuid, $2::text, $3::text, $4::int, $5::int, $6::int, 'failed', $7::text)`,
      [siteId, `[brief] ${brief}\n[最后错误] ${lastErr}`, 'cloudbase/hy3', result?.durationMs ?? 0, result?.tokensIn ?? 0, result?.tokensOut ?? 0, page]);
    throw new HttpError(502, `AI 生成未产出合法 Schema（已重试 ${MAX_ATTEMPTS} 次）：${lastErr.slice(0, 300)}`, 'GENERATION_INVALID');
  }

  // 落 AI 草稿（version = 当前最大 +1，不覆盖 published）
  const { rows: maxv } = await pool.query(
    `SELECT COALESCE(MAX(version), 0) AS v FROM page_schema WHERE site_id = $1 AND page = $2`,
    [siteId, page]);
  const version = Number(maxv[0].v) + 1;
  const floorCnt = doc.floors.length;
  const docWithMeta = title ? { ...doc, title } : doc;
  const { rows: ins } = await pool.query(
    `INSERT INTO page_schema (site_id, page, version, status, source, schema_json)
     VALUES ($1::uuid, $2::text, $3::int, 'draft', 'ai', $4::jsonb) RETURNING id`,
    [siteId, page, version, JSON.stringify(docWithMeta)]);

  await pool.query(
    `INSERT INTO llm_log (site_id, prompt, schema_out, operator, version, model, duration_ms, tokens_in, tokens_out, status, page)
     VALUES ($1::uuid, $2::text, $3::jsonb, $4::bigint, $5::int, $6::text, $7::int, $8::int, $9::int, 'ok', $10::text)`,
    [siteId, `[brief] ${brief}`, JSON.stringify(doc), operator, version,
     'cloudbase/hy3', result.durationMs, result.tokensIn, result.tokensOut, page]);

  return { page, version, floors: floorCnt, floor_types: doc.floors.map((f) => f.type),
    schema_id: ins[0]?.id ?? null, duration_ms: result.durationMs, tokens: { in: result.tokensIn, out: result.tokensOut } };
}

/** POST /api/admin/ai/generate {site?, page, brief, mode?: 'page'|'theme'} → LLM 生成 */
aiRouter.post('/generate', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const mode = String(req.body?.mode ?? 'page');
    const brief = String(req.body?.brief ?? '');
    if (!['page', 'theme'].includes(mode)) throw new HttpError(400, 'mode 须为 page/theme', 'BAD_MODE');
    if (mode === 'theme') {
      // 决策#34：换肤拆两步（生成≠生效），防「一键全局变色且不可回滚」事故
      throw new HttpError(400, '换肤已拆两步：POST /api/admin/ai/theme/preview 预览色板 → /theme/apply 确认生效', 'THEME_TWO_STEP');
    }
    if (brief.trim().length < 4) throw new HttpError(400, 'brief 描述过短（≥4 字）', 'BRIEF_TOO_SHORT');
    if (brief.length > 2000) throw new HttpError(400, 'brief 过长（≤2000 字）', 'BRIEF_TOO_LONG');

    const probe = await probeLlm();
    if (!probe.ready) {
      throw new HttpError(503, `AI 通道不可用：${probe.error ?? '未知原因'}`, 'AGENT_NOT_READY');
    }
    const target = String(req.body?.target ?? 'existing');
    if (!['existing', 'new'].includes(target)) throw new HttpError(400, "target 须为 existing/new", 'BAD_TARGET');
    if (target === 'new') {
      // B 方案：新增页面。页面名（中文）作为 title，key 自动生成 page-xxxx，端上渲染随 M4 壳页
      const title = String(req.body?.title ?? '').trim();
      if (title.length < 2 || title.length > 30) throw new HttpError(400, '页面名称 2~30 字', 'BAD_TITLE');
      let page = '';
      for (let i = 0; i < 5; i++) {
        const cand = `page-${Math.random().toString(36).slice(2, 6)}`;
        const { rows: dup } = await pool.query(
          `SELECT 1 FROM page_schema WHERE site_id = $1::uuid AND page = $2::text LIMIT 1`, [siteId, cand]);
        if (!dup[0]) { page = cand; break; }
      }
      if (!page) throw new HttpError(500, '页面 key 生成冲突，请重试', 'PAGE_KEY_COLLISION');
      const r = await runPageGeneration(siteId, page, brief, req.admin!.adminId, title);
      res.json({ ok: true, data: r });
      return;
    }
    const page = String(req.body?.page ?? 'home');
    if (!PAGE_RE.test(page)) throw new HttpError(400, 'page 非法（home/home_h5/page-xxx）', 'BAD_PAGE');
    res.json({ ok: true, data: await runPageGeneration(siteId, page, brief, req.admin!.adminId) });
  } catch (e) { next(e); }
});

/** POST /api/admin/ai/retry {site?, log_id} → 按失败留痕重跑（page/theme 通吃） */
aiRouter.post('/retry', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const logId = Number(req.body?.log_id);
    if (!Number.isFinite(logId)) throw new HttpError(400, 'log_id 非法', 'BAD_LOG_ID');

    const { rows } = await pool.query(
      `SELECT prompt, page, status FROM llm_log WHERE id = $1::bigint AND site_id = $2::uuid LIMIT 1`,
      [logId, siteId]);
    if (!rows[0]) throw new HttpError(404, '留痕记录不存在', 'LOG_NOT_FOUND');
    if (rows[0].status !== 'failed') throw new HttpError(400, '该记录非失败状态，无需重试', 'NOT_FAILED');

    const prompt: string = rows[0].prompt ?? '';
    const brief = prompt.split('\n[最后错误]')[0].replace(/^\[(brief|theme|theme-preview)\]\s*/, '').trim();
    if (brief.length < 4) throw new HttpError(400, '留痕 brief 过短，无法重试（请直接重新生成）', 'BRIEF_TOO_SHORT');

    const probe = await probeLlm();
    if (!probe.ready) throw new HttpError(503, `AI 通道不可用：${probe.error ?? '未知原因'}`, 'AGENT_NOT_READY');
    if (prompt.startsWith('[theme') || prompt.startsWith('[theme-preview]')) {
      // 决策#34：重试同样只产预览（不落 site.theme），确认生效走 /theme/apply
      const r = await generateTheme(siteId, brief);
      await logThemePreview(siteId, brief, r.tokens, req.admin!.adminId, r.durationMs, r.tokensIn, r.tokensOut);
      res.json({ ok: true, data: { mode: 'theme-preview' as const, tokens: r.tokens, duration_ms: r.durationMs, retried_from: logId } });
    } else {
      const page = String(rows[0].page ?? 'home');
      if (!PAGE_RE.test(page)) throw new HttpError(400, '留痕 page 非法', 'BAD_PAGE');
      res.json({ ok: true, data: { ...(await runPageGeneration(siteId, page, brief, req.admin!.adminId)), retried_from: logId } });
    }
  } catch (e) { next(e); }
});

/** POST /api/admin/ai/theme/preview {brief} → 仅生成色板（不落 site.theme），确认走 /theme/apply */
aiRouter.post('/theme/preview', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const brief = String(req.body?.brief ?? '');
    if (brief.trim().length < 4) throw new HttpError(400, 'brief 描述过短（≥4 字）', 'BRIEF_TOO_SHORT');
    if (brief.length > 2000) throw new HttpError(400, 'brief 过长（≤2000 字）', 'BRIEF_TOO_LONG');
    const probe = await probeLlm();
    if (!probe.ready) throw new HttpError(503, `AI 通道不可用：${probe.error ?? '未知原因'}`, 'AGENT_NOT_READY');
    const r = await generateTheme(siteId, brief);
    await logThemePreview(siteId, brief, r.tokens, req.admin!.adminId, r.durationMs, r.tokensIn, r.tokensOut);
    res.json({ ok: true, data: { mode: 'theme-preview' as const, tokens: r.tokens, duration_ms: r.durationMs } });
  } catch (e) { next(e); }
});

/** POST /api/admin/ai/theme/apply {tokens, brief?} → 校验 + 合并写 site.theme（旧值存档 llm_log 可回滚） */
aiRouter.post('/theme/apply', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const tokens = (req.body?.tokens ?? {}) as Record<string, string>;
    const verr = validateTheme({ version: 1, tokens });
    if (verr) throw new HttpError(400, `色板非法：${verr}`, 'THEME_INVALID');
    const merged = await applyThemeTokens(siteId, tokens, `[theme-apply] ${String(req.body?.brief ?? '后台确认应用')}`, req.admin!.adminId);
    res.json({ ok: true, data: { applied: true, merged_keys: Object.keys(merged).length, theme: merged } });
  } catch (e) { next(e); }
});

/** POST /api/admin/ai/theme/reset → 恢复默认波普色板（一键回滚） */
aiRouter.post('/theme/reset', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const merged = await applyThemeTokens(siteId, DEFAULT_THEME_TOKENS, '[theme-reset] 恢复默认波普', req.admin!.adminId);
    res.json({ ok: true, data: { reset: true, theme: merged } });
  } catch (e) { next(e); }
});

/** POST /api/admin/ai/theme/rollback → 回滚到上一版配色（读最近 [theme-apply] 留痕的 prev 精确写回） */
aiRouter.post('/theme/rollback', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const { rows } = await pool.query(
      `SELECT schema_out FROM llm_log
        WHERE site_id = $1::uuid
          AND (prompt LIKE '[theme-apply]%' OR prompt LIKE '[theme-rollback]%')
        ORDER BY created_at DESC LIMIT 1`,
      [siteId]
    );
    const out = rows[0]?.schema_out as { prev?: Record<string, string> } | undefined;
    const prev = out?.prev;
    if (!prev) throw new HttpError(404, '没有可回滚的上一版配色（未曾应用过换肤）', 'ROLLBACK_NOT_FOUND');
    // 精确写回（非合并）：prev 是应用前的全量旧值，直接覆盖才能撤掉后来新增的 token
    const oldTheme = await readSiteTheme(siteId);
    await pool.query(`UPDATE site SET theme = $2::jsonb, updated_at = now() WHERE site_id = $1::uuid`, [siteId, JSON.stringify(prev)]);
    await pool.query(
      `INSERT INTO llm_log (site_id, prompt, schema_out, operator, model, status)
       VALUES ($1::uuid, $2::text, $3::jsonb, $4::bigint, 'cloudbase/hy3', 'ok')`,
      [siteId, '[theme-rollback] 回滚上一版', JSON.stringify({ prev: oldTheme, tokens: prev }), req.admin!.adminId]
    );
    res.json({ ok: true, data: { rolled_back: true, theme: prev } });
  } catch (e) { next(e); }
});

/** GET /api/admin/ai/theme → 当前全站配色 token */
aiRouter.get('/theme', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await oneSite(req.admin!, String(req.query?.site ?? req.headers['x-fyt-site'] ?? ''));
    const theme = await readSiteTheme(siteId);
    res.json({ ok: true, data: { theme, customized: Object.keys(theme).length > 0 } });
  } catch (e) { next(e); }
});
