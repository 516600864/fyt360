// 排查⑤：open/rerechargeorder 签名口径实测（secret 单包裹 vs apikey 复合包裹，只读）
import 'dotenv/config';
import { createHash } from 'node:crypto';

const gw = async (sql, parameters = []) => {
  const res = await fetch(`https://${process.env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
  });
  if (res.status !== 200) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200));
  return JSON.parse(await res.text());
};

const siteRows = await gw(`SELECT site_id::text AS id FROM site WHERE code = 'niwo'`);
const kr = await gw(
  `SELECT apikey, api_secret FROM provider_config WHERE site_id::text = $1 AND provider = 'mayixingqiu' LIMIT 1`,
  [siteRows[0].id],
);
const apikey = kr[0].apikey, secret = kr[0].api_secret;

const start = Math.floor(new Date('2026-10-10T00:00:00+08:00').getTime() / 1000);
const end = Math.floor(new Date('2026-10-11T00:00:00+08:00').getTime() / 1000);
// ASCII 升序：apikey 不进 strparam（看文档示例：apikey 也是请求参数……先两种都试）
const biz = { endtime: String(end), limit: '20', page: '1', starttime: String(start) };
const strparam = Object.entries(biz).map(([k, v]) => `${k}=${v}`).join('&');

const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');

const attempts = [
  { name: 'secret单包裹', sign: md5(`secret=${secret}&${strparam}&secret=${secret}`) },
  { name: 'apikey复合包裹', sign: md5(`apikey=${apikey}&secret=${secret}&${strparam}&apikey=${apikey}&secret=${secret}`) },
  { name: 'secret单包裹(含apikey进strparam)', sign: md5(`secret=${secret}&apikey=${apikey}&${strparam}&secret=${secret}`) },
];

for (const a of attempts) {
  const qs = new URLSearchParams({ apikey, ...biz, sign: a.sign });
  const res = await fetch('https://api-gw.haojingke.com/index.php/v2/api/open/rerechargeorder?' + qs.toString(), { method: 'POST' });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { console.log(a.name, '非JSON:', text.slice(0, 120)); continue; }
  const ok = j.status_code === 200;
  const row = j.data?.list?.[0];
  console.log(a.name, '→', ok ? `✅ total=${j.data.total} commission=${row?.commission} payprice=${row?.payprice} status=${row?.status} isbalance=${row?.isbalance}` : `❌ ${j.message}`);
  if (ok) break;
}
