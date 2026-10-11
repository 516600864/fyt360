// 探针：复现 2026-10-11 18:49:36 user25 那笔 tb 转链的上游请求（同参重放，apikey 掩码）
import { readFileSync } from 'node:fs';
for (const line of readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const { connectDb } = await import('./lib/db.mjs');
const db = await connectDb();

// resolveHjkConfig('site-a') 同款：provider_config('mayixingqiu')
const cred = await db.query(`
  SELECT pc.apikey FROM provider_config pc
    JOIN site s ON s.site_id = pc.site_id
   WHERE s.code = 'site-a' AND pc.provider = 'mayixingqiu' LIMIT 1`);
const apikey = String(cred.rows[0]?.apikey ?? '');
if (!apikey) { console.error('site-a 蚂蚁 apikey 缺失'); process.exit(1); }
await db.end();

// ── 还原 doConvert→legacyConvert 的入参构造（chat.ts parseRef→buildLinkParams→injectPromoter）──
const refText = '【淘宝】假一赔四 https://e.tb.cn/h.8ABWHqJAnjMAkw7?tk=1J1ZTrGpnL2 CZ009 「澳洲驱虫药室无内毒驱赶蟑螂神器家用防花蚊子克星除蚊香薰杀虫剂」\n点击链接直接打开 或者 淘宝搜索直接打开';
// parseRef: 含 e.tb.cn → tb 强信号 → tbLegacy = { item_id: 整段原文 }
// buildLinkParams('tb', {item_id}): title 缺失 → 'FYT360 精选好物'；get_tkl=1
// injectPromoter('tb'): extend_id = user_id = 25
const params = {
  apikey,
  item_id: refText,
  title: 'FYT360 精选好物',
  get_tkl: '1',
  extend_id: '25',
};

const qs = new URLSearchParams(params);
const url = `https://api-gw.haojingke.com/v1/api/tb/getunionurl?${qs.toString()}`;
// 掩码展示（真实调用用全量）
const masked = url.replace(/apikey=[^&]+/, 'apikey=***MASKED***');
console.log('== 上游请求 ==');
console.log('GET', masked);
console.log('\n入参明细：');
for (const [k, v] of qs) {
  console.log(`  ${k} = ${k === 'apikey' ? '***MASKED***' : JSON.stringify(v)}`);
}

const res = await fetch(url);
const body = await res.json();
console.log('\n== 上游响应（关键字段） ==');
const d = body.data ?? {};
console.log('status:', body.status, '| message:', body.message);
console.log('coupon_click_url:', d.coupon_click_url);
console.log('coupon_full_tpwd:', d.coupon_full_tpwd);
console.log('cps_full_tpwd:', d.cps_full_tpwd);
console.log('commission:', d.commission, '| goods_name:', d.goods_name, '| price:', d.price, '| price_after:', d.price_after, '| discount:', d.discount);
