// M2.4 压测：无依赖并发压测脚本（对 mk.fyt360.cn 线上环境）
// 场景：C 端只读接口 + admin 对账接口。注意：
//   - goods list 走蚂蚁星球透传（服务端每 apikey 串行限频 120ms），RPS 封顶是限频器行为，属预期
//   - 强度保守（并发 10 × 15s/场景）：个人版环境，压测目的是找瓶颈与错误，不是打垮服务
// 用法：node deploy/scripts/load-test.mjs [并发数] [每场景秒数]
import { loadDotEnv, repoRoot } from './lib/common.mjs';
import fs from 'node:fs';

loadDotEnv();
const BASE = 'https://mk.fyt360.cn';
const CONCURRENCY = Number(process.argv[2] ?? 10);
const DURATION_MS = Number(process.argv[3] ?? 15) * 1000;
const envFile = fs.readFileSync(repoRoot + '/.env', 'utf8');
const get = (k) => (envFile.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();

// admin token（对账接口需要）
async function adminToken() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: get('ADMIN_INIT_PASSWORD') }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error('admin 登录失败: ' + JSON.stringify(j.message));
  return j.data.token;
}

const token = await adminToken();
const scenarios = [
  { name: 'healthz（探活+DB ping）', url: `${BASE}/healthz` },
  { name: 'site/config（站点配置读）', url: `${BASE}/api/site/config?code=site-a` },
  { name: 'goods/jd/list（CPS 透传，限频封顶）', url: `${BASE}/api/goods/jd/list?page=1&size=10&site=site-a` },
  { name: 'admin/ingot/summary（对账读，鉴权）', url: `${BASE}/api/admin/ingot/summary`, headers: { Authorization: `Bearer ${token}` } },
];

const pct = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor((a.length * p) / 100))] : 0;
};

async function runScenario(s) {
  const latencies = [];
  let errors = 0, status = {};
  const deadline = Date.now() + DURATION_MS;
  const worker = async () => {
    while (Date.now() < deadline) {
      const t0 = Date.now();
      try {
        const r = await fetch(s.url, { headers: s.headers ?? {} });
        status[r.status] = (status[r.status] ?? 0) + 1;
        if (!r.ok) errors++;
      } catch {
        errors++;
        status['net'] = (status['net'] ?? 0) + 1;
      }
      latencies.push(Date.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const rps = (latencies.length / DURATION_MS) * 1000;
  return {
    name: s.name,
    total: latencies.length,
    rps: rps.toFixed(1),
    p50: pct(latencies, 50),
    p95: pct(latencies, 95),
    p99: pct(latencies, 99),
    errors,
    status,
  };
}

console.log(`[load] 目标=${BASE} 并发=${CONCURRENCY} 每场景=${DURATION_MS / 1000}s`);
console.log('[load] 场景'.padEnd(40), 'RPS'.padStart(7), 'P50'.padStart(6), 'P95'.padStart(6), 'P99'.padStart(6), '错误'.padStart(5));
for (const s of scenarios) {
  const r = await runScenario(s);
  console.log(
    ('  ' + r.name).padEnd(42),
    String(r.rps).padStart(7),
    String(r.p50 + 'ms').padStart(7),
    String(r.p95 + 'ms').padStart(7),
    String(r.p99 + 'ms').padStart(7),
    String(r.errors).padStart(5),
    JSON.stringify(r.status)
  );
}
console.log('[load] 完成');
