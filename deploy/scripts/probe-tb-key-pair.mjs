// 探针：niwo / site-a 两把蚂蚁 key 各自重放同一条 tb 转链，验证 key 站点配套后上游均接受
import fs from 'node:fs';
import { connectDb } from './lib/db.mjs';

for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}

const db = await connectDb();
const r = await db.query(`
  SELECT s.code, pc.apikey
    FROM provider_config pc JOIN site s ON s.site_id = pc.site_id
   WHERE pc.provider = 'mayixingqiu' AND pc.status = 'active' AND s.code IN ('niwo', 'site-a')`);
await db.end();

const item = '【淘宝】https://e.tb.cn/h.8ABWHqJAnjMAkw7?tk=1J1ZTrGpnL2 CZ009 「澳洲驱虫药室无内毒驱赶蟑螂神器」';

for (const row of r.rows) {
  const url = new URL('https://api-gw.haojingke.com/v1/api/tb/getunionurl');
  url.searchParams.set('apikey', row.apikey);
  url.searchParams.set('item_id', item);
  url.searchParams.set('title', 'FYT360 精选好物');
  url.searchParams.set('get_tkl', '1');
  url.searchParams.set('extend_id', '25');
  const res = await fetch(url);
  const j = await res.json();
  const d = j?.data ?? j;
  const ok = !!(d?.coupon_click_url || d?.coupon_full_tpwd);
  console.log(
    `${row.code.padEnd(7)} | key=${row.apikey.slice(0, 4)}****${row.apikey.slice(-4)} | HTTP ${res.status} | ` +
    `code=${j?.code ?? '-'} | 转链${ok ? 'OK' : 'FAIL'} | 佣金=${d?.commission ?? '-'} | 口令=${String(d?.coupon_full_tpwd ?? '').slice(0, 18)}`,
  );
  await new Promise((s) => setTimeout(s, 300));
}
