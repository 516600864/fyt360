// 站点构建期注入（决策 #48）：FYT_SITE=niwo npm run build:mp-weixin
// 读取 sites/<code>/config.json，把 dist 产物的 SITE_CODE 与 project.config.json 的
// appid/projectname 替换为目标站点 —— 源码永远只写默认 site-a，单点真值源 core/bootstrap.js。
// 未设 FYT_SITE 时按 site-a 校准（替换为 no-op），行为与历史构建完全一致。
// 产物泄漏面：包内零凭据（蚂蚁/小程序 secret/支付密钥全在服务端 DB），业务数据运行时拉取。
import { readFileSync, writeFileSync, existsSync, renameSync, cpSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const code = String(process.env.FYT_SITE || 'site-a').trim();

const cfgPath = join(root, 'sites', code, 'config.json');
if (!existsSync(cfgPath)) {
  console.error(`[patch-site] 站点配置不存在: sites/${code}/config.json（可选: site-a / niwo）`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
if (cfg.code !== code) {
  console.error(`[patch-site] config.code(${cfg.code}) 与 FYT_SITE(${code}) 不一致`);
  process.exit(1);
}

const dist = join(root, 'dist', 'build', 'mp-weixin');

// 1) SITE_CODE：产物唯一真值源 core/bootstrap.js（minified 形如 const t="site-a"）
const boot = join(dist, 'core', 'bootstrap.js');
if (!existsSync(boot)) {
  console.error('[patch-site] 未找到 core/bootstrap.js —— 请先跑 uni build（完整 build:mp-weixin 链）');
  process.exit(1);
}
const before = readFileSync(boot, 'utf8');
const hits = (before.match(/"site-a"/g) || []).length;
if (hits) writeFileSync(boot, before.replaceAll('"site-a"', `"${code}"`));
console.log(`[patch-site] SITE_CODE -> ${code}（${hits} 处替换）`);

// 2) project.config.json：appid + projectname（开发者工具导入即用租户 appid，免手改）
const pcPath = join(dist, 'project.config.json');
if (existsSync(pcPath)) {
  const pc = JSON.parse(readFileSync(pcPath, 'utf8'));
  pc.appid = cfg.appid;
  pc.projectname = cfg.name || code;
  writeFileSync(pcPath, JSON.stringify(pc, null, 2));
  console.log(`[patch-site] appid -> ${cfg.appid} / projectname -> ${pc.projectname}`);
} else {
  console.warn('[patch-site] dist 无 project.config.json，跳过 appid 注入');
}

// 3) 站点专属产物副本 dist/sites/<code>/（开发者工具直接导入；默认构建不产出副本，避免混淆）
if (code !== 'site-a') {
  const out = join(root, 'dist', 'sites', code);
  try {
    if (existsSync(out)) renameSync(out, `${out}.trash-${Date.now()}`);
  } catch (e) { /* safe-delete shim 拦截时保留旧副本继续覆盖拷贝 */ }
  cpSync(dist, out, { recursive: true });
  console.log(`[patch-site] 专属包副本 -> dist/sites/${code}/`);
}

console.log(`[patch-site] OK: ${code}（${cfg.name ?? ''}）`);
