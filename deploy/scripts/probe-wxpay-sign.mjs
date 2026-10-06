// 复现微信下单真实报错（只读探测，下单 1 分钱测试单不支付即废）
import { loadDotEnv } from './lib/common.mjs';
import { connectDb } from './lib/db.mjs';
import crypto from 'node:crypto';

loadDotEnv();
const q = (await connectDb()).query;

const pay = (await q(`SELECT p.site_id, p.mch_id, p.serial_no, p.cert, s.appid FROM site_payment p JOIN site s ON s.site_id=p.site_id WHERE p.status='active' LIMIT 1`)).rows[0];
console.log('appid from site:', JSON.stringify(pay.appid), 'mch:', pay.mch_id, 'serial:', pay.serial_no?.slice(0, 8) + '...');

const u = (await q(`SELECT openid FROM "user" WHERE openid IS NOT NULL AND openid <> '' LIMIT 1`)).rows[0];
console.log('openid sample:', u?.openid ? u.openid.slice(0, 8) + '...' : 'NONE');

const body = JSON.stringify({
  appid: pay.appid,
  mchid: pay.mch_id,
  description: '签名探测-勿付',
  out_trade_no: `PROBE${Date.now()}`,
  notify_url: 'https://mk.fyt360.cn/api/trade/notify/wxpay',
  amount: { total: 1, currency: 'CNY' },
  payer: { openid: u.openid },
});
const ts = Math.floor(Date.now() / 1000);
const nonce = crypto.randomBytes(16).toString('hex');
const msg = `POST\n/v3/pay/transactions/jsapi\n${ts}\n${nonce}\n${body}\n`;
let sign;
try {
  sign = crypto.createSign('RSA-SHA256').update(msg).sign(pay.cert, 'base64');
  console.log('sign ok, len', sign.length);
} catch (e) {
  console.log('LOCAL SIGN FAIL:', e.message);
  process.exit(0);
}
const auth = `WECHATPAY2-SHA256-RSA2048 mchid="${pay.mch_id}",nonce_str="${nonce}",signature="${sign}",timestamp="${ts}",serial_no="${pay.serial_no}"`;
const r = await fetch('https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth }, body,
});
const j = await r.json().catch(() => null);
console.log('HTTP', r.status, JSON.stringify(j));
process.exit(0);
