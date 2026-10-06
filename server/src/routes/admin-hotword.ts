/**
 * 热搜词管理（032 迁移，2026-10-03）
 *
 * 背景：07B「相关搜索」原为端上硬编码 5 词，其中「每日坚果」「空气炸锅」站内无此商品
 *   → 点了必零结果（加戏）。本模块把词表落到 search_hotword，运营可增删改/调权重/启停，
 *   端上 GET /api/site/hot-words 实时拉。
 *
 * 铁律：热词必须来自真实数据面。seed 生成的词 source ∈ (service/category/rights) 可溯源；
 *   运营手工加的 source=manual。后台列表会同时展示 search_keyword_log 的真实搜索量，
 *   让运营知道「哪些词真有人搜」——当前只做展示不做统计看板。
 *
 * 挂载于 /api/admin/hotwords。
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';

export const hotwordAdminRouter = Router();

/** 站点解析（与 admin-checkin.ts 同款语义：显式 code > 单站点 > 超管取最早站点） */
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

/** GET /api/admin/hotwords?site=&q= → 热词列表（含真实搜索量，LEFT JOIN 聚合） */
hotwordAdminRouter.get('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await adminSiteId(req.admin!, String(req.query.site ?? ''));
    const q = String(req.query.q ?? '').trim();
    const onlyEnabled = String(req.query.enabled ?? '') === '1';

    const { rows } = await pool.query(
      // ⚠️ ORDER BY 必须写**带表别名的原始列** h.weight（int），不能依赖无别名 weight：
      //   本查询 SELECT 的是 h.weight::text（网关铁律：数值须全字符串返回），
      //   PG 会把无别名的 ORDER BY weight 解析到那个 text 输出列 → 字典序 → "1000"<"600" → 排序全乱。
      //   这里带 h. 前缀指向原列，故安全（对照：C 端 /hot-words 踩过这个坑，已改子查询）。
      `SELECT h.id::text        AS id,
              h.word,
              h.weight::text    AS weight,
              h.enabled,
              h.source,
              h.sort::text      AS sort,
              h.created_at,
              -- 真实搜索量：近 30 天该词被搜过几次（无人搜过为 0，不是 NULL）
              COALESCE(l.cnt, 0)::text AS search_cnt
         FROM search_hotword h
         LEFT JOIN (
              SELECT word, count(*)::int AS cnt
                FROM search_keyword_log
               WHERE site_id = $1::uuid AND created_at >= now() - interval '30 days'
               GROUP BY word
         ) l ON l.word = h.word
        WHERE h.site_id = $1::uuid
          AND ($2::text = '' OR h.word ILIKE '%' || $2 || '%')
          AND ($3::bool = false OR h.enabled = TRUE)
        ORDER BY h.weight DESC, h.sort, h.id
        LIMIT 500`,
      [siteId, q, onlyEnabled]
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/hotwords → 新增热词（weight/source 可选，默认手工词） */
hotwordAdminRouter.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await adminSiteId(req.admin!, String(req.body?.site ?? ''));
    const word = String(req.body?.word ?? '').trim();
    if (!word) throw new HttpError(400, '热词不能为空', 'WORD_REQUIRED');
    if (word.length > 64) throw new HttpError(400, '热词超长（上限 64）', 'WORD_TOO_LONG');
    // source 白名单：手工只能 manual，其余三种仅供 seed 使用
    const source = ['manual', 'service', 'category', 'rights'].includes(req.body?.source)
      ? String(req.body.source)
      : 'manual';
    const weight = Number.isFinite(Number(req.body?.weight)) ? Math.trunc(Number(req.body.weight)) : 500;

    // 站点内唯一；冲突则直接报错让运营改词（不静默覆盖已有权重）
    let created;
    try {
      const r = await pool.query(
        `INSERT INTO search_hotword (site_id, word, weight, enabled, source, sort)
         VALUES ($1::uuid, $2, $3, TRUE, $4, COALESCE((SELECT MAX(sort) + 1 FROM search_hotword WHERE site_id = $1::uuid), 0))
         RETURNING id::text AS id, word, weight::text, enabled, source`,
        [siteId, word, weight, source]
      );
      created = r.rows[0];
    } catch (e) {
      if (String((e as { code?: string }).code) === '23505') {
        throw new HttpError(409, `热词「${word}」已存在，请直接编辑`, 'WORD_DUPLICATED');
      }
      throw e;
    }
    await writeAudit(req, { action: 'hotword.create', target_type: 'hotword', target_id: created.id, site_id: siteId, detail: { word, weight, source } });
    res.json({ ok: true, data: created });
  } catch (e) {
    next(e);
  }
});

/** PUT /api/admin/hotwords/:id → 改词/权重/启停 */
hotwordAdminRouter.put('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await adminSiteId(req.admin!, String(req.body?.site ?? ''));
    const id = String(req.params.id);
    const { rows: cur } = await pool.query(
      `SELECT word, weight, enabled FROM search_hotword WHERE id = $1::bigint AND site_id = $2::uuid`,
      [id, siteId]
    );
    if (!cur[0]) throw new HttpError(404, '热词不存在或不属于当前站点', 'NOT_FOUND');

    const word = req.body?.word === undefined ? cur[0].word : String(req.body.word).trim();
    if (!word) throw new HttpError(400, '热词不能为空', 'WORD_REQUIRED');
    if (word.length > 64) throw new HttpError(400, '热词超长（上限 64）', 'WORD_TOO_LONG');
    const weight = req.body?.weight === undefined
      ? Number(cur[0].weight)
      : (Number.isFinite(Number(req.body.weight)) ? Math.trunc(Number(req.body.weight)) : Number(cur[0].weight));
    const enabled = req.body?.enabled === undefined ? cur[0].enabled : !!req.body.enabled;

    const r = await pool.query(
      `UPDATE search_hotword
          SET word = $1, weight = $2, enabled = $3, updated_at = now()
        WHERE id = $4::bigint AND site_id = $5::uuid
      RETURNING id::text AS id, word, weight::text, enabled, source`,
      [word, weight, enabled, id, siteId]
    );
    await writeAudit(req, { action: 'hotword.update', target_type: 'hotword', target_id: id, site_id: siteId, detail: { word, weight, enabled } });
    res.json({ ok: true, data: r.rows[0] });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/admin/hotwords/:id → 删词 */
hotwordAdminRouter.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await adminSiteId(req.admin!, String(req.query.site ?? ''));
    const id = String(req.params.id);
    // ⚠️ 网关 rowCount = rows.length：DELETE 判影响行数必须 RETURNING，否则恒 0（决策#34 踩过）
    const r = await pool.query(
      `DELETE FROM search_hotword WHERE id = $1::bigint AND site_id = $2::uuid RETURNING word`,
      [id, siteId]
    );
    if (!r.rows.length) throw new HttpError(404, '热词不存在或不属于当前站点', 'NOT_FOUND');
    await writeAudit(req, { action: 'hotword.delete', target_type: 'hotword', target_id: id, site_id: siteId, detail: { word: r.rows[0].word } });
    res.json({ ok: true, data: { id, word: r.rows[0].word } });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/hotwords/reseed → 重跑种子（补新词，不覆盖运营调过的权重） */
hotwordAdminRouter.post('/reseed', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await adminSiteId(req.admin!, String(req.body?.site ?? ''));
    // 与 seed-hotwords.mjs 保持同一词源与权重策略；ON CONFLICT DO NOTHING 保护人工调优
    const svc = await pool.query(`SELECT name FROM brand_action_cfg WHERE enabled = TRUE`);
    const cat = await pool.query(`SELECT name FROM brand_category`);
    let n = 0;
    const ins = async (word: string, source: string, weight: number) => {
      const w = String(word ?? '').trim();
      if (!w) return;
      await pool.query(
        `INSERT INTO search_hotword (site_id, word, weight, enabled, source, sort)
         VALUES ($1::uuid, $2, $3, TRUE, $4, $5)
         ON CONFLICT (site_id, word) DO NOTHING`,
        [siteId, w, weight, source, n++]
      );
    };
    for (const r of cat.rows) await ins(r.name, 'category', 1000);
    for (const r of svc.rows) await ins(r.name, 'service', 600);
    // 权益档需实时拉上游，这里不重复实现：提示走 seed 脚本，避免与脚本两处逻辑漂移
    await writeAudit(req, { action: 'hotword.reseed', target_type: 'hotword', target_id: siteId, site_id: siteId, detail: { added: n } });
    res.json({
      ok: true,
      data: {
        added: n,
        note: '分类+服务两档已补齐；权益档需实时拉 fasttype，请在 deploy/scripts/seed-hotwords.mjs 跑一次',
      },
    });
  } catch (e) {
    next(e);
  }
});
