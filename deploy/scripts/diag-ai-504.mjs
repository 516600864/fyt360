// 查最近的 brief 生成 llm_log：504 后容器侧是否跑完落库（诊断用，只读）
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
  return res.json();
}

const logs = await q(`SELECT id, to_char(created_at AT TIME ZONE 'Asia/Shanghai','HH24:MI:SS') AS t, status, page,
  duration_ms, tokens_out, LEFT(REPLACE(prompt, E'\\n', ' '), 70) AS p
  FROM llm_log WHERE model='cloudbase/hy3' AND prompt LIKE '[brief]%'
  ORDER BY created_at DESC LIMIT 4`);
console.log('=== llm_log [brief] 最近 4 条 ===');
for (const r of logs) console.log(`${r.t} | ${r.status} | page=${r.page} | ${r.duration_ms}ms | out=${r.tokens_out} | ${r.p}`);

const drafts = await q(`SELECT page, version, status, created_at::time AS t
  FROM page_schema WHERE source='ai' ORDER BY created_at DESC LIMIT 5`);
console.log('=== page_schema AI 草稿最近 5 条 ===');
for (const r of drafts) console.log(`${r.t} | ${r.page} v${r.version} ${r.status}`);
