import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
async function db(sql, p = []) {
  const j = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters: p, role: 'cloudbase_postgres' }),
  }).then((r) => r.json());
  if (!Array.isArray(j)) throw new Error(`网关: ${JSON.stringify(j).slice(0, 220)}`);
  if (j.length && Object.keys(j[0]).some((k) => k.startsWith('?column'))) throw new Error(`SQL: ${JSON.stringify(j[0]).slice(0, 220)}`);
  return j;
}
const Q = [
  ['A. promoter_id 分布', `SELECT COALESCE(promoter_id::text,'(null)') p, COUNT(*)::int n, COUNT(*) FILTER (WHERE commission>0)::int has_comm FROM "order" GROUP BY 1 ORDER BY n DESC LIMIT 10`],
  ['B. buyer_id 是否都=0', `SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE buyer_id=0)::text_zero, COUNT(*) FILTER (WHERE buyer_id IS NULL)::int nullv, COUNT(*) FILTER (WHERE buyer_id>0)::int positive FROM "order"`],
  ['C. 真实用户(非0)订单', `SELECT o.id::text, o.order_sn, o.provider, o.buyer_id::text, o.promoter_id::text, o.commission::float, o.platform_status, o.rebate_at IS NULL AS unrebated FROM "order" o WHERE o.buyer_id > 0 ORDER BY o.id DESC LIMIT 8`],
  ['D. user 表 site 归属', `SELECT user_id::text, site_id::text, invite_code, status FROM "user" ORDER BY user_id`],
  ['E. commission 归属判定函数', `SELECT 1`],
];
for (const [l, s] of Q) {
  try { const r = await db(s); console.log(`\n### ${l}\n${JSON.stringify(r).slice(0, 1400)}`); }
  catch (e) { console.log(`\n### ${l} ERR ${String(e.message).slice(0, 220)}`); }
}
process.exit(0);
