// 输出所有定时任务的回调 token 与 URL（只读，无副作用）
// 正常路径不需要手动跑：node deploy/scripts/function-deploy.mjs --job=all 会自动注入并配置触发器。
// 本脚本仅用于排查（如手工 curl 验证端点、核对线上 env 变量）。
// 任务清单与 function-deploy.mjs 的 JOBS 注册表同源，新增任务两边都不用改。
// 用法：node deploy/scripts/print-cron-token.mjs
import crypto from 'node:crypto';
import { loadDotEnv } from './lib/common.mjs';

loadDotEnv();
const secret = process.env.JWT_SECRET ?? '';
if (!secret) {
  console.error('缺 JWT_SECRET（根 .env）');
  process.exit(1);
}

const BASE = process.env.CRON_BASE_URL ?? 'https://mk.fyt360.cn';
const JOBS = ['ordersync', 'checkin-remind', 'ordersweep'];

for (const name of JOBS) {
  const token = crypto.createHmac('sha256', secret).update(name).digest('hex').slice(0, 32);
  console.log(`${name}\n  POST ${BASE}/api/jobs/${name}/cron?token=${token}`);
}
