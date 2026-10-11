// 探针：从 provider_config('mayixingqiu') 取 apikey → 直调 actlist 验证端点活性
// 只打印计数，绝不打印 key。判定权交上游，不猜。
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
async function q(sql, parameters = []) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(res.status + ' ' + text.slice(0, 300));
  const j = JSON.parse(text);
  return Array.isArray(j) ? j : (j.result ?? j.rows ?? []); // ⚠️ 网关返回顶层数组
}
const rows = await q(`SELECT apikey FROM provider_config WHERE provider = 'mayixingqiu' LIMIT 1`);
const apikey = rows.result?.[0]?.apikey ?? rows[0]?.apikey;
if (!apikey) throw new Error('provider_config 无 mayixingqiu apikey');
console.log('apikey 已取到（长度', String(apikey).length, '不回显）');

const ACT_URL = 'http://api-gw.haojingke.com/index.php/v2/api/index/actlist';
const res = await fetch(ACT_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ apikey, page: '1', limit: '50' }),
});
const j = await res.json();
if (j.status_code !== 200) { console.error('actlist 拒绝:', j.message ?? JSON.stringify(j).slice(0, 200)); process.exit(1); }
const d = j.data;
console.log('端点存活 ✓ total=', d.total, '本页=', d.list?.length, '分类数=', d.cat?.length);

// 快照对账预演：库里 mode=act 的行 ↔ 上游 actid
const cfgRows = await q(`
  SELECT category, brand_code, name, miniapp_cfg->>'actid' AS actid
  FROM brand_action_cfg
  WHERE enabled = TRUE AND miniapp_cfg->>'mode' = 'act'`);
const up = new Set((d.list ?? []).map((a) => String(a.actid)));
// 翻完剩余页
const all = [...(d.list ?? [])];
for (let p = 2; all.length < (d.total ?? 0) && p <= 20; p++) {
  const r = await fetch(ACT_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey, page: String(p), limit: '50' }),
  });
  const jj = await r.json();
  if (jj.status_code !== 200) break;
  all.push(...jj.data.list);
}
const upAll = new Set(all.map((a) => String(a.actid)));
console.log(`全量翻页: 上游活动 ${all.length}/${d.total}`);
console.log(`库里 launch 行( mode=act ): ${(cfgRows.result ?? cfgRows).length}`);
const dead = (cfgRows.result ?? cfgRows ?? []).filter((r) => !upAll.has(String(r.actid)));
console.log(`actid 已失效的行: ${dead.length}`);
for (const r of dead) console.log(`  失效 → ${r.category}/${r.brand_code} ${r.name} actid=${r.actid}`);
const mapped = new Set((cfgRows.result ?? cfgRows ?? []).map((r) => String(r.actid)));
const unmapped = all.filter((a) => !mapped.has(String(a.actid)));
console.log(`上游未映射活动数: ${unmapped.length}（仅报告，不自动建行）`);
for (const a of unmapped.slice(0, 12)) console.log(`  未映射 → actid=${a.actid} cid=${a.act_cid} ${a.act_name}`);
