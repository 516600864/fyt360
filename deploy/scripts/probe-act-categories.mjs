// 探针：mode=act 行的 category 分布（定 cid 白名单映射）
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const res = await fetch(GATEWAY, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
  body: JSON.stringify({
    sql: `SELECT category, COUNT(*)::int AS n FROM brand_action_cfg WHERE enabled = TRUE AND miniapp_cfg->>'mode' = 'act' GROUP BY 1 ORDER BY n DESC`,
    parameters: [], role: 'cloudbase_postgres',
  }),
});
const j = await res.json();
const rows = Array.isArray(j) ? j : (j.result ?? j.rows ?? []);
console.log(JSON.stringify(rows, null, 1));
