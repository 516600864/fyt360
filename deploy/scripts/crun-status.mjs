// 只查部署任务状态，不部署（container-deploy.mjs 的 poll 复用）
import path from 'node:path';
import { loadDotEnv, repoRoot } from './lib/common.mjs';
import { createRequire } from 'node:module';

loadDotEnv();
const require = createRequire(import.meta.url);
const CloudBase = require(path.join(repoRoot, 'node_modules', '@cloudbase', 'manager-node'));
import fs from 'node:fs';
const envFile = fs.readFileSync(path.join(repoRoot, '.env'), 'utf8');
const get = (k) => (envFile.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();

const app = CloudBase.init({ secretId: get('TCB_SECRET_ID'), secretKey: get('TCB_SECRET_KEY'), envId: get('TCB_ENV') });
const t = await app.cloudrun.describeServerManageTask({ serverName: 'fyt360-api' });
console.log('Task:', JSON.stringify(t?.Task ?? t).slice(0, 500));
const s = await app.cloudrun.describeCloudRunServe({ serverName: 'fyt360-api' }).catch((e) => ({ err: e.message }));
console.log('Serve:', JSON.stringify(s).slice(0, 600));
