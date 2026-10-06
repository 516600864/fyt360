// 探针：404 空壳行 + life_02/life_06 对照
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
SELECT category, brand_code, name, action_type,
       COALESCE(miniapp_cfg->>'mode','') AS mode,
       COALESCE(miniapp_cfg->>'path','') AS path
FROM brand_action_cfg
WHERE enabled = TRUE
  AND (miniapp_cfg = '{}'::jsonb OR miniapp_cfg->>'path' IS NULL OR miniapp_cfg->>'path' = '')
ORDER BY category, brand_code`);
console.log('空壳行数:', rows.length);
for (const r of rows) console.log(`${r.category}\t${r.brand_code}\t${r.name}\t${r.action_type}\tmode=${r.mode}`);
const lr = await q(`
SELECT brand_code, name, action_type, miniapp_cfg FROM brand_action_cfg
WHERE brand_code IN ('life_02','life_06')`);
for (const r of lr) console.log('对照:', r.brand_code, r.name, r.action_type, r.miniapp_cfg);
