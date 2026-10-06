// 探针：移动积分行是否存在 + meituan_04 现状
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
async function q(sql) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters: [], role: 'cloudbase_postgres' }),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(res.status + ' ' + text.slice(0, 300));
  return JSON.parse(text);
}
const rows = await q(`
SELECT category, brand_code, name, action_type, enabled, miniapp_cfg::text AS cfg
FROM brand_action_cfg
WHERE name LIKE '%移动%' OR name LIKE '%积分%' OR brand_code LIKE '%card%'
   OR brand_code = 'meituan_04' OR name LIKE '%团购%' OR name LIKE '%到店%'
ORDER BY category, brand_code`);
for (const r of rows) console.log(JSON.stringify(r));
