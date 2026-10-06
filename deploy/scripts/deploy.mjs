// deploy：环境校验 → migrate → seed → 构建三端 + 静态托管/云托管部署 → 交付输出（§14.2）
// 用法：node deploy/scripts/deploy.mjs [--skip-container]
//   --skip-container（别名 --static-only）：跳过云托管容器部署，只构建+上传 admin/h5 静态托管
import { execSync } from 'node:child_process';
import { loadDotEnv, requireEnv, connectDb, repoRoot } from './lib/common.mjs';

function run(cmd, opts = {}) {
  console.log(`[deploy] $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: repoRoot, ...opts });
}

async function main() {
  loadDotEnv();
  const skipContainer = process.argv.includes('--skip-container') || process.argv.includes('--static-only');

  console.log('[deploy] ===== 阶段 1/6 环境校验 =====');
  requireEnv(['TCB_ENV', 'TCB_SECRET_ID', 'TCB_SECRET_KEY', 'JWT_SECRET', 'ADMIN_INIT_PASSWORD']);

  console.log('[deploy] ===== 阶段 2/6 schema 迁移（幂等） =====');
  run('node deploy/scripts/migrate.mjs');

  console.log('[deploy] ===== 阶段 3/6 seed 初始数据（幂等） =====');
  run('node deploy/scripts/seed.mjs');

  console.log('[deploy] ===== 阶段 4/6 构建 + CloudBase 部署 =====');
  run('npm run build -w apps/admin');
  run('npm run build -w apps/h5');
  run('npm run build:mp-weixin -w apps/mini');
  run('node deploy/scripts/hosting-deploy.mjs');
  if (skipContainer) {
    console.log('[deploy] --skip-container：跳过云托管部署（沿用线上现有版本）');
  } else {
    run('node deploy/scripts/container-deploy.mjs');
  }

  console.log('[deploy] ===== 阶段 5/6 定时器部署（幂等，全自动）=====');
  run('node deploy/scripts/function-deploy.mjs --job=all');

  console.log('[deploy] ===== 阶段 6/6 交付输出 =====');
  const envId = process.env.TCB_ENV;
  const domain = (process.env.CRON_BASE_URL ?? `https://${envId}.tcloudbaseapp.com`).replace(/\/+$/, '');
  console.log(`
============================================================
 FYT360 部署完成
------------------------------------------------------------
 环境 ID        : ${envId}
 正式域名       : ${domain}
 后台地址       : ${domain}/admin/
 H5 入口        : ${domain}/h5/
 API 探针       : ${domain}/healthz
 默认域名       : https://${envId}.tcloudbaseapp.com/admin/（/h5/）
 平台超管       : admin / ${process.env.ADMIN_INIT_PASSWORD ? '（初始密码 = ADMIN_INIT_PASSWORD，首次登录强制改密）' : '未创建'}
 站点级凭据     : 后台「站点管理」录入小程序 appid/secret、蚂蚁星球 key、微信支付商户参数
------------------------------------------------------------
 尚需人工完成（§14.4）：
 1. 小程序代码包用微信开发者工具上传（无法自动化）
 2. 微信公众平台 request 合法域名加 ${domain}（一次性）
 3. 站点微信凭据未录入时跑：node deploy/scripts/provider-setup.mjs（凭据经 PROVIDER_TARGETS env 传入）
 4. 公众号后台网页授权域名加 ${new URL(domain).host}（H5 静默授权）
 5. 微信公众平台「用户隐私保护指引」声明剪贴板（wx.setClipboardData 属隐私接口）
------------------------------------------------------------
 定时任务（已自动部署，无需手工配置）：
   ordersync-timer     每 30 分钟→ /api/jobs/ordersync/cron
   checkin-remind-timer 每日 09:00  → /api/jobs/checkin-remind/cron
   ordersweep-timer    每 5 分钟   → /api/jobs/ordersweep/cron（未支付单超时关单+退券+回补库存）
   重部署/ 改周期：node deploy/scripts/function-deploy.mjs --job=all
============================================================`);
}

main().catch((e) => {
  console.error('[deploy] 失败：', e.message);
  process.exit(1);
});
