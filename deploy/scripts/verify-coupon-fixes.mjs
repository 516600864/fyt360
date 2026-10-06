/**
 * 营销中心第 1 档纯 bug 修复 E2E（2026-10-02）：
 *  A 券有效期：时间显示带年份（前端）、valid_from 可配出「排期中」、有效期区间自检
 *  B 券类型参数：折扣券 1~9.9 夹逼、兑换券 amount 强制 0、scope=rights 拒绝
 *  C过期券真拦截：available 过滤 + 下单 expire_at 守卫
 *  D 回归：原闭环（领券/抵扣/锁券）不被改坏
 */
const BASE = 'https://mk.fyt360.cn';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
dotenv.config({ path: new URL('../../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:') });

let pass = 0, fail = 0;
const ok = (cond, name, note = '') => { console.log((cond ? '✅' : '❌'), name, note ? `— ${note}` : ''); cond ? pass++ : fail++; };

const G = 'https://' + process.env.TCB_ENV + '.api.tcloudbasegateway.com/v1/rdb/exec-pgsql';
const GH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TCB_API_KEY };
const gdb = async (sql, parameters = []) => {
  const r = await fetch(G, { method: 'POST', headers: GH, body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }) });
  const j = JSON.parse(await r.text());
  return Array.isArray(j) ? j : (j.rows ?? []);
};

let ADMIN = '';
const api = async (path, opts = {}) => {
  const r = await fetch(BASE + '/api' + path, {
    headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, ...opts,
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

const SITE = '07642761-7991-4357-bdc1-997462559e68';
const UID = 10;
const TAG = 'E2E券修';
let USER_TOKEN = '';
const uapi = async (p, opts = {}) => {
  const r = await fetch(BASE + '/api' + p, {
    headers: { Authorization: `Bearer ${USER_TOKEN}`, 'Content-Type': 'application/json' }, ...opts,
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};
const mk = (over = {}) => ({
  name: `${TAG}-${Math.random().toString(36).slice(2, 7)}`, type: 'cash_off', scope: 'self',
  amount: 5, threshold: 0, total: 100, valid_from: null, valid_to: null, ...over,
});
const create = async (body) => api('/admin/marketing/coupons', { method: 'POST', body: JSON.stringify(body) });

(async () => {
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INIT_PASSWORD }),
  });
  ADMIN = (await lr.json())?.data?.token ?? '';
  ok(!!ADMIN, '管理员登录');
  USER_TOKEN = jwt.sign({ typ: 'user', userId: UID, siteId: SITE }, process.env.JWT_SECRET);

  // ── A1 折扣券区间：0 / 10 / abc 全拒
  for (const bad of [0, 10, 9.95, -1]) {
    const r = await create(mk({ type: 'discount', amount: bad }));
    ok(r.status === 400 && r.j?.code === 'BAD_AMOUNT', `折扣券拒绝非法折扣 ${bad}`, `${r.status} ${r.j?.code}`);
  }
  const rD = await create(mk({ type: 'discount', amount: 8.5 }));
  ok(rD.status === 200, '折扣券 8.5 折创建成功', JSON.stringify(rD.j?.data));
  const cidD = Number(rD.j?.data?.id);

  // ── A2 兑换券 amount 强制 0（运营乱填也不影响）
  const rX = await create(mk({ type: 'exchange', amount: 999 }));
  ok(rX.status === 200, '兑换券创建成功', JSON.stringify(rX.j?.data));
  const cidX = Number(rX.j?.data?.id);
  const xRow = await gdb(`SELECT amount::float AS a, type FROM coupon WHERE id = $1::bigint`, [String(cidX)]);
  ok(Number(xRow[0].a) === 0, '兑换券 amount 被服务端归零', `amount=${xRow[0].a}`);

  // ── A3 scope=rights 拒绝
  const rR = await create(mk({ scope: 'rights' }));
  ok(rR.status === 400 && rR.j?.code === 'SCOPE_UNSUPPORTED', '权益订单券被拒（链路不接券）', `${rR.status} ${rR.j?.code}`);

  // ── A4 有效期区间自检（从 >= 至拒）
  const now = new Date();
  const past = new Date(now.getTime() - 86400000).toISOString();
  const future = new Date(now.getTime() + 86400000).toISOString();
  const rV = await create(mk({ valid_from: future, valid_to: past }));
  ok(rV.status === 400 && rV.j?.code === 'BAD_VALID_RANGE', '有效期区间倒置被拒', `${rV.status} ${rV.j?.code}`);

  // ── A5 valid_from 可配出「排期中」
  const rSched = await create(mk({ valid_from: future, valid_to: new Date(now.getTime() + 7 * 86400000).toISOString() }));
  const cidS = Number(rSched.j?.data?.id);
  const list = await api('/admin/marketing/coupons');
  const sc = (list.j?.data?.coupons ?? []).find((c) => c.id === cidS);
  ok(sc?.phase === '排期中', 'valid_from 未来 → phase=排期中（可真实配置）', sc?.phase);
  ok(!!sc?.valid_from, '列表返回 valid_from', sc?.valid_from);

  // 排期中券不可领
  const rRecvS = await uapi(`/me/member/coupons/${cidS}/receive`, { method: 'POST' });
  ok(rRecvS.status === 409 && rRecvS.j?.code === 'COUPON_NOT_STARTED', '排期中券不可领取', `${rRecvS.status} ${rRecvS.j?.code}`);

  // ── B 过期券真拦截：造一张 valid_to 已过的券 + 直插 user_coupon 模拟「运营改期前领的券」
  const rExp = await create(mk({ amount: 5 }));
  const cidE = Number(rExp.j?.data?.id);
  await uapi(`/me/member/coupons/${cidE}/receive`, { method: 'POST' });
  const ucE = await gdb(`SELECT id FROM user_coupon WHERE coupon_id = $1::bigint AND user_id = $2::bigint`, [String(cidE), String(UID)]);
  const ucEId = Number(ucE[0].id);
  ok(ucEId > 0, '过期券测试券已领取', `uc=${ucEId}`);

  // 运营把 valid_to 改到过去（用户手里的券 expire_at 快照也随之过期）
  await gdb(`UPDATE coupon SET valid_to = $1::timestamptz WHERE id = $2::bigint`, [past, String(cidE)]);
  await gdb(`UPDATE user_coupon SET expire_at = $1::timestamptz WHERE id = $2::bigint`, [past, String(ucEId)]);

  const avail = await uapi('/me/member/coupons/available?amount=999');
  const inAvail = (avail.j?.data?.items ?? []).find((c) => c.coupon_id === cidE);
  ok(!inAvail, '过期券不出现在 available', `found=${!!inAvail}`);

  // 下单侧 expire_at 守卫（这才是之前漏的那道）
  const goods = await gdb(`SELECT goods_id, skus FROM self_goods WHERE site_id = $1::uuid AND status='on' ORDER BY goods_id DESC LIMIT 1`, [SITE]);
  const gid = Number(goods[0].goods_id);
  const sku = goods[0].skus[0];
  const price = Number(sku.price);
  const stockBefore = Number(sku.stock);
  const ord = await uapi('/trade/orders', {
    method: 'POST', body: JSON.stringify({ goods_id: gid, sku_id: String(sku.sku_id), num: 1, user_coupon_id: ucEId }),
  });
  ok(ord.status === 409 && ord.j?.code === 'COUPON_EXPIRED', '下单拦截过期券（expire_at 守卫）', `${ord.status} ${ord.j?.code}`);
  const gAfter = await gdb(`SELECT skus FROM self_goods WHERE goods_id = $1::bigint`, [String(gid)]);
  const stockAfter = Number(gAfter[0].skus.find((s) => String(s.sku_id) === String(sku.sku_id)).stock);
  ok(stockAfter === stockBefore, '过期券拒单不泄漏库存', `应 ${stockBefore} / 实 ${stockAfter}`);

  // 券包应显示为已过期
  const wallet = await uapi('/me/member/coupons?tab=expired');
  const wItems = wallet.j?.data?.items ?? [];
  ok(!wItems.some((c) => c.coupon_id === cidE && c.status === 'unused'), '过期券在券包不再是 unused 态');

  // ── C 回归：正常券闭环未被改坏（8.5 折券实打8.5 折）
  const g2 = await gdb(`SELECT goods_id, skus FROM self_goods WHERE site_id = $1::uuid AND status='on' ORDER BY goods_id DESC LIMIT 1`, [SITE]);
  const gid2 = Number(g2[0].goods_id); const sku2 = g2[0].skus[0];
  const price2 = Number(sku2.price);
  // 临时抬价到 100 让 8.5 折有可观测抵扣（真实测试商品是 0.01，任何券都会被0.01 下限吃掉）
  await gdb(
    `UPDATE self_goods g SET skus = (SELECT jsonb_agg(CASE WHEN e->>'sku_id' = $2::text THEN jsonb_set(e, '{price}', to_jsonb($3::numeric)) ELSE e END) FROM jsonb_array_elements(g.skus) e) WHERE g.goods_id = $1::bigint`,
    [String(gid2), String(sku2.sku_id), '100'],
  );
  await uapi(`/me/member/coupons/${cidD}/receive`, { method: 'POST' });
  const ucD = await gdb(`SELECT id FROM user_coupon WHERE coupon_id = $1::bigint AND user_id = $2::bigint`, [String(cidD), String(UID)]);
  const ucDid = Number(ucD[0].id);
  const o2 = await uapi('/trade/orders', {
    method: 'POST', body: JSON.stringify({ goods_id: gid2, sku_id: String(sku2.sku_id), num: 1, user_coupon_id: ucDid }),
  });
  // 8.5 折 = 付 85% → 抵扣 15，实付 85（公式同服务端：discount = 价 × (1 - 折/10)）
  const expectDiscount = Math.round(100 * (1 - 8.5 / 10) * 100) / 100;
  const expectPay = Math.max(0.01, Math.round(100 - expectDiscount) * 100) / 100;
  ok(o2.status === 200, '折扣券下单成功', JSON.stringify(o2.j?.data));
  ok(Math.abs(Number(o2.j?.data?.pay_price) - expectPay) < 0.01, `8.5 折实付= ${expectPay}（付 85%）`, `实付 ${o2.j?.data?.pay_price}`);
  ok(Math.abs(Number(o2.j?.data?.coupon_discount) - expectDiscount) < 0.01, `抵扣额= ${expectDiscount}`, `抵扣 ${o2.j?.data?.coupon_discount}`);

  // ── 清理
  if (o2.j?.data?.order_id) await uapi(`/trade/orders/${o2.j.data.order_id}/cancel`, { method: 'POST' });
  const g3 = await gdb(`SELECT skus FROM self_goods WHERE goods_id = $1::bigint`, [String(gid2)]);
  await gdb(
    `UPDATE self_goods g SET skus = (SELECT jsonb_agg(CASE WHEN e->>'sku_id' = $2::text THEN jsonb_set(e, '{price}', to_jsonb($3::numeric)) ELSE e END) FROM jsonb_array_elements(g.skus) e) WHERE g.goods_id = $1::bigint`,
    [String(gid2), String(sku2.sku_id), String(price2)],
  );
  const g4 = await gdb(`SELECT skus FROM self_goods WHERE goods_id = $1::bigint`, [String(gid2)]);
  const nowPrice = Number(g4[0].skus.find((s) => String(s.sku_id) === String(sku2.sku_id)).price);
  ok(nowPrice === price2, '商品价格已恢复', `¥${nowPrice}（原价 ¥${price2}）`);

  await gdb(`DELETE FROM user_coupon WHERE coupon_id IN (SELECT id FROM coupon WHERE name LIKE '${TAG}%')`);
  await gdb(`DELETE FROM coupon WHERE name LIKE '${TAG}%'`);
  const left = await gdb(`SELECT COUNT(*)::int AS n FROM coupon WHERE name LIKE '${TAG}%'`);
  ok(Number(left[0].n) === 0, '测试券已清理', `残留 ${left[0].n}`);

  console.log(`\n═══ ${pass}/${pass + fail} 通过${fail ? `，${fail} 失败` : '，全绿'} ═══`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
