// 探针：brand_action_cfg.miniapp_cfg 真实数据结构（plugin-launch 呼起映射数据面）
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const sql = "SELECT brand_code, action_type, miniapp_cfg::text AS cfg FROM brand_action_cfg WHERE miniapp_cfg IS NOT NULL AND miniapp_cfg::text <> 'null' LIMIT 4";
const res = await fetch(GATEWAY, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
  body: JSON.stringify({ sql, parameters: [], role: 'cloudbase_postgres' }),
});
console.log(res.status, (await res.text()).slice(0, 800));
