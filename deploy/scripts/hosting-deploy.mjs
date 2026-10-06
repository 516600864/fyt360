// 静态托管直连部署：绕开 framework 网站插件的 CreatePrivateExtensionAndInstall
// 旧通道（新版平台该扩展安装报 ResourceUnavailable），直接用 Hosting API 上传。
// admin → /admin/，h5 → /h5/（§9.1：同主域名按目录分端）
import path from 'node:path';
import fs from 'node:fs';
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

// 1. 确认托管服务状态
const infos = await app.hosting.getInfo();
if (!infos?.length) {
  console.log('[hosting] 未开通，尝试 enableService ...');
  console.log(JSON.stringify(await app.hosting.enableService()));
  console.log('[hosting] 开通是异步任务，请稍后重跑本脚本');
  process.exit(1);
}
console.log('[hosting] CdnDomain =', infos[0].CdnDomain, '| Status =', infos[0].Status);

// 2. 上传两个站点 + 根路径口令页
// h5 产物=uni build（dist/build/h5）；tkl.html 需同时上传到根路径（决策#14/#26：
// 口令页 URL 统一 /tkl.html，mini web-view 与 H5 直跳共用，全仓不改此 URL）
const targets = [
  { local: path.join(repoRoot, 'apps', 'admin', 'dist'), cloud: 'admin' },
  { local: path.join(repoRoot, 'apps', 'h5', 'dist', 'build', 'h5'), cloud: 'h5' },
  { local: path.join(repoRoot, 'apps', 'portal'), cloud: 'portal' },
];
for (const t of targets) {
  console.log(`[hosting] 上传 ${path.relative(repoRoot, t.local)} → /${t.cloud}/`);
  await app.hosting.uploadFiles({
    localPath: t.local,
    cloudPath: t.cloud,
    ignore: /\.map$/,
  });
}
// 根路径 tkl.html（单文件追加，manager-node 对微信只读属性文件需先 chmod）
const tklLocal = path.join(repoRoot, 'apps', 'h5', 'dist', 'build', 'h5', 'tkl.html');
if (fs.existsSync(tklLocal)) {
  try {
    fs.chmodSync(tklLocal, 0o644);
  } catch (e) {}
  console.log('[hosting] 上传 tkl.html → /tkl.html（根路径）');
  await app.hosting.uploadFiles({ localPath: tklLocal, cloudPath: 'tkl.html' });
}
console.log('[hosting] 上传完成');
// 根路径 index.html = portal 首页（/ 直接落 portal，与 /portal/ 同源同步；历史上手动传过旧版导致根路径内容漂移）
const portalIndex = path.join(repoRoot, 'apps', 'portal', 'index.html');
console.log('[hosting] 上传 portal/index.html → /index.html（根路径）');
await app.hosting.uploadFiles({ localPath: portalIndex, cloudPath: 'index.html' });
console.log(`[hosting] 验收地址：https://${infos[0].CdnDomain}/admin/ 与 /h5/ 与 /tkl.html`);
