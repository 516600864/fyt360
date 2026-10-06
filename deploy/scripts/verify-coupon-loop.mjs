/**
 * 营销券闭环（档 C：领券 → 券包 → 下单抵扣 → 取消退券）E2E：
 *  1 admin 登录 → 2 造一张进行中的自营券 → 3 领券（原子 + 幂等）→ 4 券包可见
 *  5 available 可用券列表 → 6 下单抵扣（实付=原价-抵扣，锁券）→ 7 券变 used + 订单落券痕
 *  8 门槛/越权/已用券拒单 → 9 取消订单退券（+库存回补）→ 10 券墙数据面清理
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
let COUPON_ID = 0;
let USER_TOKEN = '';

(async () => {
  // 1 admin 登录
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INIT_PASSWORD }),
  });
  ADMIN = (await lr.json())?.data?.token ?? '';
  ok(!!ADMIN, '管理员登录');
  USER_TOKEN = jwt.sign({ typ: 'user', userId: UID, siteId: SITE }, process.env.JWT_SECRET);
  const uapi = async (p, opts = {}) => {
    const r = await fetch(BASE + '/api' + p, { headers: { Authorization: `Bearer ${USER_TOKEN}`, 'Content-Type': 'application/json' }, ...opts });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };

  // 2 造券（进行中 / self 范围 / 无门槛 / 总额 5）
  await gdb(`DELETE FROM user_coupon WHERE coupon_id IN (SELECT id FROM coupon WHERE name LIKE 'E2E闭环券%')`);
  await gdb(`DELETE FROM coupon WHERE name LIKE 'E2E闭环券%'`);
  const ins = await gdb(
    `INSERT INTO coupon (site_id, name, type, scope, amount, threshold, total, valid_to)
     VALUES ($1::uuid, $2::varchar, 'cash_off', 'self', 3.00, 0, 5, now() + interval '30 days') RETURNING id`,
    [SITE, 'E2E闭环券-3元'],
  );
  COUPON_ID = Number(ins[0].id);
  ok(COUPON_ID > 0, '创建测试券', `id=${COUPON_ID}`);

  // admin 券库可见 + phase 正确
  const cl = await api('/admin/marketing/coupons');
  const mine = (cl.j?.data?.coupons ?? []).find((c) => c.id === COUPON_ID);
  ok(mine && mine.phase === '进行中', 'admin 券库 phase=进行中', mine?.phase);

  // 3 领券
  const r1 = await uapi(`/me/member/coupons/${COUPON_ID}/receive`, { method: 'POST' });
  ok(r1.status === 200 && r1.j?.data?.already === false, '首次领券成功', JSON.stringify(r1.j?.data));
  const UC = Number(r1.j?.data?.user_coupon_id ?? 0);
  ok(UC > 0, '返回 user_coupon_id', String(UC));

  // issued 自增
  const iss = await gdb(`SELECT issued::int AS issued FROM coupon WHERE id = $1::bigint`, [String(COUPON_ID)]);
  ok(Number(iss[0].issued) === 1, 'coupon.issued 自增', iss[0].issued);

  // 幂等：再领一次 → already=true，且 issued 回退不增
  const r2 = await uapi(`/me/member/coupons/${COUPON_ID}/receive`, { method: 'POST' });
  const iss2 = await gdb(`SELECT issued::int AS issued FROM coupon WHERE id = $1::bigint`, [String(COUPON_ID)]);
  ok(r2.status === 200 && r2.j?.data?.already === true, '重复领券幂等返回 already', JSON.stringify(r2.j?.data));
  ok(Number(iss2[0].issued) === 1, '重复领券 issued 未虚增', iss2[0].issued);

  // 4 券包可见
  const wallet = await uapi('/me/member/coupons?tab=unused');
  const inWallet = (wallet.j?.data?.items ?? []).find((c) => c.coupon_id === COUPON_ID);
  ok(!!inWallet, '券包「待使用」含新领券', inWallet ? `id=${inWallet.id}` : '');
  ok(inWallet?.id === UC, '券包 id = user_coupon_id（下单传这个）');

  // 5 available（拿一个在售商品）
  // 真实商品可能是 0.01 测试价 → 任何券抵扣后都被「支付下限 0.01」吃掉，无法验证抵扣链路。
  // 故临时把该 SKU 价格抬到 20 元（E2E 结束恢复原值）。
  const goods = await gdb(
    `SELECT goods_id, title, skus FROM self_goods WHERE site_id = $1::uuid AND status='on' ORDER BY goods_id DESC LIMIT 1`,
    [SITE],
  );
  const gid = Number(goods[0].goods_id);
  const skuOrig = goods[0].skus[0];
  const ORIG_PRICE = Number(skuOrig.price);
  const ORIG_STOCK = Number(skuOrig.stock);
  const TEST_PRICE = 20;
  await gdb(
    `UPDATE self_goods g SET skus = (
       SELECT jsonb_agg(CASE WHEN e->>'sku_id' = $2::text
                             THEN jsonb_set(e, '{price}', to_jsonb($3::numeric))
                             ELSE e END)
         FROM jsonb_array_elements(g.skus) e)
      WHERE g.goods_id = $1::bigint`,
    [String(gid), String(skuOrig.sku_id), String(TEST_PRICE)],
  );
  const sku = { ...skuOrig, price: TEST_PRICE, stock: ORIG_STOCK };
  const price = TEST_PRICE;
  ok(gid > 0, '取到在售自营商品', `${goods[0].title}（测试价 ¥${TEST_PRICE}，原 ¥${ORIG_PRICE}）`);

  const avail = await uapi(`/me/member/coupons/available?amount=${price}`);
  const av = (avail.j?.data?.items ?? []).find((c) => c.coupon_id === COUPON_ID);
  ok(!!av && av.usable === true, 'available 返回该券且 usable', JSON.stringify(av));

  // 6 下单抵扣
  // 语义：抵扣额 = min(券额, 商品金额)；支付金额下限 0.01（微信不接受 0 元单）；
  //      若抵扣后仍需付 ≥0.01（即抵扣被下限吃掉）→ 视为无有效抵扣，不锁券不落 coupon_id。
  const stockBefore = Number(sku.stock);
  const o1 = await uapi('/trade/orders', {
    method: 'POST',
    body: JSON.stringify({ goods_id: gid, sku_id: String(sku.sku_id), num: 1, user_coupon_id: UC }),
  });
  const rawDiscount = Math.round(Math.min(3, price) * 100) / 100;
  const expectPay = Math.max(0.01, Math.round((price - rawDiscount) * 100) / 100);
  const expectDiscount = Math.round((price - expectPay) * 100) / 100;
  const expectLock = expectDiscount > 0;
  ok(o1.status === 200, '下单成功', JSON.stringify(o1.j?.data));
  ok(Math.abs(Number(o1.j?.data?.pay_price) - expectPay) < 0.001, '实付=max(0.01, 原价-抵扣)', `实付 ${o1.j?.data?.pay_price} / 预期 ${expectPay}`);
  ok(Math.abs(Number(o1.j?.data?.coupon_discount) - expectDiscount) < 0.001, '抵扣额回写一致', `${o1.j?.data?.coupon_discount} / 预期 ${expectDiscount}`);
  ok(Number(o1.j?.data?.pay_price) >= 0.01, '支付金额不低于 0.01（微信不接受 0 元单）', o1.j?.data?.pay_price);
  ok(!!o1.j?.data?.coupon === expectLock, expectLock ? '有效抵扣 → 锁券' : '抵扣被 0.01 下限吃掉 → 不锁券（不白吞用户券）', JSON.stringify(o1.j?.data?.coupon));
  const OID = Number(o1.j?.data?.order_id);

  // 7 券锁定（仅有效抵扣时）+ 订单落痕
  const ucRow = await gdb(`SELECT status, used_order_id FROM user_coupon WHERE id = $1::bigint`, [String(UC)]);
  if (expectLock) {
    ok(ucRow[0].status === 'used' && Number(ucRow[0].used_order_id) === OID, '下单即锁券（status=used + 关联订单）', JSON.stringify(ucRow[0]));
  } else {
    ok(ucRow[0].status === 'unused', '无有效抵扣时券保持 unused', JSON.stringify(ucRow[0]));
  }
  const ord = await gdb(`SELECT coupon_id, coupon_discount::float AS d, pay_price::float AS p FROM "order" WHERE id = $1::bigint`, [String(OID)]);
  const ordCouponId = ord[0].coupon_id ? Number(ord[0].coupon_id) : null;
  ok(ordCouponId === (expectLock ? UC : null), '订单 coupon_id 落库正确', JSON.stringify(ord[0]));
  ok(Math.abs(Number(ord[0].d) - expectDiscount) < 0.001, '订单 coupon_discount 落库一致', ord[0].d);

  // 库存确实扣了
  const g2 = await gdb(`SELECT skus FROM self_goods WHERE goods_id = $1::bigint`, [String(gid)]);
  const stockAfter = Number(g2[0].skus.find((s) => String(s.sku_id) === String(sku.sku_id)).stock);
  ok(stockAfter === stockBefore - 1, '库存扣减 1', `${stockBefore} → ${stockAfter}`);

  // 8 拒单场景（关键回归：券不合法时库存绝不能被扣 —— 2026-10-02 修的库存泄漏）
  const rDup = await uapi('/trade/orders', {
    method: 'POST', body: JSON.stringify({ goods_id: gid, sku_id: String(sku.sku_id), num: 1, user_coupon_id: UC }),
  });
  ok(rDup.status === 409, '已用券再下单被拒 409', `${rDup.status} ${rDup.j?.code}`);
  const rFake = await uapi('/trade/orders', {
    method: 'POST', body: JSON.stringify({ goods_id: gid, sku_id: String(sku.sku_id), num: 1, user_coupon_id: 99999999 }),
  });
  ok(rFake.status === 404, '不存在的券被拒 404', `${rFake.status} ${rFake.j?.code}`);
  const gAfter2 = await gdb(`SELECT skus FROM self_goods WHERE goods_id = $1::bigint`, [String(gid)]);
  const stockLeak = Number(gAfter2[0].skus.find((s) => String(s.sku_id) === String(sku.sku_id)).stock);
  ok(stockLeak === stockAfter, '券校验失败不泄漏库存', `应仍为 ${stockAfter}，实为 ${stockLeak}`);

  // 9 取消订单 → 退券 + 库存回补
  const c1 = await uapi(`/trade/orders/${OID}/cancel`, { method: 'POST' });
  ok(c1.status === 200, '取消未支付单成功', JSON.stringify(c1.j?.data));
  const ucBack = await gdb(`SELECT status, used_order_id FROM user_coupon WHERE id = $1::bigint`, [String(UC)]);
  ok(ucBack[0].status === 'unused' && ucBack[0].used_order_id === null, '取消后退券（回 unused）', JSON.stringify(ucBack[0]));
  const g3 = await gdb(`SELECT skus FROM self_goods WHERE goods_id = $1::bigint`, [String(gid)]);
  const stockBack = Number(g3[0].skus.find((s) => String(s.sku_id) === String(sku.sku_id)).stock);
  ok(stockBack === stockBefore, '取消后库存回补', `${stockAfter} → ${stockBack}（原 ${stockBefore}）`);

  // 重复取消幂等拒绝
  const c2 = await uapi(`/trade/orders/${OID}/cancel`, { method: 'POST' });
  ok(c2.status === 409, '重复取消被拒 409', `${c2.status} ${c2.j?.code}`);

  // 门槛校验：造一张满 999 券
  const ins2 = await gdb(
    `INSERT INTO coupon (site_id, name, type, scope, amount, threshold, total, valid_to)
     VALUES ($1::uuid, 'E2E闭环券-门槛999', 'cash_off', 'self', 5.00, 999, 5, now() + interval '30 days') RETURNING id`,
    [SITE],
  );
  const CID2 = Number(ins2[0].id);
  await uapi(`/me/member/coupons/${CID2}/receive`, { method: 'POST' });
  const uc2 = await gdb(`SELECT id FROM user_coupon WHERE coupon_id = $1::bigint AND user_id = $2::bigint`, [String(CID2), String(UID)]);
  const UC2 = Number(uc2[0].id);
  const o2 = await uapi('/trade/orders', {
    method: 'POST', body: JSON.stringify({ goods_id: gid, sku_id: String(sku.sku_id), num: 1, user_coupon_id: UC2 }),
  });
  ok(o2.status === 409 && o2.j?.code === 'COUPON_THRESHOLD', '未达门槛拒单 COUPON_THRESHOLD', `${o2.status} ${o2.j?.code}`);

  // 停用券不可领
  await api(`/admin/marketing/coupons/${CID2}`, { method: 'PATCH', body: JSON.stringify({ status: 'disabled' }) });
  await gdb(`DELETE FROM user_coupon WHERE coupon_id = $1::bigint`, [String(CID2)]);
  const rDis = await uapi(`/me/member/coupons/${CID2}/receive`, { method: 'POST' });
  ok(rDis.status === 409 && rDis.j?.code === 'COUPON_DISABLED', '停用券不可领', `${rDis.status} ${rDis.j?.code}`);

  // 10 清理：测试券 + 恢复商品价格/库存
  await gdb(`DELETE FROM user_coupon WHERE coupon_id IN (SELECT id FROM coupon WHERE name LIKE 'E2E闭环券%')`);
  await gdb(`DELETE FROM coupon WHERE name LIKE 'E2E闭环券%'`);
  await gdb(
    `UPDATE self_goods g SET skus = (
       SELECT jsonb_agg(
         CASE WHEN e->>'sku_id' = $2::text
              THEN jsonb_set(jsonb_set(e, '{price}', to_jsonb($3::numeric)), '{stock}', to_jsonb($4::int))
              ELSE e END)
         FROM jsonb_array_elements(g.skus) e)
      WHERE g.goods_id = $1::bigint`,
    [String(gid), String(sku.sku_id), String(ORIG_PRICE), String(ORIG_STOCK)],
  );
  const restored = await gdb(`SELECT skus FROM self_goods WHERE goods_id = $1::bigint`, [String(gid)]);
  const rs = restored[0].skus.find((s) => String(s.sku_id) === String(sku.sku_id));
  ok(Math.abs(Number(rs.price) - ORIG_PRICE) < 0.001 && Number(rs.stock) === ORIG_STOCK, '商品价格/库存已恢复', `¥${rs.price} stock ${rs.stock}（原 ¥${ORIG_PRICE} / ${ORIG_STOCK}）`);
  const left = await gdb(`SELECT COUNT(*)::int AS n FROM coupon WHERE name LIKE 'E2E闭环券%'`);
  ok(Number(left[0].n) === 0, '测试数据已清理');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message, e.stack); process.exit(1); });
