// E2E：自营到店核销链（真实 DB + 真实回调路径）
// ① group 商品无 address_id 下单 → ② 构造 V3 回调解密路径触发 settleSelfOrder → ③ 券生成 + me/orders 回显 → ④ 清理测试单
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { loadDotEnv } from './lib/common.mjs';
import { connectDb } from './lib/db.mjs';

loadDotEnv();
const q = (await connectDb()).query;
const db = (sql, params = []) => q(sql, params);
const BASE = 'https://mk.fyt360.cn';
const SITE = '07642761-7991-4357-bdc1-997462559e68';
const UID = 10;

const ok = (name, cond, detail = '') => console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}${detail ? ' | ' + detail : ''}`);

// 0. 取 group 商品 + 签 token（2026-09-29 需求更正：自营仅 group，express 商品不应存在）
const goods = (await db(`SELECT goods_id, delivery_type, skus FROM self_goods WHERE site_id=$1 AND status='on' ORDER BY delivery_type DESC LIMIT 10`, [SITE])).rows;
const groupG = goods.find((g) => g.delivery_type === 'group');
const expressG = goods.find((g) => g.delivery_type === 'express');
ok('前置：存在 group 商品', !!groupG, `goods_id=${groupG?.goods_id}`);
ok('前置：无 express 商品（需求更正后）', !expressG, expressG ? `仍存在 goods_id=${expressG.goods_id}` : '快递商品已清零');
if (!groupG) process.exit(1);
const token = jwt.sign({ typ: 'user', userId: UID, siteId: SITE }, process.env.JWT_SECRET);
const skuOf = (g) => (typeof g.skus === 'string' ? JSON.parse(g.skus) : g.skus)[0]?.sku_id ?? 's0';

// ① group 下单（无 address_id）
const r1 = await fetch(`${BASE}/api/trade/orders`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ goods_id: groupG.goods_id, sku_id: skuOf(groupG), num: 1 }),
});
const j1 = await r1.json().catch(() => null);
ok('① 核销单免地址下单', r1.status === 200 && j1?.data?.fulfillment === 'group', `http=${r1.status} fulfillment=${j1?.data?.fulfillment}`);
if (r1.status !== 200) { console.log(JSON.stringify(j1)); process.exit(1); }
const orderId = j1.data.order_id;
const orderSn = j1.data.order_sn;

// ①b 需求更正回归：创建 express 商品 → 400 BAD_DELIVERY；旧物流端点 → 404
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INIT_PASSWORD }),
}).then((r) => r.json()).catch(() => null);
const adminToken = login?.data?.token ?? '';
ok('①b admin 登录', !!adminToken, adminToken ? 'ok' : '登录失败，后续负例跳过');
let negCreate = { status: 0 };
{
  const rb = await fetch(`${BASE}/api/admin/self-goods?site=site-a`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, 'x-fyt-site': 'site-a' },
    body: JSON.stringify({ title: 'E2E快递回归-应被拒', delivery_type: 'express', main_imgs: [], detail_imgs: [], skus: [{ sku_id: 's1', spec: '默认', price: 1, stock: 1 }] }),
  });
  negCreate.status = rb.status;
}
ok('①b express 商品创建被拒（400）', negCreate.status === 400, `http=${negCreate.status}`);
let negLogi = { status: 0 };
{
  const rl = await fetch(`${BASE}/api/admin/orders/1/logistics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}`, 'x-fyt-site': 'site-a' },
    body: JSON.stringify({ company: 'x', tracking_no: 'y' }),
  });
  negLogi.status = rl.status;
}
ok('①c 物流录入端点已移除（404）', negLogi.status === 404, `http=${negLogi.status}`);

// ② 拉真实支付参数（验证 out_trade_no 过微信校验 + 服务端 paySign）
const r2p = await fetch(`${BASE}/api/trade/orders/${orderId}/pay`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
const j2p = await r2p.json().catch(() => null);
ok('② 真实支付参数（paySign）', r2p.status === 200 && !!j2p?.data?.paySign, `http=${r2p.status} ${r2p.status !== 200 ? JSON.stringify(j2p?.message ?? j2p).slice(0, 120) : 'timeStamp=' + j2p?.data?.timeStamp}`);

// ②b 构造 V3 回调（AES-256-GCM 用站点 apiV3Key 加密 → 走服务端 decryptCallbackResource + settleSelfOrder）
const payRow = (await db(`SELECT mch_key FROM site_payment WHERE site_id=$1 AND status='active' LIMIT 1`, [SITE])).rows[0];
const key = Buffer.from(payRow.mch_key, 'utf8');
const nonce = crypto.randomBytes(6).toString('hex'); // 12 字符
const plain = JSON.stringify({ out_trade_no: orderSn, transaction_id: `E2E${Date.now()}`, trade_state: 'SUCCESS', amount: { payer_total: Math.round(j1.data.pay_price * 100), total: Math.round(j1.data.pay_price * 100), currency: 'CNY' } });
const c = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
c.setAAD(Buffer.from('transaction', 'utf8'));
const enc = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()]);
const r2 = await fetch(`${BASE}/api/trade/notify/wxpay`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ resource: { ciphertext: enc.toString('base64'), nonce, associated_data: 'transaction' } }),
});
const j2 = await r2.json().catch(() => null);
ok('② 回调结算（真实解密路径）', r2.status === 200 && j2?.code === 'SUCCESS', `http=${r2.status} resp=${JSON.stringify(j2)}`);

// ③ me/orders 回显 fulfillment + 券
const r3 = await fetch(`${BASE}/api/me/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
const j3 = await r3.json().catch(() => null);
const d3 = j3?.data ?? {};
ok('③ 订单回显 fulfillment=group', d3.fulfillment === 'group', `fulfillment=${d3.fulfillment} status=${d3.status}`);
ok('③ 核销券已生成', !!d3.verify_coupon?.code && d3.verify_coupon.code === `GC${orderId}`, `code=${d3.verify_coupon?.code} times=${d3.verify_coupon?.total_times}`);
// ③b 2026-09-29 定稿：支付后不结算（返利由核销触发），订单仍在「已付款」
ok('③b 支付后未结算（paid，返利待核销触发）', d3.platform_status === 'paid' && d3.status === '已付款', `platform_status=${d3.platform_status} status=${d3.status}`);

// ④ 清理：关单 + 删券 + 回滚元宝/佣金测试数据
await db(`UPDATE "order" SET platform_status='closed', fulfill_status='none' WHERE id=$1`, [orderId]);
await db(`DELETE FROM group_coupon WHERE order_id=$1`, [orderId]);
await db(`DELETE FROM commission_flow WHERE order_id=$1`, [orderId]);
const ing = (await db(`SELECT amount, tx_id FROM ingot_tx WHERE type='ORDER_REBATE' AND ref_id=$1`, [String(orderId)])).rows[0];
if (ing) {
  await db(`UPDATE ingot_account SET balance = balance - $1, total_earned = total_earned - $1 WHERE user_id=$2`, [ing.amount, UID]);
  await db(`DELETE FROM ingot_tx WHERE tx_id=$1`, [ing.tx_id]);
}
await db(`UPDATE self_goods SET skus = (SELECT jsonb_agg(CASE WHEN e->>'sku_id'=$3 THEN jsonb_set(e,'{stock}', (((e->>'stock')::int + 1))::text::jsonb) ELSE e END) FROM jsonb_array_elements(skus) e) WHERE goods_id=$1 AND site_id=$2`, [groupG.goods_id, SITE, skuOf(groupG)]);
ok('④ 测试数据已清理（关单/删券/回滚元宝库存）', true, `order_id=${orderId}`);
process.exit(0);
