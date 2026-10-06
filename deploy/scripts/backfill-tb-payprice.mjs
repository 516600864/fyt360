// tb 存量订单 pay_price 回填驱动（2026-09-23 fetchTb 字段错位修复的存量补救）
// 原理：POST /api/jobs/ordersync {tb_start, tb_end} → 服务端只跑 tb fetcher 用指定窗口重拉，
//       upsert ON CONFLICT 覆盖 pay_price/commission（状态机 only-forward 不回退，幂等安全）
// 策略：从最早存量 tb 单前 1h 起按 2.5h 步进（上游窗口上限 3h）扫到 now
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const BASE = 'https://mk.fyt360.cn';
const WINDOW_MS = 2.5 * 3_600_000;

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
}).then((r) => r.json());
if (!login.ok) { console.log('登录失败:', login.message); process.exit(1); }
const auth = { Authorization: `Bearer ${login.data.token}`, 'Content-Type': 'application/json' };

// 全量 tb 单取时间范围
const tbOrders = [];
for (let page = 1; ; page++) {
  const j = await fetch(`${BASE}/api/admin/orders?tab=cps&page=${page}&size=100`, { headers: auth }).then((r) => r.json());
  if (!j.ok) { console.log('订单列表失败:', j.message); process.exit(1); }
  const raw = j.data.items.length;
  tbOrders.push(...j.data.items.filter((o) => o.provider === 'tb'));
  if (raw < 100) break;
}
console.log(`存量 tb 单: ${tbOrders.length}`);
if (!tbOrders.length) process.exit(0);
const zero = tbOrders.filter((o) => !o.pay_price).length;
console.log(`其中 pay_price=0: ${zero}`);
const minT = new Date(Math.min(...tbOrders.map((o) => new Date(o.created_at).getTime())) - 3_600_000);
const maxT = new Date();
console.log('回扫:', minT.toISOString(), '→', maxT.toISOString());

let seg = 0, fetched = 0, upserted = 0, errs = 0;
for (let s = minT.getTime(); s < maxT.getTime(); s += WINDOW_MS) {
  seg++;
  const body = JSON.stringify({ tb_start: new Date(s).toISOString(), tb_end: new Date(Math.min(s + WINDOW_MS, maxT.getTime())).toISOString() });
  let j;
  for (let retry = 0; retry < 3; retry++) {
    j = await fetch(`${BASE}/api/jobs/ordersync`, { method: 'POST', headers: auth, body }).then((r) => r.json());
    if (j.ok) break;
    await new Promise((res) => setTimeout(res, 2000 * (retry + 1)));
  }
  if (j?.ok) {
    fetched += j.data.platforms?.tb?.fetched ?? 0;
    upserted += j.data.platforms?.tb?.upserted ?? 0;
    if (j.data.platforms?.tb?.error) { errs++; console.log(`  段 ${seg} 上游错误:`, j.data.platforms.tb.error.slice(0, 90)); }
  } else {
    errs++;
    console.log(`  段 ${seg} 失败:`, j?.message ?? 'unknown');
  }
  await new Promise((res) => setTimeout(res, 500));
}
console.log(`完成：${seg} 段，上游返回 ${fetched} 单次，upsert ${upserted}，错误段 ${errs}`);

// 复验
let remaining = 0;
for (let page = 1; ; page++) {
  const j = await fetch(`${BASE}/api/admin/orders?tab=cps&page=${page}&size=100`, { headers: auth }).then((r) => r.json());
  if (!j.ok) break;
  remaining += j.data.items.filter((o) => !o.pay_price).length;
  if (j.data.items.length < 100) break;
}
console.log(`回填后 pay_price=0 剩余: ${remaining}`);
