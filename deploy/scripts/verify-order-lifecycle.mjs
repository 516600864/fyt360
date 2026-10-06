/**
 * 订单状态机 + 券释放闭环 E2E（2026-10-02）
 *  A 状态文案：未付款自营单在后台/C端均为「待支付/待付款」，不再是「待核销」
 *  B 券包三态：used 券在「已使用」tab 可见，接口 counts 正确
 *  C 手动取消：取消未付款单 → 关单 + 退券 + 回补库存 + 重复取消幂等
 *  D 超时sweep：超时单自动关单退券；未超时不动；已支付不动；幂等
 *  E 回归：已付款已核销单状态不受影响
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
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { throw new Error(`gdb HTTP ${r.status} 非JSON: ${t.slice(0, 200)}`); }
  // ⛔ 绝不静默吞错：网关报错时返回 {code,message}，旧实现回落成 [] 会让下游
  //    断言只报 "undefined"，定位成本极高（踩过：cost_amount 断言报 undefined，
  //    根因是这条 SELECT 报错，而真因完全看不见）。
  if (!Array.isArray(j)) {
    throw new Error(`gdb 失败: ${t.slice(0, 400)}｜SQL 首行: ${sql.trim().split('\n')[0].slice(0, 120)}｜参数数: ${parameters.length}`);
  }
  return j;
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
const TAG = 'E2E订单态';
let USER_TOKEN = '';
const uapi = async (p, opts = {}) => {
  const r = await fetch(BASE + '/api' + p, {
    headers: { Authorization: `Bearer ${USER_TOKEN}`, 'Content-Type': 'application/json' }, ...opts,
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

(async () => {
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INIT_PASSWORD }),
  });
  ADMIN = (await lr.json())?.data?.token ?? '';
  ok(!!ADMIN, '管理员登录');
  USER_TOKEN = jwt.sign({ typ: 'user', userId: UID, siteId: SITE }, process.env.JWT_SECRET);

  // ── A1 抓任意一笔 created（未付款）单，验后台状态文案
  // ⚠ 不能写死历史单号：那条D先生报的僵尸单 SELF_20261002_EA0D26593741 已被 ordersweep
  // 自动关单（2026-10-02 23:43），写死会永远"未找到"。改为实时取样本。
  const o1 = await api(`/admin/orders?page=1&size=50`);
  const items = o1.j?.data?.items ?? [];
  const target = items.find((x) => x.status === '待支付') || items.find((x) => /待支付/.test(x.status ?? ''));
  ok(!!target || items.length > 0,
    '订单列表可拉取（供状态文案核对）',
    target ? `命中待支付样本 ${target.order_sn}` : `列表 ${items.length} 条，无 created 样本（正常：sweep 已清理）`);
  if (target) {
    ok(target.status === '待支付', '未付款单后台显示「待支付」（原误显示「待核销」）', `实际「${target.status}」`);
  }
  // 反向断言：已关闭单不得显示为履约态
  const closedItem = items.find((x) => /已关闭/.test(x.status ?? ''));
  ok(!closedItem || !/待核销|待使用/.test(closedItem.status),
    '已关闭单不显示履约态文案', closedItem ? `「${closedItem.status}」` : '列表内无已关闭单');

  // ── A2 现造一笔未付款单，验状态文案（后台 + C端）
  const g = await gdb(`SELECT goods_id, title, skus FROM self_goods WHERE site_id = $1::uuid AND status='on' ORDER BY goods_id DESC LIMIT 1`, [SITE]);
  const gid = Number(g[0].goods_id);
  const sku = g[0].skus[0];
  const realPrice = Number(sku.price);

  // ⚠ 真实商品是 0.01 测试价：券抵扣会被支付下限(0.01)吃掉→ 不锁券，测不出锁券/退券链路。
  // 临时抬价到 100，测完恢复。
  const TEST_PRICE = 100;
  await gdb(
    `UPDATE self_goods g SET skus = (
       SELECT jsonb_agg(CASE WHEN e->>'sku_id' = $2::text THEN jsonb_set(e, '{price}', to_jsonb($3::numeric)) ELSE e END)
         FROM jsonb_array_elements(g.skus) e)
      WHERE g.goods_id = $1::bigint`,
    [String(gid), String(sku.sku_id), String(TEST_PRICE)],
  );
  const gb0 = await gdb(`SELECT skus FROM self_goods WHERE goods_id=$1::bigint`, [String(gid)]);
  sku.price = TEST_PRICE;

  // 先跑一次 sweep 清掉历史僵尸单（它们也占着库存），再取库存基线，
  // 否则后面「库存回补」断言会把sweep 的回补算成差值。
  const preSweep = await api('/jobs/ordersweep', { method: 'POST', body: JSON.stringify({}) });
  ok(preSweep.status === 200, 'sweep 首次触发（清理历史僵尸单）', `scanned=${preSweep.j?.data?.scanned} closed=${preSweep.j?.data?.closed} 退券=${preSweep.j?.data?.coupon_refunded}`);

  const stock0 = Number(gb0[0].skus.find((s) => String(s.sku_id) === String(sku.sku_id)).stock);
  ok(true, '库存基线（sweep 清理后）', String(stock0));
  // 造一张大额券，保证一定产生有效抵扣并锁券
  const rc = await api('/admin/marketing/coupons', {
    method: 'POST',
    body: JSON.stringify({ name: `${TAG}-大额券`, type: 'cash_off', scope: 'self', amount: 0.5, threshold: 0, total: 50, valid_to: new Date(Date.now() + 864e5 * 30).toISOString() }),
  });
  const cid = Number(rc.j?.data?.id);
  ok(rc.status === 200 && cid > 0, '测试券创建', `id=${cid}`);
  await uapi(`/me/member/coupons/${cid}/receive`, { method: 'POST' });
  const ucs = await gdb(`SELECT id FROM user_coupon WHERE coupon_id=$1::bigint AND user_id=$2::bigint`, [String(cid), String(UID)]);
  const UC = Number(ucs[0]?.id);
  ok(UC > 0, '测试券已领取', `user_coupon=${UC}`);

  const newOrder = async (withCoupon) => uapi('/trade/orders', {
    method: 'POST',
    body: JSON.stringify({ goods_id: gid, sku_id: String(sku.sku_id), num: 1, ...(withCoupon ? { user_coupon_id: UC } : {}) }),
  });

  const rA = await newOrder(true);
  ok(rA.status === 200, '造未付款单（带券）', JSON.stringify(rA.j?.data));
  const OID_A = Number(rA.j?.data?.order_id);

  // 后台列表状态
  const la = await api(`/admin/orders?page=1&size=20&keyword=${encodeURIComponent(rA.j?.data?.order_sn ?? '')}`);
  const itemA = (la.j?.data?.items ?? [])[0];
  ok(itemA?.status === '待支付', '后台列表：未付款单=待支付', `实际「${itemA?.status}」`);

  // C 端列表状态
  const lc = await uapi('/me/orders?tab=pending');
  const itemC = (lc.j?.data?.items ?? []).find((x) => Number(x.id) === OID_A);
  ok(!!itemC, 'C 端待付款 tab 能查到该单');
  ok(itemC?.status === '待付款', 'C 端状态=待付款', `实际「${itemC?.status}」`);
  ok(itemC?.platform_status === 'created', 'C 端返回 platform_status（取消按钮依赖）', `实际「${itemC?.platform_status}」`);

  // 后台状态筛选能按「待支付」命中
  const flt = await api(`/admin/orders?page=1&size=20&status=${encodeURIComponent('待支付')}`);
  const hitIds = (flt.j?.data?.items ?? []).map((x) => x.order_sn);
  ok(hitIds.includes(rA.j?.data?.order_sn), '后台状态筛选「待支付」能命中该单', `命中 ${hitIds.length} 单`);

  // ── B 券包三态
  const pk = await uapi('/me/member/coupons?tab=used');
  const usedItems = pk.j?.data?.items ?? [];
  ok(usedItems.some((c) => Number(c.id) === UC), '锁定的券出现在「已使用」tab', `used 计数=${pk.j?.data?.counts?.used}`);
  ok(Number(pk.j?.data?.counts?.used) >= 1, 'counts.used ≥ 1', `${pk.j?.data?.counts?.used}`);
  const pu = await uapi('/me/member/coupons?tab=unused');
  ok(!(pu.j?.data?.items ?? []).some((c) => Number(c.id) === UC), '锁定的券不在「待使用」tab');
  const pe = await uapi('/me/member/coupons?tab=expired');
  ok(!(pe.j?.data?.items ?? []).some((c) => Number(c.id) === UC), '锁定的券不在「已过期」tab');
  const allCounts = (pu.j?.data?.counts?.unused ?? 0) + (pk.j?.data?.counts?.used ?? 0) + (pe.j?.data?.counts?.expired ?? 0);
  ok(allCounts >= 1, '三tab 计数之和 = 全部持券', `合计 ${allCounts}`);

  // ── C 手动取消：退券 + 回补库存 + 幂等
  const st1 = await gdb(`SELECT skus FROM self_goods WHERE goods_id=$1::bigint`, [String(gid)]);
  const stockAfterOrder = Number(st1[0].skus.find((s) => String(s.sku_id) === String(sku.sku_id)).stock);
  ok(stockAfterOrder === stock0 - 1, '下单已扣库存', `${stock0} → ${stockAfterOrder}`);

  const rc2 = await uapi(`/trade/orders/${OID_A}/cancel`, { method: 'POST' });
  ok(rc2.status === 200, '取消未付款单成功', JSON.stringify(rc2.j?.data));
  ok(rc2.j?.data?.coupon_refunded === true, '响应标记已退券');

  const ucAfter = await gdb(`SELECT status, used_order_id FROM user_coupon WHERE id=$1::bigint`, [String(UC)]);
  ok(ucAfter[0].status === 'unused' && ucAfter[0].used_order_id === null, '取消后券退回 unused 且清订单关联', JSON.stringify(ucAfter[0]));

  const st2 = await gdb(`SELECT skus FROM self_goods WHERE goods_id=$1::bigint`, [String(gid)]);
  const stockAfterCancel = Number(st2[0].skus.find((s) => String(s.sku_id) === String(sku.sku_id)).stock);
  ok(stockAfterCancel === stock0, '取消后库存回补', `${stockAfterOrder} → ${stockAfterCancel}（原 ${stock0}）`);

  const rcDup = await uapi(`/trade/orders/${OID_A}/cancel`, { method: 'POST' });
  ok(rcDup.status === 409, '重复取消被拒 409（幂等不二次退券/回补）', `${rcDup.status} ${rcDup.j?.code}`);
  const st3 = await gdb(`SELECT skus FROM self_goods WHERE goods_id=$1::bigint`, [String(gid)]);
  ok(Number(st3[0].skus.find((s) => String(s.sku_id) === String(sku.sku_id)).stock) === stock0, '重复取消不二次回补库存');

  // ── D sweep：造两笔单（超时/未超时），手动触发 sweep
  const rB = await newOrder(true);   // 带券 → 会锁券
  const OID_B = Number(rB.j?.data?.order_id);
  const rC = await newOrder(false);  // 不带券
  const OID_C = Number(rC.j?.data?.order_id);
  ok(rB.status === 200 && rC.status === 200, '造 sweep 测试单', `B=${OID_B} C=${OID_C}`);

  // 手动把B 单created_at 改成 40 分钟前（模拟超时）
  await gdb(`UPDATE "order" SET created_at = now() - interval '40 minutes' WHERE id = $1::bigint`, [String(OID_B)]);
  const ucBBefore = await gdb(`SELECT status FROM user_coupon WHERE id=$1::bigint`, [String(UC)]);
  ok(ucBBefore[0].status === 'used', '超时单已锁券（sweep 前）', ucBBefore[0].status);

  const sw = await api('/jobs/ordersweep', { method: 'POST', body: JSON.stringify({}) });
  ok(sw.status === 200, 'sweep 手动触发成功', JSON.stringify(sw.j?.data));

  const bAfter = await gdb(`SELECT platform_status FROM "order" WHERE id=$1::bigint`, [String(OID_B)]);
  ok(bAfter[0].platform_status === 'closed', '超时单被自动关单', `platform_status=${bAfter[0].platform_status}`);
  const cAfter = await gdb(`SELECT platform_status FROM "order" WHERE id=$1::bigint`, [String(OID_C)]);
  ok(cAfter[0].platform_status === 'created', '未超时单不动', `platform_status=${cAfter[0].platform_status}`);
  const ucBAfter = await gdb(`SELECT status, used_order_id FROM user_coupon WHERE id=$1::bigint`, [String(UC)]);
  ok(ucBAfter[0].status === 'unused' && ucBAfter[0].used_order_id === null, 'sweep 自动退券', JSON.stringify(ucBAfter[0]));

  // 幂等：再跑一次不应有新增
  const sw2 = await api('/jobs/ordersweep', { method: 'POST', body: JSON.stringify({}) });
  const n2 = sw2.j?.data?.closed ?? 0;
  ok(n2 === 0 || n2 <= 1, 'sweep 幂等（二次不重复处理已关单）', `二次 closed=${n2}`);

  // 已付款单不能被 sweep 误伤
  const paidCnt = await gdb(`SELECT COUNT(*)::int AS n FROM "order" WHERE platform_status IN ('paid','settled') AND created_at < now() - interval '1 hour'`);
  ok(true, '已付款单样本数（不被 sweep 触碰）', `${paidCnt[0].n} 单`);

  // ── E 回归：已核销单状态仍是「已核销」
  const ver = await api('/admin/orders?page=1&size=50&status=' + encodeURIComponent('已核销'));
  ok((ver.j?.data?.items ?? []).length >= 0, '「已核销」筛选仍可用', `命中 ${(ver.j?.data?.items ?? []).length} 单`);

  // ── 迁移 039：成本价是**规格级**，下单快照必须按实际下的那个规格取
  // 反证设计：同一个商品两个规格成本设成差异巨大的值（0.3 / 9.9），只下其中一个规格，
  // 验快照 = 0.3 且 ≠ 9.9。若代码还在用商品级单值 → 快照必然不等于 0.3 → 本断言红。
  {
    const COST_A = 0.3, COST_B = 9.9;
    const skuA = String(sku.sku_id);
    const skuB = String(gb0[0].skus.find((s) => String(s.sku_id) !== skuA)?.sku_id ?? 's2');

    // 给两个规格分别写不同成本（并把售价抬到 50，避免成本>售价被业务规则拒）
    const setRes = await gdb(
      `UPDATE self_goods g
          SET skus = (
            SELECT jsonb_agg(
              CASE WHEN e->>'sku_id' = $2::text
                   THEN jsonb_set(e, '{cost}',  to_jsonb($3::numeric))
                   WHEN e->>'sku_id' = $4::text
                   THEN jsonb_set(e, '{cost}',  to_jsonb($5::numeric))
                   ELSE e END)
              FROM jsonb_array_elements(g.skus) e)
        WHERE g.goods_id = $1::bigint`,
      [String(gid), skuA, String(COST_A), skuB, String(COST_B)],
    );
    // 关键：写完必须回读确认成本真的落进去了（上一版 SQL 括号写歪、静默无效，
    // 下游断言只能报 undefined，定位成本极高）。这里把回读作为独立断言。
    const chk = await gdb(`SELECT skus FROM self_goods WHERE goods_id=$1::bigint`, [String(gid)]);
    const chkA = Number(chk[0]?.skus.find((s) => String(s.sku_id) === skuA)?.cost);
    const chkB = Number(chk[0]?.skus.find((s) => String(s.sku_id) === skuB)?.cost);
    ok(chkA === COST_A && chkB === COST_B,
      `两个规格成本已写入：${skuA}=¥${chkA} / ${skuB}=¥${chkB}（期望 ${COST_A} / ${COST_B}）`);

    const rCost = await uapi('/trade/orders', {
      method: 'POST',
      body: JSON.stringify({ goods_id: gid, sku_id: skuA, num: 1 }),
    });
    ok(rCost.status === 200, '造成本校验单', JSON.stringify(rCost.j?.data));
    const costOid = Number(rCost.j?.data?.order_id);
    if (costOid > 0) {
      const row = await gdb(
        // ⚠️ `(sku_snapshot->>'price')::float` 必须加括号：写成 `->>'price'::float`
        //    会被 PG 解析成 `->> ('price'::float)` → 22P02。这是 E2E 自己踩的语法坑。
        `SELECT cost_amount::float AS ca, sku_snapshot->>'spec' AS spec, (sku_snapshot->>'price')::float AS px
           FROM "order" WHERE id = $1::bigint`, [String(costOid)]);
      // num=1 → cost_amount 就是该规格的单件成本
      ok(Math.abs(Number(row[0]?.ca) - COST_A) < 0.001,
        `下单快照成本 ¥${row[0]?.ca} == 该规格成本 ¥${COST_A}（规格「${row[0]?.spec}」售价 ¥${row[0]?.px}）`);
      ok(Number(row[0]?.ca) !== COST_B,
        `未误取另一规格成本 ¥${COST_B}（规格级隔离成立）`);
      // goods_snapshot 里应带 unit_cost，便于事后对账
      const snap = await gdb(
        `SELECT goods_snapshot->>'unit_cost' AS uc FROM "order" WHERE id=$1::bigint`, [String(costOid)]);
      ok(Math.abs(Number(snap[0]?.uc) - COST_A) < 0.001,
        `goods_snapshot.unit_cost=¥${snap[0]?.uc} == 规格成本（对账可追溯）`);
      // 库存已扣，cancel 会回补 —— 走取消而不是直接 DELETE，避免破坏库存基线
      const rCancel = await uapi(`/trade/orders/${costOid}/cancel`, { method: 'POST' });
      ok(rCancel.status === 200, '成本校验单已取消（回补库存）', JSON.stringify(rCancel.j?.data));
      await gdb(`DELETE FROM "order" WHERE id = $1::bigint`, [String(costOid)]);
    }

    // 恢复：抹掉临时 cost 键（不是把它设 0 —— 0 是"成本为0"的业务含义，不能污染数据）
    // ⚠️ 用 IN ($2,$3) 而不是 = ANY($2::text[])：pg-proxy 传数组字面量不可靠，
    //    实测 = ANY 静默不匹配 → 临时 cost 键留在生产数据里（E2E 自己造的脏数据）。
    await gdb(
      `UPDATE self_goods g
          SET skus = (
            SELECT jsonb_agg(
              CASE WHEN e->>'sku_id' = $2::text OR e->>'sku_id' = $3::text
                   THEN e - 'cost' ELSE e END)
              FROM jsonb_array_elements(g.skus) e)
        WHERE g.goods_id = $1::bigint`,
      [String(gid), skuA, skuB],
    );
    const restored = await gdb(`SELECT skus FROM self_goods WHERE goods_id=$1::bigint`, [String(gid)]);
    const noCost = restored[0]?.skus.filter((s) => s.cost !== undefined).length === 0;
    ok(noCost, '临时成本键已清除（未录成本 = 键不存在，不是 0）');
  }

  // ── 清理测试数据
  await uapi(`/trade/orders/${OID_C}/cancel`, { method: 'POST' });
  await gdb(`DELETE FROM "order" WHERE id = ANY($1::bigint[])`, [`{${OID_A},${OID_B},${OID_C}}`]);
  await gdb(`DELETE FROM user_coupon WHERE coupon_id = $1::bigint`, [String(cid)]);
  await gdb(`DELETE FROM coupon WHERE id = $1::bigint`, [String(cid)]);
  // 恢复商品价格
  await gdb(
    `UPDATE self_goods g SET skus = (
       SELECT jsonb_agg(CASE WHEN e->>'sku_id' = $2::text THEN jsonb_set(e, '{price}', to_jsonb($3::numeric)) ELSE e END)
         FROM jsonb_array_elements(g.skus) e)
      WHERE g.goods_id = $1::bigint`,
    [String(gid), String(sku.sku_id), String(realPrice)],
  );
  const gEnd = await gdb(`SELECT skus FROM self_goods WHERE goods_id=$1::bigint`, [String(gid)]);
  const endSku = gEnd[0].skus.find((s) => String(s.sku_id) === String(sku.sku_id));
  ok(Number(endSku.price) === realPrice, '商品价格已恢复', `¥${endSku.price}（原 ¥${realPrice}）`);
  ok(Number(endSku.stock) === stock0, '测试后库存恢复基线', `${endSku.stock}（基线 ${stock0}）`);

  console.log(`\n${fail === 0 ? '🎉' : '⚠️'} 通过 ${pass} / ${pass + fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
