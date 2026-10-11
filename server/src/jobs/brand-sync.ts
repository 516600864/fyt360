/**
 * brand-sync —— 品牌三轨对账（2026-10-10，决策：评审文档四项全按方案 + cid 白名单）
 * 设计评审：docs/品牌三轨对账同步设计评审.md
 *
 * 域1（自动写库，唯一写面）：蚂蚁 actlist 活动清单 ↔ brand_action_cfg(mode=act) 失效检测
 *   - cid 白名单（D先生 裁决，只对齐 4 类）：2 交通出行(taxi) / 8 美团&饿了么(meituan,eleme)
 *     / 5 电商商城(jd,pdd,vip,tb——淘宝活动归电商商城) / 6 旅游住宿(hotel)
 *   - actid 失效 → enabled=false + health_status='down'（不删行，幂等可逆）
 *   - 未映射活动只出报告（不自动建品牌行——launch 行是「名册品牌↔活动」语义映射）
 * 域2（只读报告）：page_schema 楼层 props.cid 是否仍活在 fasttype 目录（失效只报告不动楼层）
 * 报告：platform_config(key='brand_sync_state')；dry 模式全流程只读
 *
 * 防呆：actlist total < MIN_ACT_TOTAL → 视为上游残缺，整轮放弃（防假下架误禁全库）；
 *       fasttype 拉取失败仅跳过域2，不影响域1。
 */
import { pool } from '../db/client.js';
import { fetchFasttype } from '../lib/haojingke.js';
import { resolveHjkConfig } from '../lib/provider.js';

/** category ↔ act_cid 白名单（裁决：只对齐 4 类；淘宝活动归 cid=5 电商商城，实测「淘宝 超级U选」等在此分类）
 *  125 行 mode=act 全覆盖，无脱管行。 */
const CATEGORY_CID: Record<string, number> = {
  taxi: 2,     // 交通出行
  meituan: 8,  // 美团&饿了么
  eleme: 8,
  jd: 5,       // 电商商城（含淘宝 tb）
  pdd: 5,
  vip: 5,
  tb: 5,
  hotel: 6,    // 旅游住宿
};
const SCOPE_CATEGORIES = Object.keys(CATEGORY_CID);
const SCOPE_CIDS = new Set(Object.values(CATEGORY_CID));

/** 上游活动全量下限：低于此值判定为残缺响应，整轮放弃 */
export const MIN_ACT_TOTAL = 50;

interface ActItem {
  actid: number | string;
  act_cid: number | string;
  act_name: string;
  act_logo?: string;
}

export interface BrandSyncResult {
  ran_at: string;
  dry_run: boolean;
  skipped?: string;
  upstream_total?: number;
  upstream_in_scope?: number;
  checked_rows?: number;
  disabled?: Array<{ category: string; brand_code: string; name: string; actid: string }>;
  unmapped_count?: number;
  /** 全量未映射活动（含 logo，供 admin-37 一键补配；~百级条目，jsonb 可控） */
  unmapped_sample?: Array<{ actid: number; cid: number; name: string; logo?: string }>;
  ft_ref?: { status: 'ok' | 'skipped'; checked: number; dead: Array<{ site: string; page: string; schema_status: string; cid: number }> };
}

/** 拉活动清单全量（翻页以 total 为准；hasMore 标志不可靠，fetch-actlist.mjs 实锤） */
async function fetchActlist(apikey: string): Promise<ActItem[]> {
  const URL = 'http://api-gw.haojingke.com/index.php/v2/api/index/actlist';
  const all: ActItem[] = [];
  let total = 0;
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey, page: String(page), limit: '50' }),
    });
    const j = (await res.json()) as { status_code?: number; message?: string; data?: { total?: number; list?: ActItem[] } };
    if (j.status_code !== 200 || !j.data) throw new Error(`actlist 拒绝: ${j.message ?? res.status}`);
    total = Number(j.data.total ?? 0);
    const list = j.data.list ?? [];
    all.push(...list);
    if (list.length === 0 || all.length >= total) break;
  }
  if (total && all.length < total) throw new Error(`actlist 翻页不全: ${all.length}/${total}`);
  return all;
}

/** 递归提取楼层 JSON 中所有 props.cid（数字）引用 */
function collectCids(node: unknown, out: Set<number>): void {
  if (Array.isArray(node)) { node.forEach((n) => collectCids(n, out)); return; }
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  const props = o.props as Record<string, unknown> | undefined;
  // cid<=0 是装修器/模板占位符，非真实引用（page-fm8o 实锤），忽略
  if (props && typeof props.cid === 'number' && props.cid > 0) out.add(props.cid);
  for (const v of Object.values(o)) collectCids(v, out);
}

export async function runBrandSync(opts?: { dry?: boolean }): Promise<BrandSyncResult> {
  const dry = opts?.dry === true;
  const ran_at = new Date().toISOString();
  const result: BrandSyncResult = { ran_at, dry_run: dry };

  // 0. apikey：平台单 key（平台级 job，显式走 site-a——resolveHjkConfig 无参缺省同源）
  const cfg = await resolveHjkConfig('site-a');
  if (!cfg?.apikey) {
    result.skipped = 'provider_config(mayixingqiu) 无 apikey';
    return result;
  }

  // 1. 拉上游全量 + 防呆
  const all = await fetchActlist(cfg.apikey);
  if (all.length < MIN_ACT_TOTAL) {
    result.skipped = `上游残缺（${all.length} < ${MIN_ACT_TOTAL}），整轮放弃`;
    return result;
  }
  result.upstream_total = all.length;
  const upById = new Map(all.map((a) => [String(a.actid), a]));

  // 2. 库内对账行（白名单 category；IN 展开——= ANY($n::text[]) 有静默不匹配前科）
  const quoted = SCOPE_CATEGORIES.map((c) => `'${c}'`).join(',');
  const { rows } = await pool.query(
    `SELECT id, category, brand_code, name, miniapp_cfg->>'actid' AS actid
       FROM brand_action_cfg
      WHERE enabled = TRUE AND miniapp_cfg->>'mode' = 'act' AND category IN (${quoted})`,
  );
  result.checked_rows = rows.length;

  // 3. 失效行 → 禁用（幂等；dry 只报告）
  const deadRows = rows.filter((r) => !upById.has(String(r.actid)));
  result.disabled = deadRows.map((r) => ({
    category: r.category, brand_code: r.brand_code, name: r.name, actid: String(r.actid),
  }));
  if (!dry && deadRows.length > 0) {
    const ids = deadRows.map((r) => String(r.id)).map((s) => `'${s}'::bigint`).join(',');
    // ⚠️ rowCount 在 HTTP 网关模式下不可靠（实测恒 0），以 RETURNING 行数为准
    const { rows: updated } = await pool.query(
      `UPDATE brand_action_cfg SET enabled = FALSE, health_status = 'down'
        WHERE id IN (${ids}) AND enabled = TRUE RETURNING id`,
    );
    if (updated.length !== deadRows.length) {
      throw new Error(`禁用行数不齐: UPDATE ${updated.length} / 预期 ${deadRows.length}`);
    }
  }

  // 4. 未映射活动（只列白名单 cid；全量存报告供 admin-37 一键补配）
  const mapped = new Set(rows.map((r) => String(r.actid)));
  const unmapped = all.filter((a) => SCOPE_CIDS.has(Number(a.act_cid)) && !mapped.has(String(a.actid)));
  result.unmapped_count = unmapped.length;
  result.unmapped_sample = unmapped.map((a) => ({
    actid: Number(a.actid), cid: Number(a.act_cid), name: String(a.act_name ?? ''),
    logo: a.act_logo ? String(a.act_logo) : undefined,
  }));

  // 5. 域2：page_schema 楼层 props.cid ↔ fasttype 目录（只读报告）
  const ft = await fetchFasttype(cfg.apikey, '1');
  if (!ft.ok || !Array.isArray(ft.data)) {
    result.ft_ref = { status: 'skipped', checked: 0, dead: [] };
  } else {
    const ftCids = new Set(ft.data.map((x) => Number((x as Record<string, unknown>).id)).filter((n) => Number.isFinite(n)));
    const { rows: floors } = await pool.query(
      `SELECT site_id::text AS site, page, status AS schema_status, schema_json
         FROM page_schema WHERE status IN ('draft','published')`,
    );
    const dead: NonNullable<BrandSyncResult['ft_ref']>['dead'] = [];
    let checked = 0;
    for (const f of floors) {
      const cids = new Set<number>();
      collectCids(f.schema_json, cids);
      checked += cids.size;
      for (const cid of cids) {
        if (!ftCids.has(cid)) dead.push({ site: f.site, page: f.page, schema_status: f.schema_status, cid });
      }
    }
    result.ft_ref = { status: 'ok', checked, dead };
  }

  // 6. 报告落库（dry 也写，但带 dry_run 标记；仅状态位，无业务影响）
  //    045 起平台键用 COALESCE 表达式唯一索引（site_id IS NULL 归零哨兵）
  await pool.query(
    `INSERT INTO platform_config (key, site_id, value) VALUES ('brand_sync_state', NULL, $1::jsonb)
      ON CONFLICT (key, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO UPDATE SET value = $1::jsonb, updated_at = now()`,
    [JSON.stringify(result)],
  );
  return result;
}
