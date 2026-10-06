// 程序化调用 CloudBase Framework（绕开 CLI standalone 打包的 webpackEmptyContext bug）
// 插件与 framework-core 直接用 ~/.cloudbase-framework/registry 里已装好的原生包
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loadDotEnv, repoRoot } from './lib/common.mjs';

loadDotEnv();

const envId = process.env.TCB_ENV;
const secretId = process.env.TCB_SECRET_ID;
const secretKey = process.env.TCB_SECRET_KEY;
const missing = Object.entries({ TCB_ENV: envId, TCB_SECRET_ID: secretId, TCB_SECRET_KEY: secretKey })
  .filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`[framework] .env 缺少变量: ${missing.join(', ')}`);
  process.exit(1);
}

const registryNm = path.join(os.homedir(), 'cloudbase-framework', 'registry', 'node_modules');
const require = createRequire(import.meta.url);
let core, toolbox;
try {
  core = require(path.join(registryNm, '@cloudbase/framework-core'));
  toolbox = require(path.join(registryNm, '@cloudbase/toolbox'));
} catch (e) {
  console.error(`[framework] 找不到 framework-core（${registryNm}）。先跑一次 CLI 让它安装插件，或手动 npm install 到该 registry。`);
  throw e;
}

// framework-core 不自己读 cloudbaserc.json，由调用方解析并传入（与 CLI 行为一致）
const toolboxNS = toolbox.default && toolbox.default.ConfigParser ? toolbox.default : toolbox;
const rawRc = JSON.parse(fs.readFileSync(path.join(repoRoot, 'cloudbaserc.json'), 'utf8'));
const rcConfig = await toolboxNS.ConfigParser.parseRawConfig(rawRc, repoRoot);

// 新计费（预付费套餐+超限按量）下环境 PayMode 恒为 prepayment，容器插件的
// ensurePostPay 客户端校验已过时（硬编码要求 postpaid）。--patch-postpay 置空
// 该校验，是否允许部署由服务端 API 真实裁决。
if (process.argv.includes('--patch-postpay')) {
  const containerPlugin = require(path.join(registryNm, '@cloudbase/framework-plugin-container'));
  const CP = containerPlugin.plugin || containerPlugin.default || containerPlugin;
  if (typeof CP !== 'function' || !CP.prototype) {
    throw new Error(`[framework] 容器插件导出结构异常: ${Object.keys(containerPlugin)}`);
  }
  CP.prototype.ensurePostPay = async () => {};
  console.log('[framework] 已打补丁：跳过过时的 PayMode=postpaid 客户端校验');
}

console.log(`[framework] 开始程序化部署 envId=${envId} projectPath=${repoRoot}`);
await core.run(
  {
    projectPath: repoRoot,
    cloudbaseConfig: { envId, secretId, secretKey, region: 'ap-shanghai' },
    config: rcConfig,
  },
  'deploy'
);
console.log('[framework] 部署完成');
