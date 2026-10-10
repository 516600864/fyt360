// 出包：把 apps/mini/dist/build/mp-weixin 打成「平台模板包」随镜像内置（决策 #48 自助下载版）。
// 产物 → server/assets/miniprogram-template.zip + miniprogram-template.json（{base_code}）。
// 下载时服务端实时注入：bootstrap 的站点 token + project.config 的 appid/项目名
//   —— appid 真相源 = 租户开通向导存的 wechat_mini 凭据，**新站点零部署零 config 即可下载**。
// 平台小程序发新版 = 正常跑一次部署（本来就要发 API），模板自然刷新。
import path from 'node:path';
import fs from 'node:fs';
import { repoRoot } from './lib/common.mjs';
import { zipBuffer } from './lib/zip.mjs';

const dist = path.join(repoRoot, 'apps', 'mini', 'dist', 'build', 'mp-weixin');
const boot = path.join(dist, 'core', 'bootstrap.js');
const outDir = path.join(repoRoot, 'server', 'assets');

if (!fs.existsSync(boot)) {
  console.error('[mp-export] 未找到 mini 产物，先跑: npm run build:mp-weixin --prefix apps/mini');
  process.exit(1);
}

// 识别当前 dist 的站点 token（base_code）：bootstrap 里形如 const t="<code>"
const sitesDir = path.join(repoRoot, 'apps', 'mini', 'sites');
const codes = fs.existsSync(sitesDir)
  ? fs.readdirSync(sitesDir).flatMap((d) => {
      const f = path.join(sitesDir, d, 'config.json');
      return fs.existsSync(f) ? [JSON.parse(fs.readFileSync(f, 'utf8')).code] : [];
    })
  : [];
const bootRaw = fs.readFileSync(boot, 'utf8');
const baseCode = codes.find((c) => bootRaw.includes(`"${c}"`));
if (!baseCode) {
  console.error(`[mp-export] bootstrap.js 未识别到站点 token（候选: ${codes.join('/') || '无 config'}）——产物异常`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

// ⛔ 完整性断言（2026-10-09 D先生：开通页下载包 tabbar 消失事故）：
//   21:42 那轮 container-deploy 与 mini build2 并行，export 在 patch-tabbar（构建链最后一步，
//   负责拷 custom-tab-bar 进 dist）执行前就读了 dist → 模板缺 custom-tab-bar 烧进容器，
//   租户下载的包底部菜单整个消失。此后：缺任一关键文件就 exit 1 响亮失败，绝不静默打残包。
const MUST_HAVE = [
  'app.json',
  'app.js',
  'core/bootstrap.js',
  'common/vendor.js',
  'custom-tab-bar/index.js',
  'custom-tab-bar/index.json',
  'custom-tab-bar/index.wxml',
  'custom-tab-bar/index.wxss',
  'BUILD_VERSION.txt',
];
const missing = MUST_HAVE.filter((f) => !fs.existsSync(path.join(dist, f)));
if (missing.length) {
  console.error(`[mp-export] 产物不完整，拒绝出包（缺: ${missing.join(', ')}）——是否与 mini 构建并行跑了？先等构建完成再部署`);
  process.exit(1);
}
const tabbarCustom = JSON.parse(fs.readFileSync(path.join(dist, 'app.json'), 'utf8')).tabBar?.custom === true;
if (!tabbarCustom) {
  console.error('[mp-export] app.json tabBar.custom !== true，产物异常，拒绝出包');
  process.exit(1);
}
const buildVer = fs.readFileSync(path.join(dist, 'BUILD_VERSION.txt'), 'utf8').trim().split('\n')[0].trim();

const zipPath = path.join(outDir, 'miniprogram-template.zip');
const buf = zipBuffer(dist);
if (buf.length < 10_000) { console.error(`[mp-export] 模板包可疑过小(${buf.length}B)`); process.exit(1); }
fs.writeFileSync(zipPath, buf);
fs.writeFileSync(path.join(outDir, 'miniprogram-template.json'), JSON.stringify({ base_code: baseCode, version: buildVer, built_at: new Date().toISOString() }));
console.log(`[mp-export] 模板包就绪: ${path.basename(zipPath)} ${(buf.length / 1024).toFixed(0)}KB（base_code=${baseCode}, ${buildVer}）`);
