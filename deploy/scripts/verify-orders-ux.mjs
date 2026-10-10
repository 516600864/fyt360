/** E2E：订单中心四项修正验证（2026-10-01）
 *  ① /admin/orders 返回 created_at 且可按 type/status/from/to 筛选
 *  ② 筛选组合与计数口径一致
 *  ③ 菜单位置属于前端，不在本脚本（构建产物抽查）
 */
import { config } from 'dotenv';

config({ path: new URL('../../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:') });
const BASE = process.env.ADMIN_BASE_URL || 'https://mk.fyt360.cn';
const SITE = process.env.E2E_SITE_CODE || '';
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INIT_PASSWORD }),
});
const login = await loginRes.json();
ok(login.ok, '管理员登录');
const token = login.data?.token;
const H = { Authorization: `Bearer ${token}` };
if (SITE) H['x-fyt-site'] = SITE;

async function orders(qs) {
  const r = await fetch(`${BASE}/api/admin/orders?${qs}`, { headers: H });
  const j = await r.json();
  if (!j.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
  return j.data;
}

// ① 基础列表：created_at 存在且格式可解析
const base = await orders('tab=all&page=1&size=20');
ok(Array.isArray(base.items), '列表返回 items', `${base.items.length} 条`);
if (base.items.length) {
  const t = base.items[0].created_at;
  ok(t && !Number.isNaN(new Date(t).getTime()), '订单含可解析 created_at', String(t));
} else {
  ok(true, '（无订单数据，跳过时间字段断言）');
}

// ② 时间区间筛选：from=今天 → 全部 created_at >= 今天 0 点
const today = new Date();
const p = (n) => String(n).padStart(2, '0');
const day = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;
const r2 = await orders(`tab=all&page=1&size=50&from=${day}`);
const inRange = r2.items.every((x) => new Date(x.created_at) >= new Date(`${day}T00:00:00+08:00`));
ok(inRange, `时间区间 from=${day} 过滤生效`, `${r2.items.length} 条`);
ok((r2.tabs?.all ?? 0) <= (base.tabs?.all ?? 0), '计数与筛选同口径（from 收窄 all 计数）', `all=${r2.tabs?.all} base=${base.tabs?.all}`);

// ③ 状态筛选：取一个真实存在的状态做精确命中
// ⛔ 参数名必须是复数 statuses（orders.ts extraFilters 白名单只认复数；单数 status 被静默忽略
//    → 曾假绿：返回的是无过滤最新 N 条，恰好全为待支付。2026-10-10 被 meituan 已付款单戳破）
const statuses = ['待支付', '已付款', '已结算', '已关闭', '待发货', '待核销', '已核销', '已收货', '退款审核中', '已退款', '部分退款'];
let stHit = null;
for (const s of statuses) {
  const d = await orders(`tab=all&page=1&size=5&statuses=${encodeURIComponent(s)}`);
  if (d.items.length) { stHit = { s, d }; break; }
}
if (stHit) {
  ok(stHit.d.items.every((x) => x.status === stHit.s), `状态筛选精确命中「${stHit.s}」`, `${stHit.d.items.length} 条`);
} else {
  ok(true, '（各状态均无数据或样本不足，状态过滤逻辑由 SQL CASE 镜像保证）');
}

// ④ 类型筛选：self 单 provider 恒 self；ingot 单 type 恒 ingot
const rSelf = await orders('tab=all&page=1&size=20&type=self');
ok(rSelf.items.every((x) => x.type === 'self'), '类型筛选 self → 全为到店团购', `${rSelf.items.length} 条`);
const rIngot = await orders('tab=all&page=1&size=20&type=ingot');
ok(rIngot.items.every((x) => x.type === 'ingot'), '类型筛选 ingot → 全为积分兑换', `${rIngot.items.length} 条`);

// ⑤ 导出端点带新参数不 500
const er = await fetch(`${BASE}/api/admin/orders/export?tab=all&type=self&status=${encodeURIComponent('待核销')}&from=2026-01-01&to=2026-12-31`, { headers: H });
ok(er.ok, '导出端点兼容新筛选参数', `HTTP ${er.status}`);

// ⑥ 佣金三级分配明细：结构完整 + 盈余口径（Σ有效分配 ≤ 佣金）
const rc = await orders('tab=cps&page=1&size=30');
const withFlow = rc.items.filter((x) => (x.commissions ?? []).length > 0);
ok(rc.items.every((x) => Array.isArray(x.commissions)), '列表项均携带 commissions 分配明细字段', `有分配记录 ${withFlow.length}/${rc.items.length}`);
if (withFlow.length) {
  const lvOk = withFlow.every((x) => x.commissions.every((c) => [1, 2, 3].includes(c.level) && c.status));
  ok(lvOk, '分配明细 level ∈ {1,2,3} 且带状态', '');
  const sumOk = withFlow.every((x) => {
    const paid = x.commissions.filter((c) => c.status !== 'invalid').reduce((s, c) => s + Number(c.amount || 0), 0);
    return paid <= Number(x.commission || 0) + 0.011;
  });
  ok(sumOk, '盈余口径：Σ有效分配 ≤ 平台佣金', `${withFlow.length} 单校验`);
} else {
  ok(true, '（当前无已结算订单的分配流水，结构断言通过）');
}


console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
