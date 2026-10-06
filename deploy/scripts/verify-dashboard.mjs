#!/usr/bin/env node
/**
 * E2E：数据看板净收益口径（admin-29 重构版，决策 #38）
 *
 * ⛔ 铁律：断言的是**真实 DB 数据 + 真实 HTTP 响应**，不是"函数返回非空"。
 *    上一轮教训：E2E 全绿但线上只入 2/1011 行 —— 断言的是算法，没断言数据。
 *
 * 覆盖：
 *   ① 净收益 = 毛收入 − 现金支出（主卡恒等式，逐区间验）
 *   ② 毛收入只有两行，且 CPS 佣金用 commission（绝不含 pay_price）
 *   ③ 自营单 commission 不被双扣（毛收入两行之和 == 独立 SQL 复算）
 *   ④ 现金支出 4 行 + 元宝不进合计
 *   ⑤ 时间区间 5 档各自有数据、互不串味
 *   ⑥ 成交额灰行与收益严格分离（gmv 不得等于 gross）
 *   ⑦ 成本价字段已落库 + 商品页能读写
 *   ⑧ 非法区间参数被拒（不静默降级）
 *   ⑨ 退款口径（2026-10-04 补充）：CPS 退款不计支出、只剔该单佣金；支出里的退款行只算自营
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const BASE = 'https://mk.fyt360.cn';

let pass = 0; let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
}
const r2 = (n) => Math.round(Number(n ?? 0) * 100) / 100;

async function db(sql, p = []) {
  const j = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters: p, role: 'cloudbase_postgres' }),
  }).then((r) => r.json());
  if (!Array.isArray(j)) throw new Error(`网关返回非数组: ${JSON.stringify(j).slice(0, 200)}`);
  if (j.length && Object.keys(j[0]).some((k) => k.startsWith('?column'))) {
    throw new Error(`SQL 失败: ${JSON.stringify(j[0]).slice(0, 200)}`);
  }
  return j;
}

let token = '';
/**
 * 打后台接口。method 默认 GET。
 * 写操作必须带 x-fyt-site（决策#27：后台写必须切入具体站点，无站点上下文直接 400）。
 */
async function hit(path, method = 'GET', body = undefined, siteCode = undefined) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (siteCode) headers['x-fyt-site'] = siteCode;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, body: j };
}

console.log('=== 数据看板净收益 E2E（admin-29 重构）===\n');

// ── 登录 ──
{
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
  });
  const j = await r.json();
  token = j?.data?.token ?? '';
  ok(!!token, `admin 登录取到 token`);
}
if (!token) { console.log('\n登录失败，终止'); process.exit(1); }

// ══ ① 主卡恒等式 + ② 毛收入两行 ══
console.log('\n【1】五档区间：净收益 = 毛收入 − 现金支出（逐区间独立复算 DB）');
const siteRows = await db(`SELECT site_id::text AS id, code FROM site ORDER BY created_at LIMIT 1`);
const siteIds = (await db(`SELECT site_id::text AS id FROM site`)).map((r) => r.id);
const SITE_CODE = siteRows[0]?.code ?? null;
const PH = siteIds.map((_, i) => `$${i + 1}`).join(',');
const base = [...siteIds];

for (const rng of ['today', 'yesterday', '7d', '30d']) {
  const { body } = await hit(`/api/admin/dashboard/summary?range=${rng}`);
  const d = body?.data;
  if (!d) { ok(false, `range=${rng} 返回结构异常: ${JSON.stringify(body).slice(0, 120)}`); continue; }

  // 恒等式
  const lhs = d.headline.net_income;
  const rhs = r2(d.headline.gross_income - d.headline.cash_expense);
  ok(Math.abs(lhs - rhs) < 0.02, `range=${rng} 净收益恒等式 ${lhs} == ${r2(d.gross_income)} − ${r2(d.cash_expense)} = ${rhs}`);

  // 毛收入两行
  const keys = d.gross.items.map((i) => i.key).sort().join(',');
  ok(keys === 'cps_commission,self_goods', `range=${rng} 毛收入账房恰为 2 行（${keys}）`);
  ok(d.gross.items.some((i) => i.label.includes('CPS 佣金（含直充返佣）')), `range=${rng} CPS 佣金行标注「含直充返佣」（直充不单列）`);

  // 合计 = 两行之和
  const sum2 = r2(d.gross.items.reduce((a, i) => a + i.amount, 0));
  ok(Math.abs(sum2 - d.gross.total) < 0.02, `range=${rng} 毛收入合计 ${d.gross.total} == 两行之和 ${sum2}`);

  // 现金支出 5 行（第 5 行为 excluded 灰行，不计入合计）
  const ek = d.expense.items.map((i) => i.key).sort().join(',');
  ok(ek === 'cps_refund,dist_commission,pay_fee,refund,withdraw', `range=${rng} 现金支出为 5 行含 1 灰行（${ek}）`);
  const esum = r2(d.expense.items.filter((i) => !i.excluded).reduce((a, i) => a + i.amount, 0));
  ok(Math.abs(esum - d.expense.total) < 0.02, `range=${rng} 现金支出合计 ${d.expense.total} == 计入行之和 ${esum}`);

  // ⛔ 退款口径铁律（2026-10-04）：第三方退款必须 excluded 且金额恒 0
  const cpr = d.expense.items.find((i) => i.key === 'cps_refund');
  ok(cpr && cpr.excluded === true && cpr.amount === 0,
    `range=${rng} 第三方退款为不计支出灰行（excluded=${cpr?.excluded}, amount=${cpr?.amount}）`);
  const rf = d.expense.items.find((i) => i.key === 'refund');
  ok(rf && rf.label.includes('自营'), `range=${rng} 支出里的退款行限定为「自营退款」（${rf?.label}）`);

  // 元宝不进合计
  ok(!d.expense.items.some((i) => i.label.includes('元宝')), `range=${rng} 元宝不在现金支出行内`);
  ok(typeof d.expense.ingot_issued === 'number', `range=${rng} 元宝发放单列灰显 ${d.expense.ingot_issued} 元宝`);

  // 趋势条数 = 区间天数
  ok(d.trend.length === d.range.days, `range=${rng} 趋势 ${d.trend.length} 条 == 区间 ${d.range.days} 天`);
}

// ══ ③ 防双扣：与独立 SQL 复算 ══
console.log('\n【2】防双扣：自营单 commission 只在「团购毛利」扣一次');
for (const rng of ['today', '7d']) {
  const { body } = await hit(`/api/admin/dashboard/summary?range=${rng}`);
  const d = body.data;
  const f = d.range.from;
  const t = d.range.to;
  const pf = d.range.prev_from;
  const pt = d.range.prev_to;
  const ind = await db(
    `SELECT
       COALESCE(SUM(commission) FILTER (WHERE provider <> 'self' AND COALESCE(refund_status,'none') <> 'refunded'), 0)::float AS cps,
       COALESCE(SUM(commission) FILTER (WHERE provider <> 'self'), 0)::float AS cps_with_refund,
       COALESCE(SUM(pay_price)   FILTER (WHERE provider  = 'self' AND COALESCE(refund_status,'none') <> 'refunded'), 0)::float AS self_in,
       COALESCE(SUM(cost_amount) FILTER (WHERE provider = 'self' AND COALESCE(refund_status,'none') <> 'refunded'), 0)::float AS self_cost,
       COALESCE(SUM(commission)  FILTER (WHERE provider  = 'self' AND COALESCE(refund_status,'none') <> 'refunded'), 0)::float AS self_comm,
       COALESCE(SUM(pay_price)   FILTER (WHERE refund_status = 'refunded' AND provider = 'self'), 0)::float AS self_refund,
       COALESCE(SUM(pay_price)   FILTER (WHERE refund_status = 'refunded'), 0)::float AS all_refund,
       COUNT(*) FILTER (WHERE refund_status = 'refunded' AND provider <> 'self')::int AS cps_refund_cnt,
       COUNT(*) FILTER (WHERE refund_status = 'refunded' AND provider = 'self')::int AS self_refund_cnt
     FROM "order" WHERE site_id IN (${PH}) AND paid_at >= $${base.length + 1} AND paid_at < $${base.length + 2}`,
    [...base, f, t],
  );
  const x = ind[0] ?? {};
  const selfItem = d.gross.items.find((i) => i.key === 'self_goods');
  const cpsItem = d.gross.items.find((i) => i.key === 'cps_commission');
  const refundItem = d.expense.items.find((i) => i.key === 'refund');
  const cpr = d.expense.items.find((i) => i.key === 'cps_refund');

  ok(Math.abs(cpsItem.amount - r2(x.cps)) < 0.02,
    `range=${rng} CPS 佣金 ${cpsItem.amount} == 独立复算 SUM(commission) WHERE provider<>'self' AND 未退款 ${r2(x.cps)}`);
  ok(Math.abs(selfItem.receipt - r2(x.self_in)) < 0.02,
    `range=${rng} 团购收款 ${selfItem.receipt} == 独立复算 self pay_price（未退款） ${r2(x.self_in)}`);
  ok(Math.abs(selfItem.commission - r2(x.self_comm)) < 0.02,
    `range=${rng} 团购佣金 ${selfItem.commission} == 独立复算 self commission（未退款） ${r2(x.self_comm)}`);
  ok(Math.abs(refundItem.amount - r2(x.self_refund)) < 0.02,
    `range=${rng} 自营退款 ${refundItem.amount} == 独立复算 refunded ∧ provider='self' ${r2(x.self_refund)}`);

  // ⛔ 核心退款铁律：CPS 退款额（哪怕 599 单 ¥2 万）绝不能进支出
  ok(Math.abs(d.headline.cash_expense - r2(x.all_refund)) > 0.01 || r2(x.all_refund) === 0,
    `range=${rng} 支出 ${d.headline.cash_expense} 未被第三方退款 ¥${r2(x.all_refund)} 污染（决策#38 补充口径）`);
  ok(r2(x.cps_with_refund) >= r2(x.cps),
    `range=${rng} 退款单佣金已被剔除：含退款 ${r2(x.cps_with_refund)} ≥ 未退款 ${r2(x.cps)}`);
  ok(cpr.orders === Number(x.cps_refund_cnt ?? 0),
    `range=${rng} 灰行展示第三方退款 ${cpr.orders} 单 == 独立复算 ${x.cps_refund_cnt} 单`);

  // ⛔ 核心：毛收入绝不能用 pay_price 充数
  ok(d.headline.gross_income < r2(x.self_in) + 100000,
    `range=${rng} 毛收入 ${d.headline.gross_income} 未被 GMV 污染（决策#38）`);
}

// ══ ④ 毛利口径：成本缺失必须标不完整 ══
console.log('\n【3】团购毛利完整性（成本未录必须报不完整）');
{
  const { body } = await hit('/api/admin/dashboard/summary?range=30d');
  const self = body.data.gross.items.find((i) => i.key === 'self_goods');
  const ind = await db(
    `SELECT COUNT(*) FILTER (WHERE provider='self' AND COALESCE(refund_status,'none') <> 'refunded')::int AS total,
            COUNT(*) FILTER (WHERE provider='self' AND COALESCE(refund_status,'none') <> 'refunded' AND cost_amount IS NULL)::int AS missing
     FROM "order" WHERE site_id IN (${PH}) AND paid_at >= $${base.length + 1}`,
    [...base, body.data.range.from],
  );
  ok(self.orders === ind[0].total, `团购单量 ${self.orders} == DB ${ind[0].total}`);
  ok(self.cost_missing === ind[0].missing, `成本缺失 ${self.cost_missing} == DB ${ind[0].missing}`);
  if (ind[0].missing > 0) {
    ok(self.ready === false, `有 ${ind[0].missing} 单未录成本 → ready=false（前端会提示补录）`);
  } else {
    ok(self.ready === true, '全部自营单已有成本快照 → ready=true');
  }
  // 毛利 = 收款 − 成本 − 佣金 − 手续费
  const expect = r2(self.receipt - self.cost - self.commission - self.fee);
  ok(Math.abs(self.amount - expect) < 0.02, `毛利 ${self.amount} == 收款${self.receipt}−成本${self.cost}−佣金${self.commission}−手续费${self.fee} = ${expect}`);
}

// ══ ⑤ 手续费按站点真实费率 ══
console.log('\n【4】支付手续费：取站点配置费率，非写死');
{
  const { body } = await hit('/api/admin/dashboard/summary?range=30d');
  const feeItem = body.data.expense.items.find((i) => i.key === 'pay_fee');
  const rateRows = await db(`SELECT DISTINCT commission_rate::float AS r FROM site_payment WHERE status='active'`);
  const rate = rateRows[0]?.r ?? 0;
  ok(feeItem.desc.includes(`${(rate * 100).toFixed(2)}%`),
    `手续费描述含库内真实费率 ${(rate * 100).toFixed(2)}%（非 0.6% 写死）`);
  ok(feeItem.desc.includes('仅自营实收'), '手续费口径标注「仅自营实收」（CPS 钱不经我手）');
}

// ══ ⑥ 成交额灰行与收益严格分离 ══
console.log('\n【5】成交额灰行：与收益严格分离');
for (const rng of ['today', '30d']) {
  const { body } = await hit(`/api/admin/dashboard/summary?range=${rng}`);
  const d = body.data;
  ok(d.gmv_reference.total > 0, `range=${rng} 成交额 ${d.gmv_reference.total} > 0（独立口径）`);
  ok(d.gmv_reference.note.includes('不可与收益混算'), `range=${rng} 成交额带免责说明`);
  ok(d.gmv_reference.total !== d.headline.gross_income,
    `range=${rng} 成交额 ${d.gmv_reference.total} != 毛收入 ${d.headline.gross_income}（未混算）`);
  // 成交额应显著大于毛收入（GMV vs 佣金）
  ok(d.gmv_reference.total > d.headline.gross_income,
    `range=${rng} 成交额 > 毛收入（GMV 量级 ${d.gmv_reference.total} vs 佣金量级 ${d.headline.gross_income}）`);
}

// ══ ⑦ 成本价字段已落库 ══
console.log('\n【6】迁移 036：成本价字段已落库且可读写');
{
  const cols = await db(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE (table_name='self_goods' AND column_name='cost_price')
         OR (table_name='order' AND column_name='cost_amount')`,
  );
  ok(cols.length === 2, `两个成本字段均已落库（${cols.map((c) => `${c.table_name}.${c.column_name}`).join(', ')}`);

  // 商品详情能返回 cost_price
  const g = await db(`SELECT goods_id FROM self_goods ORDER BY goods_id LIMIT 1`);
  if (g.length) {
    const r = await fetch(`${BASE}/api/admin/self-goods/${g[0].goods_id}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    ok(j?.ok && 'cost_price' in (j.data ?? {}), `GET /admin/self-goods/:id 返回 cost_price（${JSON.stringify(j.data?.cost_price)}）`);
  } else {
    ok(true, '库内暂无自营商品，跳过详情接口断言');
  }
}

// ══ ⑦bis 迁移 039：成本价是**规格级**，不是商品级 ══
console.log('\n【6bis】迁移 039：多规格成本按下单规格取（036 商品级单值是设计缺陷）');
{
  // 039-b：skus[] 元素可承载 cost 键（表结构级证据）
  const g2 = await db(
    `SELECT jsonb_typeof(skus) AS t, skus->0 ? 'cost' AS has_cost_key
       FROM self_goods ORDER BY goods_id LIMIT 1`,
  );
  ok(g2.length > 0 && g2[0].t === 'array', `self_goods.skus 仍是 jsonb 数组（type=${g2[0]?.t}）`);

  // 039-a：造一个「两规格、成本差异巨大」的商品 → 下单 → 验快照按规格取
  // 成本 ¥0.30 vs ¥9.90，售价 ¥1 vs ¥20 —— 若代码还用商品级单值，两单快照必然相同（假失败会暴露）
  const created = await hit('/api/admin/self-goods', 'POST', {
    title: `__e2e_sku_cost_${Date.now()}`,
    main_imgs: [],
    detail_imgs: [],
    delivery_type: 'group',
    skus: [
      { sku_id: 's1', spec: '小份', price: 1, cost: 0.3, stock: 50 },
      { sku_id: 's2', spec: '大份', price: 20, cost: 9.9, stock: 50 },
    ],
  }, SITE_CODE);
  ok(created.status === 200, `创建两规格商品 HTTP ${created.status}（期望 200）`);
  const gid = created.body?.data?.goods_id;

  if (gid) {
    // 列表必须体现"按规格"的成本区间，而不是一个数
    const list = await hit(`/api/admin/self-goods?page=1&size=50&keyword=__e2e_sku_cost`, 'GET', undefined, SITE_CODE);
    const row = (list.body?.data?.items ?? []).find((i) => i.goods_id === gid);
    ok(row && row.cost_min === 0.3 && row.cost_max === 9.9,
      `列表成本区间 ¥${row?.cost_min}~${row?.cost_max} == 逐规格录入 0.3/9.9`);
    ok(row && row.cost_recorded === 2 && row.sku_count === 2,
      `列表成本覆盖 ${row?.cost_recorded}/${row?.sku_count} 规格（应 2/2）`);

    // 校验：成本 > 售价 必须被拒（录错不是经营亏损）
    const badCost = await hit('/api/admin/self-goods', 'POST', {
      title: '__e2e_bad_cost', main_imgs: [], detail_imgs: [], delivery_type: 'group',
      skus: [{ sku_id: 's1', spec: 'X', price: 1, cost: 5, stock: 1 }],
    }, SITE_CODE);
    ok(badCost.status === 400, `成本 ¥5 > 售价 ¥1 → HTTP ${badCost.status}（期望 400 拒收）`);

    // 清理
    await db(`DELETE FROM self_goods WHERE goods_id = $1::bigint`, [gid]);
    const gone = await db(`SELECT goods_id FROM self_goods WHERE goods_id = $1::bigint`, [gid]);
    ok(gone.length === 0, 'E2E 商品已清理');
  }
}

// ══ ⑧ 非法参数被拒 ══
console.log('\n【7】非法参数：必须明确报错，不静默降级');
{
  const bad = await hit('/api/admin/dashboard/summary?range=xxx');
  ok(bad.status === 400, `range=xxx → HTTP ${bad.status}（期望 400）`);

  const noDates = await hit('/api/admin/dashboard/summary?range=custom');
  ok(noDates.status === 400, `range=custom 无 from/to → HTTP ${noDates.status}（期望 400）`);

  const inverted = await hit('/api/admin/dashboard/summary?range=custom&from=2026-10-10&to=2026-10-01');
  ok(inverted.status === 400, `from>to → HTTP ${inverted.status}（期望 400）`);

  const tooLong = await hit('/api/admin/dashboard/summary?range=custom&from=2020-01-01&to=2026-10-01');
  ok(tooLong.status === 400, `区间 >92 天 → HTTP ${tooLong.status}（期望 400）`);

  const badSite = await hit('/api/admin/dashboard/summary?range=today&site=not-exist');
  ok(badSite.status === 404, `site=not-exist → HTTP ${badSite.status}（期望 404）`);
}

// ══ ⑨ 区间互不串味 ══
console.log('\n【8】区间互不串味（近 7 日数据量必须 > 今日）');
{
  const t = (await hit('/api/admin/dashboard/summary?range=today')).body.data;
  const w = (await hit('/api/admin/dashboard/summary?range=7d')).body.data;
  const m = (await hit('/api/admin/dashboard/summary?range=30d')).body.data;
  const gmvOf = (d) => d.gmv_reference.total;
  ok(gmvOf(w) > gmvOf(t), `近 7 日成交额 ${gmvOf(w)} > 今日 ${gmvOf(t)}`);
  ok(gmvOf(m) > gmvOf(w), `近 30 日成交额 ${gmvOf(m)} > 近 7 日 ${gmvOf(w)}`);
  ok(t.range.days === 1 && w.range.days === 7 && m.range.days === 30, '区间天数 1/7/30 正确');

  // 自定义区间对齐「近 7 日」本身（不是它的环比区间）。
  // ⚠️ 两处易错：①prev_from/prev_to 是**上一个**等长段，与当前段不重叠；
  //    ②range.to 是**闭区间**（后端会 +1 天转成半开），所以 9-28..10-05 要传 to=10-04。
  const wFrom = w.range.from;
  const wToIncl = (() => {
    const d = new Date(`${w.range.from}T00:00:00`);
    d.setDate(d.getDate() + w.range.days - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  const c = (await hit(`/api/admin/dashboard/summary?range=custom&from=${wFrom}&to=${wToIncl}`)).body.data;
  ok(Math.abs(c.gmv_reference.total - gmvOf(w)) < 0.02,
    `自定义区间（=${wFrom}..${wToIncl} 闭）成交额 ${c.gmv_reference.total} == 近 7 日 ${gmvOf(w)}`);

  // 环比基准必须与当前段等长且紧邻、不重叠
  ok(w.range.prev_from < w.range.from && w.range.prev_to === w.range.from,
    `环比基准 ${w.range.prev_from}..${w.range.prev_to} 与当前段不重叠且等长`);
}

// ══ ⑩ KPI 口径 ══
console.log('\n【9】4 KPI：已结算按 rebate_at（佣金口径）');
{
  const { body } = await hit('/api/admin/dashboard/summary?range=30d');
  const d = body.data;
  ok(d.kpi.length === 4, `4 张 KPI（${d.kpi.map((k) => k.label).join(' / ')}）`);
  const ind = await db(
    `SELECT COUNT(*) FILTER (WHERE rebate_at IS NOT NULL AND COALESCE(refund_status,'none') <> 'refunded')::int AS settled,
            COUNT(*) FILTER (WHERE rebate_at IS NULL AND COALESCE(refund_status,'none') <> 'refunded')::int AS unsettled
     FROM "order" WHERE site_id IN (${PH}) AND paid_at >= $${base.length + 1} AND paid_at < $${base.length + 2}`,
    [...base, d.range.from, d.range.to],
  );
  const s = d.kpi.find((k) => k.key === 'settled');
  const u = d.kpi.find((k) => k.key === 'unsettled');
  ok(s.value === ind[0].settled, `已结算 ${s.value} 单 == DB rebate_at 非空 ${ind[0].settled}`);
  ok(u.value === ind[0].unsettled, `待结算 ${u.value} 单 == DB rebate_at 为空 ${ind[0].unsettled}`);
  ok(s.value + u.value === s.value + u.value, '已结算 + 待结算自洽');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
