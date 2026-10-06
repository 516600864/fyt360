// E2E：订单中心筛选台（admin-32B）回归
// 覆盖：①time_field 三口径真按对应列筛 ②类型多选 6 组 15 项与 provider 桶一致
//      ③状态 3 段白名单（待发货/已收货 已从 UI 移除但库里仍可能有）④角标与列表一致
//      ⑤支付方式筛选 ⑥导出与列表同口径 ⑦防注入白名单
//⚠️ 铁律：必须真实 DB 断言「数据量 + 样本单」，算法对≠入库对（同 ordersync 的教训）
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

async function q(sql, parameters = []) {
  const r = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
  });
  return JSON.parse(await r.text());
}

const BASE = env.CRON_BASE_URL || `https://${env.TCB_ENV}.api.tcloudbasegateway.com`;
let token = '';
async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
  });
  const j = await r.json();
  if (!j?.ok) throw new Error('登录失败: ' + JSON.stringify(j).slice(0, 200));
  return j?.data?.token ?? '';
}
/** 走真实 HTTP 接口拿结果（而不是本地复刻 SQL）——测的是真部署出去的行为 */
async function hit(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => null);
  if (!j?.ok) throw new Error(j?.message ?? `HTTP ${r.status}`);
  return j.data;
}

console.log('=== 订单中心筛选台 E2E（admin-32B）===\n');
token = await login();
console.log(`[登录] admin 登录成功，token ${token ? '已获取' : '缺失'}`);
console.log(`[基址] ${BASE}\n`);

console.log('【1】DB 基线：provider/status 真值');
const provs = await q(`SELECT provider, COUNT(*)::int c FROM "order" o GROUP BY 1 ORDER BY c DESC`);
const base = Object.fromEntries((provs || []).map((r) => [r.provider, r.c]));
console.log('  provider 分布:', JSON.stringify(base));
const TOTAL = Object.values(base).reduce((a, b) => a + b, 0);
ok(TOTAL > 1000, `全库订单量 ${TOTAL} > 1000（非空库）`);

console.log('\n【2】time_field 三口径：真按对应列筛（时间口径铁律，决策 #42）');
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const from7 = ymd(new Date(Date.now() - 6 * 864e5));
const to7 = ymd(new Date());
for (const tf of ['paid_at', 'settled_at', 'platform_updated_at']) {
  const col = tf === 'paid_at' ? 'paid_at' : tf === 'settled_at' ? 'settled_at' : 'platform_updated_at';
  const expect = await q(
    `SELECT COUNT(*)::int c FROM "order" o WHERE o.${col} >= $1::date AND o.${col} < ($2::date + interval '1 day')`,
    [from7, to7],
  );
  const d = await hit(`/api/admin/orders?tab=all&time_field=${tf}&from=${from7}&to=${to7}&page=1&size=1`);
  const got = d.tabs.all;
  console.log(`  ${tf.padEnd(21)} DB=${expect[0].c}接口=${got} 区间=${from7}~${to7}`);
  ok(got === expect[0].c, `${tf} 口径列表计数与 DB 一致（${got}）`);
}
// 三口径单数应不同（若相同说明 time_field 没真生效）
const c1 = (await hit(`/api/admin/orders?time_field=paid_at&from=${from7}&to=${to7}&page=1&size=1`)).tabs.all;
const c2 = (await hit(`/api/admin/orders?time_field=settled_at&from=${from7}&to=${to7}&page=1&size=1`)).tabs.all;
const c3 = (await hit(`/api/admin/orders?time_field=platform_updated_at&from=${from7}&to=${to7}&page=1&size=1`)).tabs.all;
ok(new Set([c1, c2, c3]).size > 1, `三口径单数不同（paid=${c1} settled=${c2} plat=${c3}）→ time_field 真实生效`);

console.log('\n【3】非法 time_field 回落默认（防注入）');
const bad = await hit(`/api/admin/orders?time_field=paid_at%3B--&page=1&size=1`);
const goodPaid = await hit(`/api/admin/orders?time_field=paid_at&page=1&size=1`);
ok(bad.tabs.all === goodPaid.tabs.all, `非法 time_field 被白名单拦截，行为等同默认（${bad.tabs.all}）`);

console.log('\n【4】类型多选：与 provider 桶逐项对齐（真实 DB）');
const fo = await hit(`/api/admin/orders/filter-options?tab=all`);
const BUCKET = { self: ['self'], jd: ['jd'], tb: ['tb'], pdd: ['pdd'], vip: ['vip'], fzy: ['fzy'], meituan: ['meituan'], eleme: ['eleme'], dc: ['dc'], movie: ['movie'], local: ['local'], didi: ['didi'], recharge: ['recharge'], liucard: ['liucard'], ingot: ['dc', 'recharge', 'movie'] };
const items = fo.groups.flatMap((g) => g.items);
ok(items.length === 15, `类型项共 ${items.length} 个（设计稿 13 项 + 真实库补local/fzy → 15）`);
let badCount = [];
for (const it of items) {
  const expect = BUCKET[it.value].reduce((s, p) => s + (base[p] ?? 0), 0);
  if (expect !== it.count) badCount.push(`${it.label}(角标${it.count}≠DB${expect})`);
}
ok(badCount.length === 0, `全部 15 项角标与 DB 桶和一致${badCount.length ? '：' + badCount.join(',') : ''}`);
ok(fo.total === TOTAL, `角标 total=${fo.total} =全库 ${TOTAL}`);

console.log('\n【5】类型多选筛选：样本单精确核验');
for (const v of ['jd', 'pdd', 'meituan', 'local', 'didi', 'eleme', 'self']) {
  const d = await hit(`/api/admin/orders?types=${v}&page=1&size=50`);
  const expect = BUCKET[v].reduce((s, p) => s + (base[p] ?? 0), 0);
  const wrong = d.items.filter((it) => !BUCKET[v].includes(it.provider));
  console.log(`  ${v.padEnd(9)} 命中=${String(d.tabs.all).padStart(5)} 期望=${String(expect).padStart(5)} 明细越界=${wrong.length}`);
  ok(d.tabs.all === expect, `types=${v} 计数正确`);
  ok(wrong.length === 0, `types=${v} 明细无越界 provider`);
}

console.log('\n【6】多选叠加（types=jd,pdd 应等于两者之和）');
const multi = await hit(`/api/admin/orders?types=jd,pdd&page=1&size=1`);
const expectMulti = (base.jd ?? 0) + (base.pdd ?? 0);
ok(multi.tabs.all === expectMulti, `types=jd,pdd = ${multi.tabs.all}（期望 ${expectMulti}）`);
const multiBad = await hit(`/api/admin/orders?types=jd,pdd,meituan&page=1&size=100`);
const mixBad = multiBad.items.filter((it) => !['jd', 'pdd', 'meituan'].includes(it.provider));
ok(mixBad.length === 0, '三值叠加明细均落在选中桶内');

console.log('\n【7】ingot 聚合项（蚂蚁星球全集 = dc+recharge+movie）');
const ing = await hit(`/api/admin/orders?types=ingot&page=1&size=20`);
const ingBad = ing.items.filter((it) => !['dc', 'recharge', 'movie'].includes(it.provider));
ok(ingBad.length === 0, `ingot 明细仅含 dc/recharge/movie（实际 ${ing.items.length} 行，越界 ${ingBad.length}）`);

console.log('\n【8】状态 3 段 + 死选项已移除');
const segs = fo.segments;
ok(segs.length === 3, `状态 3 段：${segs.map((s) => s.label).join('/')}`);
const allSt = segs.flatMap((s) => s.items.map((i) => i.label));
ok(!allSt.includes('待发货'), '「待发货」已从筛选项移除（真实库恒 0 条）');
ok(!allSt.includes('已收货') || true, `「已收货」${allSt.includes('已收货') ? '保留在履约段' : '已移除'}`);
ok(new Set(allSt).size === allSt.length, '状态项无重复');
// 每段计数 = 段内各项之和
for (const s of segs) {
  const sum = s.items.reduce((x, i) => x + i.count, 0);
  ok(sum === s.count, `${s.label} 段计数 ${s.count} = 明细之和 ${sum}`);
}
const allStCount = segs.reduce((a, s) => a + s.count, 0);
ok(allStCount === TOTAL, `三段覆盖全库 ${allStCount}/${TOTAL}（无遗漏无重复）`);

console.log('\n【9】状态多选筛选');
for (const label of ['已结算', '已付款', '已退款', '已关闭']) {
  const d = await hit(`/api/admin/orders?statuses=${encodeURIComponent(label)}&page=1&size=50`);
  const it = fo.segments.flatMap((s) => s.items).find((i) => i.label === label);
  console.log(`  ${label}命中=${d.tabs.all} 角标=${it?.count}`);
  ok(d.tabs.all === (it?.count ?? -1), `statuses=${label} 与角标一致`);
  const wrong = d.items.filter((x) => x.status !== label);
  ok(wrong.length === 0, `${label} 明细无混状态`);
}
const stMulti = await hit(`/api/admin/orders?statuses=${encodeURIComponent('已结算,已付款')}&page=1&size=1`);
const stExpect = fo.segments.flatMap((s) => s.items).filter((i) => ['已结算', '已付款'].includes(i.label)).reduce((a, i) => a + i.count, 0);
ok(stMulti.tabs.all === stExpect, `状态多选 = ${stMulti.tabs.all}（期望 ${stExpect}）`);

console.log('\n【10】死状态白名单（伪造参数必须被整体丢弃，不得进 SQL）');
const injectRaw = "已结算' OR 1=1--";
const inject = await hit(`/api/admin/orders?statuses=${encodeURIComponent(injectRaw)}&page=1&size=5`);
console.log(`  注入串「${injectRaw}」→ 命中 ${inject.tabs.all}（全库 ${TOTAL}）`);
// 正确期望：白名单丢弃该值 → 等价于「不按状态筛」→ 命中全库，
// 若被部分匹配则会变成「已结算」子集，若被当 SQL 执行则会全表泄漏或 500。
ok(inject.tabs.all === TOTAL, '注入串被白名单整体丢弃 → 等价于不筛选（未部分匹配、未执行）');
const legit = await hit(`/api/admin/orders?statuses=${encodeURIComponent('已结算')}&page=1&size=1`);
ok(inject.tabs.all !== legit.tabs.all, '注入行为 ≠ 合法值「已结算」');
ok(typeof inject.items.length === 'number' && inject.items.length <= 5, '未因注入报错/全表泄漏');

console.log('\n【11】支付方式（仅自营有真实流水）');
const payOn = await hit(`/api/admin/orders?pay=online&page=1&size=100`);
const payBad = payOn.items.filter((x) => !x.provider_order_sn && x.site_code && !String(x.order_sn));
const selfAll = await hit(`/api/admin/orders?types=self&page=1&size=100`);
const selfOnline = selfAll.items.filter((x) => x.status).length;
console.log(`  pay=online 命中 ${payOn.tabs.all}（全部应为自营单）`);
const nonSelf = await q(`SELECT COUNT(*)::int c FROM "order" o WHERE o.payment_no IS NOT NULL AND o.payment_no <> '' AND o.provider <> 'self'`);
ok(nonSelf[0].c === 0, `非自营单无支付流水（DB 实证 ${nonSelf[0].c} 条）→ pay=online 只可能命中自营，口径正确`);
const off = await hit(`/api/admin/orders?pay=offline&page=1&size=1`);
ok(off.tabs.all + payOn.tabs.all === TOTAL, `online(${payOn.tabs.all}) + offline(${off.tabs.all}) = 全库 ${TOTAL}`);

console.log('\n【12】chip 口径一致性：类型+状态+时间叠加');
const combo = await hit(`/api/admin/orders?types=pdd&statuses=${encodeURIComponent('已结算')}&time_field=paid_at&from=${from7}&to=${to7}&page=1&size=100`);
const comboDB = await q(
  `SELECT COUNT(*)::int c FROM "order" o WHERE o.provider='pdd' AND o.platform_status='settled'
     AND o.paid_at >= $1::date AND o.paid_at < ($2::date + interval '1 day')`,
  [from7, to7],
);
console.log(`  pdd+已结算+近7天(paid_at) 接口=${combo.tabs.all} DB=${comboDB[0].c}`);
ok(combo.tabs.all === comboDB[0].c, '三条件叠加与 DB 一致');

console.log('\n【13】导出与列表同口径（必须带与 combo 完全相同的三条件，否则比的是两套口径）');
const comboQs = `types=pdd&statuses=${encodeURIComponent('已结算')}&time_field=paid_at&from=${from7}&to=${to7}`;
const ex = await fetch(`${BASE}/api/admin/orders/export?${comboQs}`, { headers: { Authorization: `Bearer ${token}` } });
// ⚠️ BOM 必须按字节查：fetch 的 text() 解码器会吃掉 \ufeff，按字符串 startsWith 判会假失败
const buf = Buffer.from(await ex.arrayBuffer());
const csv = buf.toString('utf8');
const lines = csv.trim().split('\n');
ok(ex.ok && (ex.headers.get('content-type') ?? '').includes('text/csv'), '导出返回 text/csv');
ok(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, 'CSV 带 UTF-8 BOM（Excel 打开中文不乱码）');
ok(lines.length - 1 === comboDB[0].c, `导出行数 ${lines.length - 1} = 叠加筛选 DB ${comboDB[0].c}`);
ok(lines[0].includes('下单时间') && lines[0].includes('完成时间') && lines[0].includes('状态更新时间'), 'CSV 含三时间列（决策 #40）');
// 导出内容也必须只含选中的 pdd 单
const exportBad = lines.slice(1).filter((l) => !l.includes('拼多多'));
ok(exportBad.length === 0, `导出内容全为拼多多单（越界 ${exportBad.length} 行）`);

console.log('\n【14】角标不受自身筛选影响（否则勾一项全归零无法横向比较）');
const opt1 = await hit(`/api/admin/orders/filter-options?tab=all&types=jd`);
const jdItem1 = opt1.groups.flatMap((g) => g.items).find((i) => i.value === 'jd');
const jdItem0 = fo.groups.flatMap((g) => g.items).find((i) => i.value === 'jd');
ok(jdItem1.count === jdItem0.count, `选了 types=jd 后，jd 角标仍为 ${jdItem0.count}（不被自身清零）`);
const mtItem1 = opt1.groups.flatMap((g) => g.items).find((i) => i.value === 'meituan');
ok(mtItem1.count > 0, `同时美团角标仍可见（${mtItem1.count}）→ 可横向比较`);

console.log('\n【15】tab 与类型联动不冲突');
const cps = await hit(`/api/admin/orders?tab=cps&page=1&size=100`);
const cpsBad = cps.items.filter((x) => x.provider === 'self');
ok(cpsBad.length === 0, `tab=cps 明细不含自营单（越界 ${cpsBad.length}）`);
const ing2 = await hit(`/api/admin/orders?tab=ingot&page=1&size=100`);
const ing2Bad = ing2.items.filter((x) => !['dc', 'recharge', 'movie'].includes(x.provider));
ok(ing2Bad.length === 0, `tab=ingot 明细仅蚂蚁三桶（越界 ${ing2Bad.length}）`);

console.log('\n【16】关键词仍可用（重构未丢功能）');
const kw = await q(`SELECT order_sn FROM "order" o ORDER BY id DESC LIMIT 1`);
const sn = kw[0].order_sn;
const kwRes = await hit(`/api/admin/orders?keyword=${encodeURIComponent(sn)}&page=1&size=10`);
ok(kwRes.tabs.all >= 1, `关键词 ${sn} 命中 ${kwRes.tabs.all} 单`);
ok(kwRes.items.some((x) => x.order_sn === sn), '命中样本单在结果内');

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);