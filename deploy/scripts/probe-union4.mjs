// 探针第四轮（收口）：pdd goods_id 链接（二合一形态）/ vip t.vip.com
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

async function probe(label, params) {
  const qs = new URLSearchParams({ apikey: key, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  let j = null;
  for (let i = 0; i < 3 && !j; i++) {
    try {
      const res = await fetch(`https://api-gw.haojingke.com/index.php/v2/api/open/union?${qs}`);
      j = await res.json().catch(() => null);
    } catch (e) {
      if (i === 2) { console.log(`\n[${label}] NET FAIL ${e.cause?.code ?? e.message}`); return; }
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  const d = Array.isArray(j?.data) ? j.data[0] : j?.data;
  console.log(`\n[${label}] ${JSON.stringify({
    status_code: j?.status_code, pf: d?.pf, status: d?.status,
    url: String(d?.url ?? '').slice(0, 80),
    we_app: d?.we_app_info?.app_id ?? null,
  })}`);
}

// pdd goods.html?goods_id= 形态（无 goods_sign query）——旧 parseRef 不识别的形态
await probe('pdd goods_id链接', { text: 'https://mobile.yangkeduo.com/goods.html?goods_id=93804862837' });
// vip t.vip.com detail 链接
await probe('vip t.vip.com detail', { text: 'https://detail.vip.com/detail-1000000000.html' });
// 手淘完整商品链接（旧 parseRef 能吃 id= 形态，对照）
await probe('tb 手淘item链接', { text: 'https://item.taobao.com/item.htm?id=123456789012' });
