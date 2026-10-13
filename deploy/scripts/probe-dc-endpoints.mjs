// 对比同参：diancan/orderlist（同步在用，ordersync 真实签名算法） vs open/dcorder（D先生 贴的原始请求重放）
// 目标：确认两接口响应里 commission / isbalance / finish 字段差异
import fs from 'node:fs';
import crypto from 'node:crypto';
for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}
const { connectDb } = await import('./lib/db.mjs');
const db = await connectDb();
const cred = (await db.query(
  `SELECT pc.apikey, pc.api_secret FROM provider_config pc JOIN site s ON s.site_id=pc.site_id
    WHERE s.code='niwo' AND pc.provider='mayixingqiu'`
)).rows[0];
await db.end();
const { apikey, api_secret } = cred;

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex').toLowerCase();
// 镜像 haojingke.ts md5Wrap：过滤空值 + 字典序
function wrapSign(params, prefix) {
  const strparam = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('&');
  return { strparam, sign: md5(`${prefix}&${strparam}&${prefix}`) };
}

// 窗口覆盖 14:35 下单/14:36 更新（秒级 1791786907 / 1791786979）
const WIN = { starttime: '1791786000', endtime: '1791788000' };

async function diancan() {
  const params = { page: '1', limit: '100', ...WIN };
  const { sign } = wrapSign(params, `apikey=${apikey}&secret=${api_secret}`);
  // 镜像 hjkCall：apikey 查询串注入 + rechargeStyle（https + POST）
  const qs = new URLSearchParams({ apikey, ...params, sign }).toString();
  const r = await fetch(`https://api-gw.haojingke.com/v2/api/diancan/orderlist?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return { http: r.status, body: await r.json().catch(() => null) };
}

async function dcorder() {
  // D先生 调试工具原始参数原样重放（sign 原文来自他的请求包）
  const params = { apikey, page: '1', limit: '20', pf: '', uid: '', orderid: '332026101214350664869', starttime: '', endtime: '', status: '', sign: '3aca1e2c6a51cdcab1b6896afe480897' };
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`https://api-gw.haojingke.com/index.php/v2/api/open/dcorder?${qs}`);
  return { http: r.status, body: await r.json().catch(() => null) };
}

function show(name, res) {
  const o = res.body?.data?.list?.[0] ?? (Array.isArray(res.body?.data) ? res.body.data[0] : null);
  console.log(`[${name}] HTTP ${res.http} | status_code=${res.body?.status_code} ${res.body?.message ?? ''}`);
  if (o) {
    const keys = Object.keys(o);
    console.log('  字段全集:', keys.join(','));
    console.log('  status=', o.status, o.statusstr, '| isbalance=', JSON.stringify(o.isbalance), '| finish=', JSON.stringify(o.finish),
      '| commission=', JSON.stringify(o.commission), '| payprice=', o.payprice);
  } else {
    console.log('  响应:', JSON.stringify(res.body).slice(0, 400));
  }
}

show('diancan/orderlist（同步在用）', await diancan());
show('open/dcorder（调试工具重放）', await dcorder());
