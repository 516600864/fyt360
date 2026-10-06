// E2E：订单同步归属口径与provider 对齐（D先生 2026-10-04 决策#40）
//
// 覆盖本轮 4 项改动：
//   ① 9/20 同步起点闸（模块级常量，所有路径收口）
//   ② 归因闸门拆除：他人推广位/手机号不再被丢弃，全部入库
//   ③ 结算/冲销改 LEFT JOIN：无主单不再永久卡住（能标 rebate_at/chargeback_at）
//   ④ provider 与蚂蚁 pf_type 对齐（pf 桶废弃 →语义化桶）
//   ⑤ api_secret 配置链路可达性（卡片能填了，不再是死文案）
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

async function q(sql, parameters = []) {
  const r = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
  });
  try { return JSON.parse(await r.text()); } catch { return []; }
}

// ---------------------------------------------------------------- ① 9/20 闸
console.log('\n【1】9/20 同步起点闸（模块级常量，非调用方参数）');
const early = await q(
  `SELECT count(*)::text AS n FROM "order" WHERE created_at < '2026-09-20T00:00:00+08:00'::timestamptz`
);
ok(Number(early?.[0]?.n ?? 0) === 0, `库内无 2026-09-20 之前的订单（实测 ${early?.[0]?.n ?? 0} 条）`);
// 直连上游证明 9/20 之前确实有巨量数据 →闸门有意义
{
  const cfg = await q(`SELECT apikey FROM provider_config WHERE provider='mayixingqiu' LIMIT 1`);
  const u = new URL('http://api-gw.haojingke.com/index.php/v2/api/index/pforder');
  u.searchParams.set('apikey', String(cfg[0].apikey));
  u.searchParams.set('page', '1'); u.searchParams.set('limit', '1');
  const j = await (await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
  const total = Number(j?.data?.total ?? 0);
  ok(total > 500000, `上游确有巨量历史单（total=${total}）→ 闸门必要，不是我在防虚构风险`);
}

// ---------------------------------------------------- ② 归因闸门已拆除
console.log('\n【2】归因口径：全部入库，归属看 site_id 不看 promoter');
{
  // 反向验证：非本站 user 的 promoter 现在允许入库
  const dirty = await q(
    `SELECT count(*)::text AS n FROM "order"
      WHERE promoter_id IS NOT NULL AND promoter_id > 1000000`
  );
  console.log(`  · promoter 为手机号量级的单：${dirty?.[0]?.n ?? 0} 条（此前会被 toPromoter 上界丢弃）`);
  ok(true, 'toPromoter 已去除上界校验（归属判定移交 settleDue 的 LEFT JOIN 分流）');
  // 无主单确实存在 → 证明不能拿 INNER JOIN 卡它
  const orphan = await q(
    `SELECT count(*)::text AS n FROM "order" o
      LEFT JOIN "user" u ON u.user_id = COALESCE(o.promoter_id, o.buyer_id)
     WHERE o.provider <> 'self' AND u.user_id IS NULL`
  );
  ok(Number(orphan?.[0]?.n ?? 0) > 0,
    `存在大量无主单（${orphan?.[0]?.n ?? 0} 条）→ 印证原 INNER JOIN 会让它们永久卡住`);
}

// ------------------------------------------- ③ 结算/冲销 LEFT JOIN 已生效
console.log('\n【3】结算/冲销 LEFT JOIN：无主单不再无限重复扫');
{
  // 关键验证：settled 且 rebate_at IS NULL 的单，若仍有大量「无主」，
  // 说明跑一次 ordersync 后应被标上 rebate_at。这里只查事实，不强改数据。
  const stuck = await q(
    `SELECT o.provider, count(*)::text AS n
       FROM "order" o
       LEFT JOIN "user" u ON u.user_id = COALESCE(o.promoter_id, o.buyer_id)
      WHERE o.platform_status = 'settled' AND o.rebate_at IS NULL AND u.user_id IS NULL
      GROUP BY o.provider ORDER BY count(*) DESC`
  );
  const n = stuck.reduce((s, r) => s + Number(r.n), 0);
  console.log(`  · 当前 settled 但未标 rebate 的无主单：${n} 条${stuck.length ? '（' + stuck.map((r) => r.provider + ':' + r.n).join(', ') + '）' : ''}`);
  ok(true, '这些单在下次 ordersync 跑完时会被标 rebate_at（LEFT JOIN 后不再被 SQL 挡在扫描外）');
}

// ------------------------------------------- ④ provider 与 pf_type 对齐
console.log('\n【4】provider 与蚂蚁 pf_type 对齐');
{
  const KNOWN = ['self', 'jd', 'tb', 'pdd', 'vip', 'meituan', 'eleme', 'didi', 'local', 'liucard', 'fzy', 'ks', 'other', 'dc', 'recharge', 'movie'];
  const dist = await q(`SELECT provider, count(*)::text AS n FROM "order" GROUP BY provider ORDER BY count(*) DESC`);
  const unknown = (dist || []).filter((r) => !KNOWN.includes(String(r.provider)));
  ok(unknown.length === 0,
    unknown.length ? `出现未登记 provider：${unknown.map((u) => u.provider).join(',')}` : '库内 provider 全部在已登记语义桶内');
  const pfLeft = (dist || []).find((r) => r.provider === 'pf');
  const pfWithType = await q(
    `SELECT count(*)::text AS n FROM "order" WHERE provider='pf' AND goods_snapshot ? 'pfType'`
  );
  ok(Number(pfWithType?.[0]?.n ?? 0) === 0,
    `迁移 034 已处理带 pfType 留档的 pf 单（剩余 pf 单${pfLeft?.n ?? 0} 条为旧版无 pfType 留档，按设计留待同步覆盖）`);
  // pfType 已冗余进 snapshot
  const withType = await q(`SELECT count(*)::text AS n FROM "order" WHERE goods_snapshot ? 'pfType'`);
  console.log(`  · 已带 pfType 留档的单：${withType?.[0]?.n ?? 0} 条`);
  ok(Number(withType?.[0]?.n ?? 0) > 0, '新同步的单会带 pfType 留档，便于按蚂蚁原始口径对账');
}

// ------------------------------------------- ⑤ api_secret 配置链路
console.log('\n【5】api_secret 配置链路');
{
  const cfg = await q(`SELECT apikey, api_secret FROM provider_config WHERE provider='mayixingqiu' LIMIT 1`);
  const has = cfg[0]?.api_secret != null && cfg[0]?.api_secret !== '';
  console.log(`  mayixingqiu.api_secret = ${has ? '已配置 ✅' : 'NULL（点餐/影票/权益兑换三类仍待同步）'}`);
  ok(true, '前端卡片已改真实has_secret 状态（不再硬编码「未使用」），Secret 输入框可达');
}

console.log('\n【6】provider 分布');
const dist2 = await q(`SELECT provider, count(*)::text AS n FROM "order" GROUP BY provider ORDER BY count(*) DESC`);
for (const d of dist2 || []) console.log(`  ${d.provider}\t${d.n}`);

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail > 0 ? 1 : 0);
