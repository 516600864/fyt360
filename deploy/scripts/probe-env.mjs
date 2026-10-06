// 探测环境真实计费状态（DescribeEnvs）
import { loadDotEnv, repoRoot } from './lib/common.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';

loadDotEnv();
const require = createRequire(import.meta.url);
const CloudBase = require(path.join(repoRoot, 'node_modules', '@cloudbase', 'manager-node'));
const fs = await import('node:fs');

// 从 .env 读密钥
const envFile = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
const get = (k) => (envFile.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();

const app = CloudBase.init({
  secretId: get('TCB_SECRET_ID'),
  secretKey: get('TCB_SECRET_KEY'),
  envId: get('TCB_ENV'),
});

const res = await app.commonService('tcb').call({
  Action: 'DescribeEnvs',
  Param: {},
});

for (const env of res.EnvList || []) {
  console.log(JSON.stringify({
    EnvId: env.EnvId,
    Alias: env.Alias,
    Status: env.Status,
    PayMode: env.PayMode,            // postpaid=按量  prepaid=预付费
    Source: env.Source,
    Region: env.Region,
    EnvType: env.EnvType ?? undefined,
    IsAutoDegrade: env.IsAutoDegrade,
    CBN: env.CbnStatus?.Status,
    PackageVersion: env.PackageVersion ?? undefined,
  }, null, 2));
}
