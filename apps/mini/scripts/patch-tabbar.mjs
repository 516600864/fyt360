/**
 * M4 patch：构建后把 custom-tab-bar（原生 4 件套）拷入 dist 根 + 校验 app.json。
 * 挂在 build:mp-weixin 链尾（patch-plugin-deps 之后），幂等。
 */
import { copyFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const miniRoot = join(here, '..');
const srcDir = join(miniRoot, 'custom-tab-bar-src');
const distDir = join(miniRoot, 'dist', 'build', 'mp-weixin');

if (!existsSync(distDir)) {
  console.error('[patch-tabbar] dist 不存在，先跑构建');
  process.exit(1);
}

// 1) 拷贝 4 件套 + icons/
mkdirSync(join(distDir, 'custom-tab-bar'), { recursive: true });
for (const f of ['index.js', 'index.json', 'index.wxml', 'index.wxss']) {
  copyFileSync(join(srcDir, f), join(distDir, 'custom-tab-bar', f));
}
const iconsSrc = join(srcDir, 'icons');
if (existsSync(iconsSrc)) {
  const iconsDist = join(distDir, 'custom-tab-bar', 'icons');
  mkdirSync(iconsDist, { recursive: true });
  for (const f of readdirSync(iconsSrc)) {
    if (f.endsWith('.png')) copyFileSync(join(iconsSrc, f), join(iconsDist, f));
  }
}

// 2) 校验 app.json：custom:true 且 list 5 项
const app = JSON.parse(readFileSync(join(distDir, 'app.json'), 'utf8'));
const tb = app.tabBar ?? {};
const ok = tb.custom === true && Array.isArray(tb.list) && tb.list.length === 5;
if (!ok) {
  console.error('[patch-tabbar] app.json tabBar 异常：', JSON.stringify(tb).slice(0, 200));
  process.exit(1);
}
const pages = new Set(app.pages);
const need = ['pages/index/index', 'pages/shell/s2', 'pages/shell/s3', 'pages/shell/s4', 'pages/shell/s5'];
const missing = need.filter((p) => !pages.has(p));
if (missing.length) {
  console.error('[patch-tabbar] app.json 缺壳页注册：', missing.join(','));
  process.exit(1);
}
console.log('[patch-tabbar] done: custom-tab-bar 4 件套已入 dist，tabBar custom 5 壳页校验通过');
