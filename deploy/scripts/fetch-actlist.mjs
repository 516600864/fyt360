// 拉取蚂蚁星球活动列表全量（actlist 翻页）→ deploy/seed/actlist.json
// GET 语义用 POST JSON（蚂蚁网关惯例）；参数 apikey 跟 .env（本探针用平台 key）
import { readFileSync, writeFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
// ⛔ 凭据只从 .env 取（HJK_APIKEY），严禁硬编码真值——本仓库公开
const APIKEY = env.HJK_APIKEY;
if (!APIKEY) {
  console.error('缺少 HJK_APIKEY：请在项目根 .env 配置蚂蚁星球 apikey 后重跑');
  process.exit(1);
}
const ACT_URL = 'http://api-gw.haojingke.com/index.php/v2/api/index/actlist';

const all = [];
let page = 1;
let cat = null;
let total = null;
for (;;) {
  const res = await fetch(ACT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: APIKEY, page: String(page), limit: '50' }),
  });
  const j = await res.json();
  if (j.status_code !== 200) { console.error('page', page, j.message ?? j); break; }
  const d = j.data;
  cat ??= d.cat;
  total ??= d.total;
  all.push(...d.list);
  console.log(`page=${page} got=${d.list.length} accumulated=${all.length} hasMore=${d.hasMore}`);
  // 蚂蚁 hasMore 标志不可靠（total=193 但 hasMore=0 提前断），以 total 为准继续翻
  if (d.list.length === 0 || all.length >= (d.total ?? 0)) break;
  page += 1;
  if (page > 20) { console.error('翻页保护退出'); break; }
}
console.log(`total=${total} 实拉=${all.length} 分类=${cat?.length}`);
const seen = new Map();
for (const a of all) {
  if (seen.has(a.actid)) console.log('重复 actid', a.actid, a.act_name);
  seen.set(a.actid, a);
}
writeFileSync(new URL('../seed/actlist.json', import.meta.url),
  JSON.stringify({ fetched_at: new Date().toISOString(), total, cat, list: all }, null, 1));
console.log('已写 deploy/seed/actlist.json，唯一 actid 数 =', seen.size);
