// 签名方式真探针（2026-10-10 D先生 拍桌纠正）：
//   官方通用签名 = md5("secret=<S>&strparam&secret=<S>")，apikey 不参与签名。
//   代码里 2026-10-04 的「实测反推」（apikey=&secret= 复合包裹）疑似误判 +
//   mayiFetcher 里 resolveHjkConfig() 没传站点 → niwo 同步用了 site-a 的 secret（必炸）。
// 本脚本：每个站点的配套 key+secret，三个签名接口 × 两种包裹方式逐一实测。
// 输出只打掩码，不落真值。
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { connectDb } from './lib/db.mjs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

const mask = (s) => (s ? `${String(s).slice(0, 6)}***` : '(null)');
const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex').toLowerCase();

function makeSign(params, style, apikey, secret) {
  const strparam = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const wrap =
    style === 'secret_only'
      ? `secret=${secret}`
      : `apikey=${apikey}&secret=${secret}`;
  return md5(`${wrap}&${strparam}&${wrap}`);
}

const db = await connectDb();
const { rows } = await db.query(
  `SELECT s.code, pc.apikey, pc.api_secret
     FROM provider_config pc JOIN site s ON s.site_id = pc.site_id
    WHERE pc.provider = 'mayixingqiu' AND pc.status = 'active'
    ORDER BY s.code`
);
await db.end();

console.log('== 库内 mayixingqiu 凭据 ==');
for (const r of rows) console.log(`  ${r.code}: apikey=${mask(r.apikey)} secret=${mask(r.api_secret)}`);

const end = Math.floor(Date.now() / 1000);
const start = end - 48 * 3600; // 近 48h 窗口，签名对错与是否有单无关
const params = { page: '1', limit: '100', starttime: String(start), endtime: String(end) };

const TARGETS = [
  { name: 'movie', url: 'https://api-gw.haojingke.com/index.php/v2/api/movie/orderlist' },
  { name: 'diancan', url: 'https://api-gw.haojingke.com/index.php/v2/api/diancan/orderlist' },
  { name: 'recharge', url: 'https://api-gw.haojingke.com/index.php/v2/api/recharge/orderlist' },
];

for (const r of rows) {
  if (!r.apikey || !r.api_secret) { console.log(`\n## ${r.code}: 缺 apikey/secret，跳过`); continue; }
  console.log(`\n## ${r.code}`);
  for (const t of TARGETS) {
    for (const style of ['secret_only', 'apikey_secret']) {
      const qs = new URLSearchParams({ apikey: r.apikey, ...params });
      qs.set('sign', makeSign(params, style, r.apikey, r.api_secret));
      try {
        const res = await fetch(`${t.url}?${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(15000),
        });
        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { console.log(`  ${t.name} [${style}] HTTP ${res.status} 非JSON: ${text.slice(0, 120)}`); continue; }
        const code = body.status_code ?? body.code ?? body.state ?? '';
        const msg = body.message ?? body.msg ?? body.error ?? '';
        const total = body?.data?.total ?? body?.data?.count ?? '';
        console.log(`  ${t.name.padEnd(9)} [${style.padEnd(13)}] code=${code} msg=${String(msg).slice(0, 60)} total=${total}`);
      } catch (e) {
        console.log(`  ${t.name.padEnd(9)} [${style.padEnd(13)}] 请求异常: ${e.message}`);
      }
      await new Promise((r2) => setTimeout(r2, 300)); // 限频礼貌
    }
  }
}
console.log('\n== 探针结束 ==');
