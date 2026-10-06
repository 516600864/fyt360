import { Router, type Request as ExpressRequest } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, optionalUser } from '../middleware/auth.js';
import { invalidateProviderCache, resolveHjkConfig } from '../lib/provider.js';
import { normalizeTabbarConfig } from '../lib/tabbar.js';
import { writeAudit } from '../lib/audit.js';
import { fetchFasttype } from '../lib/haojingke.js';

export const siteRouter = Router();

/* ── 07B 服务直达聚合搜索类型（D先生 定稿 2026-10-03）─────────────────────────
 * track 是分发的唯一依据，不再像旧实现那样「按品牌名猜轨道」——同名异质轨道
 * （如「肯德基」既有 plugin 点餐插件、又有 rights 积分兑换）必须能并存。 */
type ServiceTrack = 'plugin' | 'halfscreen' | 'act' | 'launch' | 'rights' | 'self';

type ServiceHit = {
  track: ServiceTrack;
  name: string;
  // A/B 轨道：呼起配置
  brand_code?: string;
  brand_name?: string;
  mode?: string;
  cat_name?: string;
  cat_code?: string;
  icon?: string;
  via_category?: boolean;
  // C 轨道：fasttype 权益（cid 兑换档位 + 蚂蚁侧积分，非本系统元宝）
  cid?: number;
  img?: string;
  points_min?: number;
  points_max?: number;
  max_save?: number;
  // D 轨道：到店团购
  goods_id?: string;
  pic?: string;
  price?: number;
  sales?: number;
};

/** 网关 jsonb 可能被二次编码为字符串，统一在此解包 */
function parseJsonb<T>(v: unknown, fallback: T): T {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return (v as T) ?? fallback;
}

/**
 * 站点配置下发（小程序空壳启动流程：登录 → 拉站点配置 → 渲染默认首页 Schema）
 * 按 code 或 site_id 查询；M1 阶段默认返回示例站点 A。
 */
siteRouter.get('/config', async (req, res, next) => {
  try {
    const siteCode = (req.query.code as string) ?? '';
    const siteId = (req.query.site_id as string) ?? '';

    const { rows } = await pool.query(
      `SELECT site_id, name, code, theme, plugins, halfscreen_cfg, launch_matrix, domain, shop_addr, status, tabbar
         FROM site
        WHERE ($1 <> '' AND site_id::text = $1)
           OR ($2 <> '' AND code = $2)
        LIMIT 1`,
      [siteId, siteCode]
    );

    const site = rows[0];
    if (!site || site.status !== 'active') {
      throw new HttpError(404, '站点不存在或未启用', 'SITE_NOT_FOUND');
    }

    // 默认首页 Schema（由 page_schema 表下发；无 published 时端内回退内置默认装修）
    const { rows: schemaRows } = await pool.query(
      `SELECT page, schema_json, version FROM page_schema
        WHERE site_id = $1 AND page IN ('home', 'home_h5') AND status = 'published'
        ORDER BY version DESC`,
      [site.site_id]
    );
    const pick = (page: string) => schemaRows.find((r) => r.page === page);
    const toHome = (r?: { schema_json: unknown; version: number }) =>
      r
        ? { schema: parseJsonb<unknown>(r.schema_json, null), version: r.version }
        : { schema: null, version: 0 };
    const tabbarCfg = normalizeTabbarConfig(site.tabbar);

    res.json({
      ok: true,
      data: {
        site,
        home: toHome(pick('home')),
        h5_home: toHome(pick('home_h5')),
        // tabbar-v2（决策#28 壳页架构 + 决策#30 毛玻璃 4+1）：归一输出 items/style/fab（兼容历史数组形态）
        tabbar: tabbarCfg?.items ?? null,
        tabbar_style: tabbarCfg?.style ?? null,
        tabbar_fab: tabbarCfg?.fab ?? null,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/site/page-schema?code=site-a&page=page-xxxx（M4 壳页：Tab2~5 指向 Schema 页时壳页拉取）
 * 仅下发 published；无 published 返回 schema=null（端上显示「页面未发布」占位）
 */
siteRouter.get('/page-schema', async (req, res, next) => {
  try {
    const siteCode = (req.query.code as string) ?? '';
    const page = String(req.query.page ?? '').trim();
    if (!/^page-[a-z0-9]{2,10}$/.test(page)) throw new HttpError(400, 'page 非法（须为 page-xxx）', 'BAD_PAGE');

    const { rows: siteRows } = await pool.query(
      `SELECT site_id, theme FROM site WHERE ($1 <> '' AND code = $1) AND status = 'active' LIMIT 1`,
      [siteCode]
    );
    const site = siteRows[0];
    if (!site) throw new HttpError(404, '站点不存在或未启用', 'SITE_NOT_FOUND');

    const { rows: schemaRows } = await pool.query(
      `SELECT schema_json, version FROM page_schema
        WHERE site_id = $1 AND page = $2 AND status = 'published'
        ORDER BY version DESC LIMIT 1`,
      [site.site_id, page]
    );
    const row = schemaRows[0];
    // 决策#34 补丁：随 schema 下发站点 theme（ShellView schema 分支此前恒 null，活动页/装修壳页吃不到换肤）
    const theme = parseJsonb<Record<string, string>>(site.theme, {});
    res.json({
      ok: true,
      data: row
        ? { page, published: true, version: row.version, schema: parseJsonb<unknown>(row.schema_json, null), theme }
        : { page, published: false, version: 0, schema: null, theme },
    });
  } catch (e) { next(e); }
});

/**
 * 站点级供应商凭据录入（M2.2 最小闭环，无 seed 无 UI）：
 * apikey/secret 跟 site_id 走（决策 #25①，严禁 .env/seed 注入）。
 * provider 枚举：mayixingqiu（蚂蚁星球）/ wechat_mini（小程序 appid/secret）。
 * body: { site_id? | code?, provider, apikey, api_secret?, rate_limit? }
 */
siteRouter.post('/provider', requireAdmin, async (req, res, next) => {
  try {
    const provider = String(req.body?.provider ?? '').trim();
    // 留空 = 保留原值（编辑态不重输全文）；新建时空值直接拒
    const apikey = String(req.body?.apikey ?? '').trim();
    const apiSecretRaw = String(req.body?.api_secret ?? '').trim();
    const status = ['active', 'disabled'].includes(String(req.body?.status)) ? String(req.body.status) : 'active';
    if (!provider) throw new HttpError(400, 'provider 必填', 'BAD_REQUEST');

    let siteId = String(req.body?.site_id ?? '').trim();
    let siteCode = String(req.body?.code ?? '').trim();
    if (!siteId && !siteCode) throw new HttpError(400, 'site_id 或 code 必填其一', 'BAD_REQUEST');

    if (!siteId) {
      const { rows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [siteCode]);
      if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
      siteId = String(rows[0].site_id);
    } else {
      const { rows } = await pool.query(`SELECT code FROM site WHERE site_id::text = $1 LIMIT 1`, [siteId]);
      if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
      siteCode = String(rows[0].code);
    }

    assertSiteAccess(req.admin!, siteId);

    const { rows: ex } = await pool.query(
      `SELECT apikey FROM provider_config WHERE site_id::text = $1 AND provider = $2 LIMIT 1`,
      [siteId, provider],
    );
    if (!ex[0] && !apikey) throw new HttpError(400, 'apikey 必填（该站点尚未配置此供应商）', 'BAD_REQUEST');

    await pool.query(
      `INSERT INTO provider_config (site_id, provider, apikey, api_secret, status)
       VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5)
       ON CONFLICT (site_id, provider) DO UPDATE
         SET apikey = COALESCE(NULLIF(EXCLUDED.apikey, ''), provider_config.apikey),
             api_secret = COALESCE(NULLIF(EXCLUDED.api_secret, ''), provider_config.api_secret),
             status = EXCLUDED.status,
             updated_at = now()`,
      [siteId, provider, apikey, apiSecretRaw, status]
    );
    invalidateProviderCache(siteCode);
    await writeAudit(req, { action: 'provider.save', target_type: 'provider', target_id: `${siteCode}/${provider}`, site_id: siteId, detail: { status } });

    res.json({ ok: true, data: { siteId, siteCode, provider } });
  } catch (e) {
    next(e);
  }
});

/** GET /api/site/brand-search?keyword=<词> → 呼起配置库品牌命中
 *  @deprecated 2026-10-03 已被 /service-search 取代（该端点只匹配品牌名字面，搜不出分类下服务，
 *    如「美团」只能命中 5/32 条）。保留供生活服务页等旧调用方使用，功能不再变更。
 *  fasttype 目录没有的品牌（麦当劳/星巴克/必胜客/库迪等点餐类）在 brand_action_cfg 里，按名双向模糊补齐 */
siteRouter.get('/brand-search', optionalUser, async (req, res, next) => {
  try {
    const kw = String(req.query.keyword ?? '').trim();
    if (!kw) throw new HttpError(400, '缺少关键词', 'BAD_PARAM');
    const { rows } = await pool.query(
      `SELECT brand_code, name FROM brand_action_cfg
        WHERE enabled = TRUE AND (name ILIKE '%' || $1 || '%' OR $1 ILIKE '%' || name || '%')
        ORDER BY CASE WHEN name = $1 THEN 0 ELSE 1 END, name LIMIT 5`,
      [kw],
    );
    res.json({ ok: true, data: { brands: rows.map((r) => ({ brand_code: r.brand_code, name: r.name })) } });
  } catch (e) {
    next(e);
  }
});

/** 会员权益动态目录兜底（D先生 定稿 2026-09-29：会员权益所有项都要能呼起）。
 *  brand_action_cfg 未命中时按品牌名查 fasttype 目录；命中 → 复用 life_05 权益兑换轨（半屏 + cid 档位参数，
 *  与 grade 页兑换同款协议）。不静态播种 fasttype 动态品牌（上游目录漂移会失同步），呼起轨道唯一真源仍是 brand_action_cfg.life_05。 */
async function fallbackRightsLaunch(
  brandName: string,
  req: ExpressRequest,
): Promise<{ name: string; action_type: string; miniapp_cfg: unknown; h5_cfg: unknown } | null> {
  if (!brandName) return null;
  let siteCode: string | undefined;
  if (req.user?.siteId) {
    const { rows: srows } = await pool.query(`SELECT code FROM site WHERE site_id = $1 LIMIT 1`, [req.user.siteId]);
    siteCode = srows[0]?.code;
  }
  const apikey = (await resolveHjkConfig(siteCode)).apikey;
  // 统一取数：8s 超时 + 5min 缓存（此处为 tapRights 兜底路径，失败仅返回 null 不阻断主轨）
  const ft = await fetchFasttype(apikey);
  const list = ft.ok ? ft.data : [];
  const hit = list.find((x) => {
    const nm = String(x.cname ?? x.couponName ?? '');
    return nm && (nm.includes(brandName) || brandName.includes(nm));
  });
  if (!hit) return null;
  const { rows: lrows } = await pool.query(
    `SELECT name, action_type, miniapp_cfg FROM brand_action_cfg WHERE brand_code = 'life_05' AND enabled = TRUE LIMIT 1`,
  );
  if (!lrows[0]) return null;
  return {
    name: String(hit.cname ?? hit.couponName ?? brandName),
    action_type: String(lrows[0].action_type ?? 'halfscreen'),
    miniapp_cfg: lrows[0].miniapp_cfg,
    h5_cfg: null,
  };
}

/** GET /api/site/brand-launch?code=<brand_code> → 品牌呼起配置（plugin-launch 数据面）
 *  读 brand_action_cfg.miniapp_cfg {appid,path,mode}；未录入/空壳 → 404 诚实（不造假映射）
 *  占位符协议（009 初始化数据，蚂蚁星球半屏路径）：{apikey}=mayixingqiu key（跟站点走）、{uid}=登录 user_id（匿名 1） */
siteRouter.get('/brand-launch', optionalUser, async (req, res, next) => {
  try {
    const code = String(req.query.code ?? '').trim();
    const brandName = String(req.query.brand_name ?? '').trim();
    if (!code && !brandName) throw new HttpError(400, '缺少品牌码或品牌名', 'BAD_PARAM');
    // code=配置码（life_05 等）；brand_name=品牌名模糊匹配（search-result 品牌直达按蚂蚁品牌名呼起，如「肯德基」→ dining_04）
    const { rows } = brandName
      ? await pool.query(
          `SELECT name, action_type, miniapp_cfg, h5_cfg FROM brand_action_cfg
            WHERE enabled = TRUE AND (name = $1 OR name ILIKE '%' || $1 || '%' OR $1 ILIKE '%' || name || '%')
            ORDER BY CASE WHEN name = $1 THEN 0 ELSE 1 END LIMIT 1`,
          [brandName],
        )
      : await pool.query(
          `SELECT name, action_type, miniapp_cfg, h5_cfg FROM brand_action_cfg
            WHERE brand_code = $1::text AND enabled = TRUE LIMIT 1`,
          [code],
        );
    const row = rows[0] ?? (await fallbackRightsLaunch(brandName, req));
    if (!row) throw new HttpError(404, '品牌呼起配置未录入', 'BRAND_NOT_FOUND');
    const cfg = parseJsonb<Record<string, string>>(row.miniapp_cfg, {});
    // mode=act（蚂蚁星球活动动态转链，016 映射）→ 实时调 actunionurl 透传，转链结果不落库（CPS 铁律）
    if (cfg.mode === 'act') {
      const actid = String(cfg.actid ?? '').trim();
      if (!actid) throw new HttpError(404, '该品牌未配置活动ID', 'LAUNCH_NOT_CONFIGURED');
      let siteCodeAct: string | undefined;
      if (req.user?.siteId) {
        const { rows: srows } = await pool.query(`SELECT code FROM site WHERE site_id = $1 LIMIT 1`, [req.user.siteId]);
        siteCodeAct = srows[0]?.code;
      }
      const apikeyAct = (await resolveHjkConfig(siteCodeAct)).apikey;
      const uidAct = req.user ? String(req.user.userId) : '1';
      // 实时转链（不落库，CPS 铁律）→ 8s 超时防端上 await 挂死（2026-10-03）
      const actCtrl = new AbortController();
      const actTimer = setTimeout(() => actCtrl.abort(), 8000);
      let r: Response;
      try {
        r = await fetch('https://api-gw.haojingke.com/index.php/v2/api/index/actunionurl', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apikey: apikeyAct, actid, extend_id: uidAct }),
          signal: actCtrl.signal,
        });
      } catch (e) {
        clearTimeout(actTimer);
        const msg = e instanceof Error && e.name === 'AbortError' ? '活动转链超时，请重试' : '活动转链失败';
        throw new HttpError(502, msg, e instanceof Error && e.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'LAUNCH_CONVERT_FAILED');
      }
      clearTimeout(actTimer);
      const j = (await r.json().catch(() => null)) as
        | { data?: { url?: string; we_app_info?: { app_id?: string; path?: string } } }
        | null;
      const w = j?.data?.we_app_info;
      if (w?.app_id) {
        // 官方小程序（美团/饿了么/滴滴/飞猪等）→ 映射 appid/path，端上走 navigateToMiniProgram 兜底
        return res.json({ ok: true, data: { name: row.name, action_type: 'launch', appid: w.app_id, path: w.path ?? '', mode: 'launch' } });
      }
      const url = String(j?.data?.url ?? '');
      if (url) {
        // 无官方小程序的联盟 H5 链接（tb/pdd/jd/vip 等）→ h5url 模式；
        // tb 活动响应带 tkl 真淘口令（实测 2026-09-30），随 data 下发供端上跳中转口令页
        const tkl = String((j?.data as Record<string, unknown> | null | undefined)?.tkl ?? '');
        return res.json({ ok: true, data: { name: row.name, action_type: 'launch', appid: '', url, mode: 'h5url', ...(tkl ? { tkl } : {}) } });
      }
      throw new HttpError(502, '活动转链失败', 'LAUNCH_CONVERT_FAILED');
    }
    // mode=plugin（mayi-ordering 等宿主内嵌插件，010 确认数据）只需 path，由端上 navigateTo(plugin://) 打开
    if (cfg.mode === 'plugin') {
      if (!cfg.path) throw new HttpError(404, '该品牌未配置插件路径', 'LAUNCH_NOT_CONFIGURED');
    } else if (!cfg.appid) {
      throw new HttpError(404, '该品牌未配置小程序呼起参数', 'LAUNCH_NOT_CONFIGURED');
    }

    // 占位符动态替换（仅 path 中出现时才解析供应商凭据，未配置则诚实 503）
    let path = cfg.path ?? '';
    if (path.includes('{apikey}') || path.includes('{uid}')) {
      let siteCode: string | undefined;
      if (req.user?.siteId) {
        const { rows: srows } = await pool.query(`SELECT code FROM site WHERE site_id = $1 LIMIT 1`, [req.user.siteId]);
        siteCode = srows[0]?.code;
      }
      let apikey = '';
      if (path.includes('{apikey}')) {
        apikey = (await resolveHjkConfig(siteCode)).apikey;
      }
      const uid = req.user ? String(req.user.userId) : '1';
      path = path.replaceAll('{apikey}', apikey).replaceAll('{uid}', uid);
    }

    res.json({ ok: true, data: { name: row.name, action_type: row.action_type, appid: cfg.appid ?? '', path, mode: cfg.mode ?? 'launch' } });
  } catch (e) {
    next(e);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
 * GET /api/site/service-search?keyword=<词>
 * 07B「服务直达」聚合搜索（D先生 定稿 2026-10-03）。取代旧 brand-search 的根因：
 *   旧端点只匹配 brand_action_cfg.name 字面 → 搜「美团」只命中 5/32 条（闪购红包/大牌饮品等
 *   名字里不带「美团」的全搜不到），且与 fasttype 权益目录按 name 互去重，把「肯德基」这类
 *   同名但异质的两条轨道（点餐插件 vs 积分兑换）吃掉一条。
 * 新模型：每条命中显式带 track，端上按 track 分发点击，不再按名字猜轨道。
 *
 * 轨道（互相独立，可同时命中同名）：
 *   A 服务 track=plugin|halfscreen|act  brand_action_cfg 品牌名字面命中（≤20）
 *   B 分类 track 同上，分类命中 → 回填该分类下全部 enabled 服务（如「美团」→ meituan 32 项）
 *   C 权益 track=rights              fasttype 实时目录（蚂蚁星球积分口径，不是我方元宝）
 *   D 到店 track=self                 self_goods（唯一自有数据面，CPS 铁律不涉及）
 * 权益轨道与元宝无关（D先生 纠正）：fasttype 的 min/max_points 是蚂蚁侧积分，端上文案须写「积分」。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** /service-search 整份结果缓存 TTL：60s。
 *  目录数据（brand_action_cfg / fasttype / self_goods）分钟级不变，60s 足够；
 *  换来的是命中即 0 外部调用，消掉容器冷实例首搜 3.2s 的抖动。 */
const SEARCH_RESULT_TTL_MS = 60_000;
const searchResultCache = new Map<string, { at: number; data: Record<string, unknown> }>();

/** fasttype 权益目录 → 服务直达 track=rights 命中项（蚂蚁积分口径；失败返回空数组不阻塞他轨） */
async function searchRightsTrack(kw: string, req: ExpressRequest): Promise<{ hits: ServiceHit[]; degraded: boolean }> {
  let siteCode: string | undefined;
  if (req.user?.siteId) {
    const { rows } = await pool.query(`SELECT code FROM site WHERE site_id = $1 LIMIT 1`, [req.user.siteId]);
    siteCode = rows[0]?.code;
  }
  const { apikey } = await resolveHjkConfig(siteCode);
  // 统一取数：8s 超时 + 5min 进程内缓存 + 并发去重（裸fetch 曾导致搜京东卡死，2026-10-03）
  const ft = await fetchFasttype(apikey);
  // degraded=true 表示 fasttype 本次不可用（超时/上游残缺），调用方据此**不写结果缓存**，
  // 避免把「有品牌服务但权益轨全空」的残缺结果固化（2026-10-03 实测踩过）。
  if (!ft.ok) return { hits: [], degraded: true };
  const out: ServiceHit[] = [];
  for (const x of ft.data) {
    const [rawImg = '', rawSpec = ''] = String(x.img ?? '').split('|');
    const spec = rawSpec.replace(/!img$/, '').trim();
    const brand = String(x.cname ?? x.couponName ?? '');
    if (!brand) continue;
    // 条目名 / 品牌名 / 分组名（type）任一命中即算——搜「餐饮美食」可捞出整组品牌
    const type = String(x.type ?? '') || '其他';
    if (!brand.includes(kw) && !type.includes(kw) && !`${brand} ${spec}`.includes(kw)) continue;
    out.push({
      track: 'rights',
      name: brand + (spec ? ` ${spec}` : ''),
      brand_name: brand,
      cat_name: type,
      cid: Number(x.id),
      // img 仅作服务端留档，端上不渲染（上游图URL 含中文未编码 + 域名无小程序白名单，
      // 实测 403；D先生 2026-10-03 定：权益图标一律用品牌首字）
      img: rawImg.replace(/!img$/, ''),
      // 蚂蚁星球侧积分，非本系统元宝（D先生 纠正 2026-10-03）
      points_min: Number(x.min_points ?? 0),
      points_max: Number(x.max_points ?? 0),
      max_save: Number(x.max_save ?? 0),
    });
  }
  return { hits: out.slice(0, 20), degraded: false };
}

siteRouter.get('/service-search', optionalUser, async (req, res, next) => {
  try {
    const kw = String(req.query.keyword ?? '').trim();
    if (!kw) throw new HttpError(400, '缺少关键词', 'BAD_PARAM');

    // ── 结果级缓存（2026-10-03 修「搜京东还是卡死」）────────────────────────
    // 实测冷路径：京东是唯一「分类展开(14 项) + 权益域」双全的词，容器冷启动后首搜达 3.2s
    // （warm 0.2~0.5s，fasttype 上游本身 0.2~0.5s，DB 查询毫秒级 → 抖动来自实例冷连接）。
    // 服务端已给 fasttype 打了 5min TTL，但每个实例各自建连接，冷实例仍在同步等上游。
    // 这里再叠一层「整份结果」缓存，命中即 0 外部调用；TTL 60s 对搜索场景完全够（目录分钟级不变）。
    const cacheKey = `${req.user?.siteId ?? 'all'}::${kw.toLowerCase()}`;
    const cachedAgg = searchResultCache.get(cacheKey);
    if (cachedAgg && Date.now() - cachedAgg.at < SEARCH_RESULT_TTL_MS) {
      res.json({ ok: true, data: cachedAgg.data, cached: true });
      return;
    }

    // ── 轨道 B：分类命中（「美团」命中 meituan 分类，回填该分类全部服务）──────────
    const catRows = await pool.query(
      `SELECT c.code, c.name, c.sort, COUNT(b.id)::text AS cnt
         FROM brand_category c
         JOIN brand_action_cfg b ON b.category = c.code AND b.enabled = TRUE
        WHERE c.name ILIKE '%' || $1 || '%' OR c.code ILIKE '%' || $1 || '%'
        GROUP BY c.code, c.name, c.sort
        ORDER BY c.sort`,
      [kw],
    );
    const catCodes = new Set((catRows.rows as Array<{ code: string }>).map((r) => r.code));

    // ── 轨道 A：品牌字面命中（分类内服务若已随B 全量返回，这里跳过避免重复）────────
    const brandRows = await pool.query(
      `SELECT b.brand_code, b.name, b.category, c.name AS cat_name,
              COALESCE(b.miniapp_cfg->>'mode', b.action_type) AS mode, b.icon
         FROM brand_action_cfg b
         JOIN brand_category c ON c.code = b.category
        WHERE b.enabled = TRUE
          AND (b.name ILIKE '%' || $1 || '%' OR $1 ILIKE '%' || b.name || '%')
        ORDER BY CASE WHEN b.name = $1 THEN 0 ELSE 1 END, c.sort, b.id
        LIMIT 20`,
      [kw],
    );

    // 轨道 B 的展开明细：分类命中的服务全量拉出（未在轨道 A 出现的也算，这是「美团」的关键增量）
    const expandedRows = catCodes.size
      ? await pool.query(
          `SELECT b.brand_code, b.name, b.category, c.name AS cat_name,
                  COALESCE(b.miniapp_cfg->>'mode', b.action_type) AS mode, b.icon
             FROM brand_action_cfg b
             JOIN brand_category c ON c.code = b.category
            WHERE b.enabled = TRUE AND b.category = ANY($1::text[])
            ORDER BY c.sort, b.id`,
          [[...catCodes]],
        )
      : { rows: [] };

    const services: ServiceHit[] = [];
    const seen = new Set<string>();
    for (const r of brandRows.rows) {
      const key = `${r.category}::${r.brand_code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      services.push({
        track: (r.mode === 'plugin' || r.mode === 'halfscreen' || r.mode === 'act' ? r.mode : 'launch') as ServiceTrack,
        brand_code: r.brand_code,
        brand_name: r.name,
        name: r.name,
        cat_name: r.cat_name,
        cat_code: r.category,
        mode: r.mode,
        icon: r.icon ?? '',
      });
    }
    for (const r of expandedRows.rows) {
      const key = `${r.category}::${r.brand_code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      services.push({
        track: (r.mode === 'plugin' || r.mode === 'halfscreen' || r.mode === 'act' ? r.mode : 'launch') as ServiceTrack,
        brand_code: r.brand_code,
        brand_name: r.name,
        name: r.name,
        cat_name: r.cat_name,
        cat_code: r.category,
        mode: r.mode,
        icon: r.icon ?? '',
        // 分类展开来的项前端默认折叠（头部显示「共 N 个服务」，默认 6 条 + 展开全部）
        via_category: true,
      });
    }

    // ── 轨道 C：fasttype 权益（蚂蚁积分口径）────────────────────────────────
    const { hits: rights, degraded: rightsDegraded } = await searchRightsTrack(kw, req).catch(
      // 权益轨异常不阻塞他轨（设计如此），但必须标记降级 → 不写结果缓存
      () => ({ hits: [] as ServiceHit[], degraded: true }),
    );

    // ── 轨道 D：到店团购（唯一自有数据面；价格/图从 skus/main_imgs jsonb 取，与 /api/goods/self/list 同款契约）
    const selfRows = await pool.query(
      `SELECT goods_id, title, main_imgs, skus
         FROM self_goods
        WHERE site_id = COALESCE($1::uuid, (SELECT site_id FROM site WHERE code='site-a'))
          AND status = 'on'
          AND title ILIKE '%' || $2 || '%'
        ORDER BY created_at DESC
        LIMIT 10`,
      [req.user?.siteId ?? null, kw],
    );
    const selfItems: ServiceHit[] = (selfRows.rows as Array<Record<string, unknown>>).map((r) => {
      const skus = Array.isArray(r.skus) ? (r.skus as { price?: number }[]) : [];
      const prices = skus.map((k) => Number(k.price)).filter((n) => Number.isFinite(n));
      const imgs = Array.isArray(r.main_imgs) ? (r.main_imgs as string[]) : [];
      return {
        track: 'self' as const,
        goods_id: String(r.goods_id),
        name: String(r.title),
        pic: imgs[0] ?? '',
        price: prices.length ? Math.min(...prices) : undefined,
      };
    });

    // 分类命中摘要：头部「共 N 个服务」
    const categories = catRows.rows.map((r) => ({
      code: r.code,
      name: r.name,
      count: Number(r.cnt),
    }));

    res.json({
      ok: true,
      data: {
        keyword: kw,
        categories,
        services,
        rights,
        selfItems,
        total: { services: services.length, rights: rights.length, self: selfItems.length },
      },
    });

    // 成功才写缓存（失败不污染下次）；容量上限防关键词爆炸打爆内存
    // ⚠️ 权益轨降级时不写缓存（2026-10-03 实测）：fasttype 上游会瞬时返回残缺目录
    //   （实测同一 key 出现 47 vs 完整 81 条，肯德基等整组消失）。若把「有品牌服务、
    //   但权益轨为空」的结果固化 60s，这段时间内同类搜索都缺权益轨；叠加
    //   fetchFasttype 的 5min TTL 缓存会放大到数分钟，且上游直连看完全正常，极难定位。
    //   判据用「本次权益轨不可用」而非「结果全空」——后者挡不住部分残缺。
    if (rightsDegraded) {
      console.warn(`[service-search] 关键词「${kw}」权益轨降级（fasttype 不可用），本次不写结果缓存`);
      return;
    }
    if (searchResultCache.size >= 500) {
      // Map 保持插入序，删最早 50 条即可近似 LRU
      const drop = [...searchResultCache.keys()].slice(0, 50);
      for (const k of drop) searchResultCache.delete(k);
    }
    searchResultCache.set(cacheKey, {
      at: Date.now(),
      data: { keyword: kw, categories, services, rights, selfItems, total: { services: services.length, rights: rights.length, self: selfItems.length } },
    });
  } catch (e) {
    next(e);
  }
});



/* ==========================================================================
 * GET /api/site/hot-words?limit=10
 * 07B「相关搜索」真实词表（032 迁移，2026-10-03）。
 *
 * 替换掉的旧实现：端上硬编码 5 词 ['每日坚果','空气炸锅','肯德基','麦当劳','视频会员']。
 *   「每日坚果」「空气炸锅」站内无此商品 → 点了必零结果（AI 加戏）；
 *   后 3 个是 brand_action_cfg 的硬编码快照，品牌改名/下架后不会跟着变。
 * 现在词表落 search_hotword，运营可在后台增删改/调权重/启停，词源全部来自真实数据面。
 *
 * 60s 结果级缓存：与 /service-search 同一套思路（目录分钟级不变，命中即 0 DB 查询）。
 * ========================================================================== */
const HOTWORD_TTL_MS = 60_000;
const hotwordCache = new Map<string, { at: number; data: unknown }>();

siteRouter.get('/hot-words', optionalUser, async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 10) || 10));
    const siteId = req.user?.siteId ?? null;
    const key = `${siteId ?? 'all'}:${limit}`;

    const hit = hotwordCache.get(key);
    if (hit && Date.now() - hit.at < HOTWORD_TTL_MS) {
      res.json({ ok: true, data: hit.data, cached: true });
      return;
    }

    const { rows } = await pool.query(
      // ⚠️ 排序必须用**数值列** w.weight，不能写 ORDER BY weight：
      //   本查询 SELECT 的是 weight::text（网关铁律：数值须全字符串返回），
      //   PG 会把无别名的 ORDER BY weight 解析到那个 text 输出列 → 字典序比较 →
      //   "1000" < "600" → 权重最高的分类词被排到末尾（实测踩过，端上表现为「热词顺序全乱」）。
    //   正确写法：子查询里 w.weight::text 取值，外层用 w.weight（原始 int）排序。
      `SELECT w.word, w.weight::text AS weight
         FROM (SELECT word, weight FROM search_hotword
                WHERE enabled = TRUE
                  AND ($1::uuid IS NULL OR site_id = $1::uuid)
                ORDER BY weight DESC, sort, id
                LIMIT $2) w`,
      [siteId, limit]
    );
    const data = { words: rows };
    if (hotwordCache.size >= 100) {
      for (const k of [...hotwordCache.keys()].slice(0, 20)) hotwordCache.delete(k);
    }
    hotwordCache.set(key, { at: Date.now(), data });
    res.json({ ok: true, data });
  } catch (e) {
    next(e);
  }
});

/** 后台改词后调此接口清缓存（词表变了端上要立刻生效，不等 60s TTL 自然过期） */
siteRouter.post('/hot-words/invalidate', requireAdmin, async (req, res, next) => {
  try {
    hotwordCache.clear();
    res.json({ ok: true, data: { cleared: true } });
  } catch (e) {
    next(e);
  }
});

/* ==========================================================================
 * POST /api/site/search-log  { word, source?, hitCount? }
 * 真实搜索词上报（032 迁移）。
 *
 * 只入库，不做统计看板 —— 现在没有真实流量，统计出来是空的。
 * 但先把词落表：有量后一条 GROUP BY word 即可出真热搜，替代人工配词，
 * 后台热词管理页已 LEFT JOIN 展示近 30 天搜索量，运营能直接看到哪些词真有人搜。
 *
 * 设计要点：
 *   · optionalUser —— 匿名搜索也要能记（大部分搜索发生在未登录态），未登录 user_id 为 NULL。
 *   · 词长上限 64，超长截断（防脏数据/超长注入）。
 *   · 端上 fire-and-forget，写入失败静默，绝不因上报失败影响用户搜索。
 * ========================================================================== */
siteRouter.post('/search-log', optionalUser, async (req, res, next) => {
  try {
    const word = String(req.body?.word ?? '').trim().slice(0, 64);
    if (!word) throw new HttpError(400, '搜索词不能为空', 'WORD_REQUIRED');
    const source = ['search_result', 'search', 'home_search'].includes(req.body?.source)
      ? String(req.body.source)
      : 'search_result';
    const hitCount = Number.isFinite(Number(req.body?.hitCount))
      ? Math.max(0, Math.min(9999, Math.trunc(Number(req.body.hitCount))))
      : 0;

    const { rows } = await pool.query(
      `INSERT INTO search_keyword_log (site_id, word, user_id, source, hit_count)
       VALUES (COALESCE($1::uuid, (SELECT site_id FROM site WHERE code = 'site-a')), $2, $3, $4, $5)
       RETURNING id::text`,
      [req.user?.siteId ?? null, word, req.user?.userId ?? null, source, hitCount]
    );
    res.json({ ok: true, data: { id: rows[0].id } });
  } catch (e) {
    next(e);
  }
});

// ── 企业微信客服配置（迁移 040，D先生 2026-10-05）──
// C 端**公开只读**：不需要登录（客服入口常出现在详情页/帮助页，未登录也要能点）。
// ⛔ 只在 kf_status='active' 时下发；未开通返回 enabled:false 而不是 404，
//    端上据此决定"隐藏入口"还是"提示未开通"，两种都比 404 好排查。
// ⚠️ 客服链接含 token，这是**设计如此**：端上要拿它真跳转（小程序传给微信 SDK /
//    H5 直接 location），不完整下发等于功能残废。风险面是链接可被分享，
//    属企业微信客服的固有特性（链接本身即可在微信内打开会话）。
siteRouter.get('/kf', async (req, res, next) => {
  try {
    const siteCode = (req.query.code as string) ?? '';
    const siteId = (req.query.site_id as string) ?? '';
    const { rows } = await pool.query(
      `SELECT kf_corp_id, kf_url, kf_status, shop_addr
         FROM site
        WHERE ($1 <> '' AND site_id::text = $1)
           OR ($2 <> '' AND code = $2)
        LIMIT 1`,
      [siteId, siteCode]
    );
    const s = rows[0];
    const enabled = Boolean(s && s.kf_status === 'active' && s.kf_corp_id && s.kf_url);
    res.json({
      ok: true,
      data: {
        enabled,
        corp_id: enabled ? s.kf_corp_id : null,
        kf_url: enabled ? s.kf_url : null,
        // 线下兜底：客服链接不可用时至少还能给出商家地址/联系方式文案
        shop_addr: s?.shop_addr ?? null,
      },
    });
  } catch (e) { next(e); }
});
