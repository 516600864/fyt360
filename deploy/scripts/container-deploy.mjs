// 原生 CloudBase Run 部署（新版平台正路，绕开 framework 容器插件的旧扩展通道）
// 依赖 manager-node 的 cloudRun.deploy：打包 server 目录 → 上传 → 创建/更新版本
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadDotEnv, repoRoot } from './lib/common.mjs';
import { createRequire } from 'node:module';

loadDotEnv();
const require = createRequire(import.meta.url);
const CloudBase = require(path.join(repoRoot, 'node_modules', '@cloudbase', 'manager-node'));

const envFile = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
const get = (k) => (envFile.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();

const app = CloudBase.init({
  secretId: get('TCB_SECRET_ID'),
  secretKey: get('TCB_SECRET_KEY'),
  envId: get('TCB_ENV'),
});

if (!fs.existsSync(path.join(repoRoot, 'server', 'dist', 'index.js'))) {
  console.error('[crun] server/dist 不存在，先跑 npm run build -w server');
  process.exit(1);
}

// 决策 #48：部署前生成各站点小程序专属包（server/assets/miniprogram/<code>.zip），随镜像进容器
console.log('[crun] 生成站点小程序包 ...');
const rExport = spawnSync(process.execPath, [path.join(repoRoot, 'deploy', 'scripts', 'export-miniprogram-assets.mjs')], { stdio: 'inherit' });
if (rExport.status !== 0) { console.error('[crun] 站点包生成失败，中止部署'); process.exit(1); }

console.log('[crun] 开始部署 fyt360-api ...');
const res = await app.cloudrun.deploy({
  serverName: 'fyt360-api',
  targetPath: path.join(repoRoot, 'server'),
  deployInfo: { ReleaseType: 'FULL' },
  serverConfig: {
    Cpu: 1,
    Mem: 2,
    MinNum: 0,       // 缩容到零，空闲不产生 CPU/内存费用
    MaxNum: 5,
    Port: 9000,
    Dockerfile: 'Dockerfile',
    InstallDependency: false, // Dockerfile 内自带 npm install
    EnvParams: JSON.stringify({
      TCB_ENV: get('TCB_ENV'),
      JWT_SECRET: get('JWT_SECRET'),
      // SHARED 租户 PG 无 TCP 连接串，走 exec-pgsql HTTP 网关（service_role）
      TCB_API_KEY: get('TCB_API_KEY') || '',
      // 云存储上传通道（装修素材：轮播图/底部菜单图标）
      TCB_SECRET_ID: get('TCB_SECRET_ID') || '',
      TCB_SECRET_KEY: get('TCB_SECRET_KEY') || '',
      TCB_STORAGE_BUCKET: get('TCB_STORAGE_BUCKET') || '',
    }),
  },
});
console.log('[crun] deploy 响应:', JSON.stringify(res).slice(0, 600));

// 轮询部署任务状态（最多 ~8 分钟）
for (let i = 0; i < 32; i++) {
  await new Promise((r) => setTimeout(r, 15000));
  try {
    const t = await app.cloudrun.describeServerManageTask({ serverName: 'fyt360-api' });
    const st = t?.Task?.Status ?? t?.Task?.StatusReason ?? JSON.stringify(t?.Task ?? {});
    console.log(`[crun] poll#${i + 1} status =`, st);
    if (/success|成功|deployed|正常|finished/i.test(String(st))) { console.log('[crun] ✅ 部署完成'); break; }
    if (/fail|失败|error/i.test(String(st))) { console.log('[crun] ❌ 部署失败'); process.exit(1); }
  } catch (e) {
    console.log(`[crun] poll#${i + 1} 查询失败（可能任务尚未生成）: ${e.message?.slice(0, 120)}`);
  }
}
