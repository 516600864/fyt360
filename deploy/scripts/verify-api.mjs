// M1 验收③：真实 DB + API 联动冒烟——后台登录 + 小程序拉站点配置 + 重复登录幂等
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 5433;
const API_PORT = 9101;
const DATA_DIR = path.join(repoRoot, 'deploy', '.pgdata-m1-api');

const run = (script, env = {}) => {
  const r = spawnSync(process.execPath, [script], { cwd: repoRoot, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error(`脚本失败: ${script}`);
  }
};

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const pgInst = new EmbeddedPostgres({
    databaseDir: DATA_DIR, user: 'fyt360_tester', password: 'fyt360_local_pw', port: PORT, persistent: false,
  });
  await pgInst.initialise();
  await pgInst.start();
  await pgInst.createDatabase('fyt360');

  const DATABASE_URL = `postgresql://fyt360_tester:fyt360_local_pw@127.0.0.1:${PORT}/fyt360`;
  const env = {
    ...process.env, DATABASE_URL, TCB_ENV: 'm1-api-smoke', JWT_SECRET: 'verify-secret',
    ADMIN_INIT_PASSWORD: 'Fyt360@2026', PORT: String(API_PORT),
  };

  run('deploy/scripts/migrate.mjs', env);
  run('deploy/scripts/seed.mjs', env);

  // 启动 API（tsx 直跑 TS）
  const api = spawn(process.execPath, [path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/src/index.ts'], {
    cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stderr.on('data', (d) => process.stderr.write('[api] ' + d));

  const base = `http://127.0.0.1:${API_PORT}`;
  let healthy = false;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const h = await fetch(base + '/healthz');
      const j = await h.json();
      if (h.status === 200 && j.ok && j.db) { healthy = true; break; }
    } catch { /* retry */ }
  }
  if (!healthy) throw new Error('API /healthz 未就绪（含 DB 检查）');
  console.log('[api-smoke] /healthz 200 + db=true');

  // ① 后台登录（超管 + 初始密码）
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Fyt360@2026' }),
  });
  const loginBody = await login.json();
  if (login.status !== 200 || !loginBody.ok || !loginBody.data.token) throw new Error('登录失败: ' + JSON.stringify(loginBody));
  console.log('[api-smoke] 超管登录 OK, role=' + loginBody.data.admin.role);

  // 错误密码必须 401
  const bad = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });
  if (bad.status !== 401) throw new Error('错误密码未被拒绝: ' + bad.status);
  console.log('[api-smoke] 错误密码 401 OK');

  // ② 小程序拉站点配置 + 默认首页 Schema
  const cfg = await fetch(base + '/api/site/config?code=site-a');
  const cfgBody = await cfg.json();
  if (cfg.status !== 200 || !cfgBody.ok || !cfgBody.data.site) throw new Error('站点配置失败: ' + JSON.stringify(cfgBody));
  const floors = (cfgBody.data.home.schema || []).length;
  console.log(`[api-smoke] 站点配置 OK: ${cfgBody.data.site.name}, 首页楼层数=${floors}`);

  console.log('[api-smoke] 全部通过');
  api.kill('SIGTERM');
  await pgInst.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error('[api-smoke] 失败：', e.message);
  process.exit(1);
});
