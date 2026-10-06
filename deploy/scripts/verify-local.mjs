// 本地验证 harness：嵌入式 PG（隔离 5433）→ migrate → seed → 重复执行 → 计数比对
// 用途：M1 验收「幂等可重跑」；不触碰机器上已有 PG 实例
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const PORT = 5433;
const DATA_DIR = path.join(repoRoot, 'deploy', '.pgdata-m1-test');

const run = (script, env = {}) => {
  const r = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    throw new Error(`脚本失败: ${script}`);
  }
  return (r.stdout ?? '') + (r.stderr ?? '');
};

async function main() {
  console.log('[verify] 启动嵌入式 PostgreSQL (127.0.0.1:' + PORT + ', 数据目录 ' + DATA_DIR + ')');
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const pgInst = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'fyt360_tester',
    password: 'fyt360_local_pw',
    port: PORT,
    persistent: false,
  });
  await pgInst.initialise();
  await pgInst.start();
  await pgInst.createDatabase('fyt360');

  const DATABASE_URL = `postgresql://fyt360_tester:fyt360_local_pw@127.0.0.1:${PORT}/fyt360`;
  const env = { DATABASE_URL, TCB_ENV: 'm1-verify', JWT_SECRET: 'verify-secret', ADMIN_INIT_PASSWORD: 'Fyt360@2026' };
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    console.log('[verify] 第 1 轮 migrate + seed');
    run('deploy/scripts/migrate.mjs', env);
    run('deploy/scripts/seed.mjs', env);
    const snap = () => {
      const tables = ['brand_action_cfg', 'component_template', 'member_level', 'role', 'site', 'admin_user', 'page_schema', 'brand_category'];
      const o = {};
      for (const t of tables) {
        o[t] = client.query(`SELECT COUNT(*)::int AS n FROM ${t}`).then((r) => r.rows[0].n);
      }
      return Promise.all(Object.values(o)).then((vals) => Object.fromEntries(Object.keys(o).map((k, i) => [k, vals[i]])));
    };
    const counts1 = await snap();

    console.log('[verify] 第 2 轮 migrate + seed（幂等验证）');
    run('deploy/scripts/migrate.mjs', env);
    run('deploy/scripts/seed.mjs', env);
    const counts2 = await snap();

    console.log('[verify] 第 1 轮:', JSON.stringify(counts1));
    console.log('[verify] 第 2 轮:', JSON.stringify(counts2));

    const expect = { brand_action_cfg: 159, component_template: 23, member_level: 3, role: 3, site: 1, admin_user: 1, brand_category: 10 };
    const problems = [];
    for (const [k, v] of Object.entries(expect)) {
      if (counts1[k] !== v) problems.push(`${k}=${counts1[k]} 期望 ${v}`);
      if (counts1[k] !== counts2[k]) problems.push(`${k} 幂等失败: ${counts1[k]} → ${counts2[k]}`);
    }

    if (problems.length > 0) {
      console.error('[verify] 校验未通过：\n  - ' + problems.join('\n  - '));
      process.exitCode = 1;
    } else {
      console.log('[verify] 幂等验证通过：159 入口 / 23 组件 / 3 等级 / 3 角色 / 1 站点 / 1 超管，重跑无副作用');
    }
  } finally {
    await client.end().catch(() => {});
    await pgInst.stop();
  }
}

main().catch((e) => {
  console.error('[verify] 失败：', e.message);
  process.exit(1);
});
