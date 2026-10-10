// 探针第三轮：dump jd 万能转链原始响应（定责「200 但 url 空」）
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const r = await fetch(GATEWAY, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
  body: JSON.stringify({ sql: "SELECT apikey FROM provider_config WHERE provider='mayixingqiu' AND status='active' AND test_status='passed' LIMIT 1", parameters: [], role: 'cloudbase_postgres' }),
});
const key = (await r.json())[0].apikey;

for (const [label, params] of [
  ['jd u.jd.com + actid104', { text: 'https://u.jd.com/F1aEq4R', actid: 104 }],
  ['jd u.jd.com 裸text', { text: 'https://u.jd.com/F1aEq4R' }],
  ['美团skuViewId + actid141', { text: 'G56RMTNJ2FZ373P4E2VNPXEGFY', actid: 141 }],
]) {
  const qs = new URLSearchParams({ apikey: key, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const res = await fetch(`https://api-gw.haojingke.com/index.php/v2/api/open/union?${qs}`);
  const j = await res.json().catch(() => null);
  console.log(`\n==== ${label} ====`);
  console.log(JSON.stringify(j, null, 1).slice(0, 1500));
}
