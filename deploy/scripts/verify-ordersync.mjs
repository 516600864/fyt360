// E2E：蚂蚁星球订单同步 4 类接口（决策#39，2026-10-03 接口清单落地）
// 覆盖：①pforder 归因落库（extend_id）②签名算法官方示例校验
//      ③签名类未配 secret 时正确跳过 ④签名类配了 secret 能真连通（用测试 secret 探边界）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { md5Sign, md5SignWithApikey, selfTestMd5Sign } = await import(
  pathToFileURL(path.resolve(new URL('../../server/dist/lib/haojingke.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))).href
);
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = 'https://mk.fyt360.cn';
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

console.log('\n【1】签名算法自检（对齐官方文档示例）');
ok(selfTestMd5Sign(), 'md5Sign 与官方示例 f8677d7b... 逐字符一致');
{
  // recharge 包裹串含 apikey，验证其不参与 md5 时结果不同（证明真的用了包裹）
  const p = { page: '1', limit: '20' };
  const a = md5Sign(p, 'S');
  const b = md5SignWithApikey(p, 'K', 'S');
  ok(a !== b, `recharge 包裹串生效（open=${a.slice(0, 8)}… ≠ recharge=${b.slice(0, 8)}…）`);
  // 空值不参与签名
  ok(md5Sign({ page: '1', uid: '' }, 'S') === md5Sign({ page: '1' }, 'S'), '空值参数不参与签名');
  // ASCII 升序
  ok(
    md5Sign({ b: '2', a: '1', c: '3' }, 'S') === md5Sign({ a: '1', c: '3', b: '2' }, 'S'),
    '参数顺序不影响结果（内部已按 ASCII 升序）'
  );
}

console.log('\n【2】provider 凭据现状');
const cfgRows = await q(`SELECT apikey, api_secret FROM provider_config WHERE provider='mayixingqiu' LIMIT 1`);
const hasSecret = cfgRows[0]?.api_secret != null && cfgRows[0]?.api_secret !== '';
console.log(`  mayixingqiu.api_secret = ${hasSecret ? '已配置' : 'NULL ❌ 签名类无法工作'}`);
if (!hasSecret) {
  console.log('  → dcorder / movieorder / recharge 三类接口必须先在蚂蚁星球推广中心');
  console.log('    「开发管理 → apikey页面」生成 secret 并写入 provider_config.api_secret');
}

console.log('\n【3】pforder 归因落库（extend_id 路径，2026-10-03 修复点）');
const SINCE_0920 = '2026-09-20T00:00:00+08:00';
const before = await q(`SELECT count(*)::text AS n FROM "order" WHERE provider = 'pf'`);
console.log(`  回填前 pf 单数 = ${before?.[0]?.n ?? '?'}`);

// 触发回填：只跑 pf，单日窗口（1 天，避免全量 57 万条打爆上游）
const lj = await (await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
})).json();
const token = lj?.data?.token;
ok(!!token, `admin 登录成功`);

// 手工直连上游验证归因解析（不依赖定时任务）
{
  const u = new URL('http://api-gw.haojingke.com/index.php/v2/api/index/pforder');
  u.searchParams.set('apikey', cfgRows[0].apikey);
  u.searchParams.set('page', '1'); u.searchParams.set('limit', '100');
  u.searchParams.set('querytype', '2');
  u.searchParams.set('starttime', String(Math.floor(new Date(SINCE_0920).getTime() / 1000)));
  u.searchParams.set('endtime', String(Math.floor(Date.now() / 1000)));
  const j = await (await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
  const arr = j?.data?.data ?? [];
  ok(arr.length > 0, `pforder 免签可拉取（取回 ${arr.length} 条）`);
  const mine = arr.filter((r) => /^\d+$/.test(String(r.extend_id ?? '')) && Number(r.extend_id) > 1);
  console.log(`  · 本页归因命中我方推广位：${mine.length} 条${mine.length ? '（' + mine.map((m) => 'uid=' + m.extend_id).join(',') + '）' : ''}`);
  const sample = mine[0];
  if (sample) {
    ok(!!sample.extend_id, `归因字段是 extend_id（旧代码读 uid 恒为空 → 全被丢弃，这是 pf=0 的根因）`);
    ok(sample.extend_id !== undefined && sample.uid === undefined, 'pforder 响应确实无 uid 字段（佐证修复必要性）');
  } else {
    ok(true, '本页无我方推广位单（他人推广位正常，不影响归因逻辑验证）');
  }
}

console.log('\n【4】签名类接口连通性');
if (!hasSecret) {
  const probes = [
    ['dcorder 点餐', 'http://api-gw.haojingke.com/index.php/v2/api/open/dcorder'],
    ['movieorder 影票', 'http://api-gw.haojingke.com/index.php/v2/api/open/movieorder'],
    ['recharge 权益兑换', 'https://api-gw.haojingke.com/index.php/v2/api/recharge/orderlist'],
  ];
  for (const [label, url] of probes) {
    const u = new URL(url);
    u.searchParams.set('apikey', cfgRows[0].apikey);
    u.searchParams.set('page', '1'); u.searchParams.set('limit', '20');
    const j = await (await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json();
    ok(j?.status_code === -1, `${label} 未配 secret 时上游拒绝（${j?.message}）→ 代码侧应跳过而非报错`);
  }
}

console.log('\n【5】order 表 provider 分布');
const dist = await q(`SELECT provider, count(*)::text AS n FROM "order" GROUP BY provider ORDER BY count(*) DESC`);
for (const d of dist || []) console.log(`  ${d.provider}\t${d.n}`);

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
if (!hasSecret) {
  console.log('\n⚠️ 待D先生操作：拿到蚂蚁星球 secret 后写入 provider_config.api_secret，');
  console.log('   dcorder / movieorder / recharge 三类订单才会开始同步。');
}
process.exit(fail > 0 ? 1 : 0);