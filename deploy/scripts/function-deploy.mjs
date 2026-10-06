// 云函数定时器部署（幂等，多任务注册表）—— 全自动，无需控制台手工配置
//   SCF timer → 云函数 → HTTPS POST 云托管 /api/jobs/<job>/cron?token=
// token 从 .env JWT_SECRET 派生（与 server/src/routes/jobs.ts 同源），不新增 env 变量。
// 用法：
//   node deploy/scripts/function-deploy.mjs                        # 全量部署注册表所有任务（默认）
//   node deploy/scripts/function-deploy.mjs --job=ordersweep       # 只部一个
//   node deploy/scripts/function-deploy.mjs --job=all --invoke     # 全量 + 部署后立即各调一次验证
// 新增定时任务：JOBS 加一行 + deploy/functions/<funcDir>/index.js（通用单 POST 桥可整份复制）
// SCF cron 7 字段（秒 分 时 日 月 周 年），时区为北京时间：
//   每 5 分钟   = 0 */5 * * * * *
//   每 30 分钟  = 0 */30 * * * * *
//   每日 09:00 = 0 0 9 * * * *
import path from 'node:path';
import crypto from 'node:crypto';
import { loadDotEnv, repoRoot } from './lib/common.mjs';
import { createRequire } from 'node:module';

loadDotEnv();
const require = createRequire(import.meta.url);
const CloudBase = require(path.join(repoRoot, 'node_modules', '@cloudbase', 'manager-node'));

const get = (k) => process.env[k] ?? '';
const envId = get('TCB_ENV');
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};

/** 回调域名：优先 CRON_BASE_URL，其次各任务独立 URL 变量，都没有则回退 CloudBase 默认域名 */
const CRON_BASE = (process.env.CRON_BASE_URL ?? `https://${get('TCB_ENV')}.tcloudbaseapp.com`).replace(/\/+$/, '');
const jobUrl = (envKey, jobName) => process.env[envKey] ?? `${CRON_BASE}/api/jobs/${jobName}/cron`;

/** 任务注册表：新增定时任务只需在此加一行 + 复制一份通用桥函数目录 */
const JOBS = {
  ordersync: {
    funcName: 'ordersync-timer',
    funcDir: 'ordersync-timer', // 站点循环版，历史函数不动
    triggerName: 'ordersync-30min',
    cron: process.env.ORDERSYNC_TRIGGER ?? '0 */30 * * * * *',
    url: jobUrl('ORDERSYNC_URL', 'ordersync'),
    hmac: 'ordersync',
    envPrefix: 'ORDERSYNC',
    desc: 'fyt360 ordersync timer (30min cron -> cloudrun ordersync endpoint)',
    envExtra: { ORDERSYNC_SITES: process.env.ORDERSYNC_SITES ?? 'site-a' },
  },
  'checkin-remind': {
    funcName: 'checkin-remind-timer',
    funcDir: 'checkin-remind-timer', // 通用单 POST 桥（目录名必须=函数名，packer 约定）
    triggerName: 'checkin-remind-daily',
    cron: process.env.CHECKIN_REMIND_TRIGGER ?? '0 0 9 * * * *',
    url: jobUrl('CHECKIN_REMIND_URL', 'checkin-remind'),
    hmac: 'checkin-remind',
    envPrefix: 'JOB',
    desc: 'fyt360 checkin-remind timer (daily 09:00 -> cloudrun checkin-remind endpoint)',
    envExtra: {},
  },
  // 未支付订单超时自动关单（2026-10-02）：created 态自营单满 30min → 关单 + 退券 + 回补库存。
  // 5 分钟一跑：微信支付下单有效期 2h，但库存/券被僵尸单占住的窗口越短越好。
  ordersweep: {
    funcName: 'ordersweep-timer',
    funcDir: 'ordersweep-timer',
    triggerName: 'ordersweep-5min',
    cron: process.env.ORDERSWEEP_TRIGGER ?? '0 */5 * * * * *',
    url: jobUrl('ORDERSWEEP_URL', 'ordersweep'),
    hmac: 'ordersweep',
    envPrefix: 'JOB',
    desc: 'fyt360 ordersweep timer (5min -> cloudrun ordersweep endpoint)',
    envExtra: {},
  },
};

const jobKey = arg('job', 'all');
const wantInvoke = process.argv.includes('--invoke');

if (!envId || !get('TCB_SECRET_ID')) {
  console.error('[func] .env 缺少 TCB_ENV / TCB_SECRET_*');
  process.exit(1);
}
if (!get('JWT_SECRET')) {
  console.error('[func] .env 缺少 JWT_SECRET（cron token 派生源）');
  process.exit(1);
}

const app = CloudBase.init({
  secretId: get('TCB_SECRET_ID'),
  secretKey: get('TCB_SECRET_KEY'),
  envId,
});
const fns = app.functions;

/** SCF 操作后函数短暂处于 Updating 状态，相关写操作需重试 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retryWhenUpdating(op, label, times = 6) {
  for (let i = 1; i <= times; i++) {
    try {
      return await op();
    } catch (e) {
      if (!/Updating|ResourceInUse/i.test(String(e?.message ?? e)) || i === times) throw e;
      console.log(`[func] ${label} 状态冲突（第 ${i} 次），5s 后重试 …`);
      await sleep(5_000);
    }
  }
}

/** 部署单个任务：幂等（函数存在则更新代码+配置，不存在则创建含触发器） */
async function deployOne(jobKey) {
  const job = JOBS[jobKey];
  if (!job) throw new Error(`未知任务：${jobKey}`);

  const token = crypto.createHmac('sha256', get('JWT_SECRET')).update(job.hmac).digest('hex').slice(0, 32);
  const FUNC_DIR = path.join(repoRoot, 'deploy', 'functions', job.funcDir);

  const funcConfig = {
    name: job.funcName,
    description: job.desc,
    runtime: 'Nodejs16.13',
    handler: 'index.main',
    timeout: 300,
    installDependency: false,
    envVariables: {
      [`${job.envPrefix}_URL`]: job.url,
      [`${job.envPrefix}_TOKEN`]: token,
      ...job.envExtra,
    },
    triggers: [{ name: job.triggerName, type: 'timer', config: job.cron }],
  };

  const ensureTrigger = async () => {
    const detail = await fns.getFunctionDetail(job.funcName);
    const triggers = detail?.Triggers ?? [];
    const existing = triggers.find((t) => t.TriggerName === job.triggerName);
    // TriggerDesc 是 JSON 串（如 {"cron":"0 */5 * * * * *"}），不是裸 cron，必须解包后比
    const descCron = (t) => {
      if (!t?.TriggerDesc) return null;
      try {
        return JSON.parse(t.TriggerDesc)?.cron ?? null;
      } catch {
        return null;
      }
    };
    if (existing && descCron(existing) === job.cron) {
      console.log(`[func] 触发器 ${job.triggerName} 已存在且配置一致（${job.cron}），跳过`);
      return;
    }
    if (existing) {
      await fns.deleteFunctionTrigger(job.funcName, job.triggerName);
      console.log(`[func] 删除旧触发器（${descCron(existing) ?? existing.TriggerDesc}）`);
    }
    await fns.createFunctionTriggers(job.funcName, funcConfig.triggers);
    console.log(`[func] 触发器已配置：${job.cron}`);
  };

  let created = false;
  try {
    await fns.getFunctionDetail(job.funcName);
    console.log(`[func] ${job.funcName} 已存在 → 更新代码与配置`);
    await fns.updateFunctionCode({ func: { name: job.funcName }, functionRootPath: path.dirname(FUNC_DIR), replace: true });
    await retryWhenUpdating(() => fns.updateFunctionConfig(funcConfig), 'updateFunctionConfig');
  } catch (e) {
    if (!/FunctionNotFound|ResourceNotFound|not found|未找到|1004/i.test(String(e?.message ?? e))) {
      throw new Error(`查询 ${job.funcName} 详情失败：${e?.message ?? e}`);
    }
    console.log(`[func] ${job.funcName} 不存在 → 创建（含定时触发器）`);
    await fns.createFunction({ func: funcConfig, functionRootPath: path.dirname(FUNC_DIR), force: true });
    created = true;
  }

  if (!created) await retryWhenUpdating(ensureTrigger, 'ensureTrigger');
  console.log(`[func] ${job.funcName} 部署完成（env=${envId}，cron=${job.cron}）`);

  if (wantInvoke) {
    console.log('[func] 手动调用一次验证 …');
    const res = await fns.invokeFunction(job.funcName, { source: 'deploy-verify' });
    console.log('[func] invoke 返回：', JSON.stringify(res).slice(0, 600));
  }
}

const keys = jobKey === 'all' ? Object.keys(JOBS) : [jobKey];
for (const k of keys) {
  if (!JOBS[k]) {
    console.error(`[func] 未知任务：${k}（可用：${Object.keys(JOBS).join(' / ')} / all）`);
    process.exit(1);
  }
}

const failed = [];
for (const k of keys) {
  try {
    await deployOne(k);
  } catch (e) {
    console.error(`[func] ${k} 部署失败：`, e?.message ?? e);
    failed.push(k);
  }
}
if (failed.length) {
  console.error(`[func] 以下任务部署失败：${failed.join(', ')}`);
  process.exit(1);
}
console.log(`[func] 全部完成（${keys.length} 个任务）`);
