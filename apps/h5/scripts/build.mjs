// H5 构建：uni build -p h5（hash 路由 / base /h5/，产物 dist/build/h5）+ tkl.html 兜底拷贝
// 依赖根 node_modules 的 @dcloudio/*（与 mini 同版本同源，Plan 查证 E）
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const uniBin = path.join(repoRoot, 'node_modules', '@dcloudio', 'vite-plugin-uni', 'bin', 'uni.js');
const outDir = path.join(appRoot, 'dist', 'build', 'h5');

// 同步共享渲染器进 src（构建前必须，sync-copy 桥接方案）
spawnSync(process.execPath, [path.join(repoRoot, 'packages', 'renderer', 'sync.mjs')], {
  cwd: repoRoot,
  stdio: 'inherit',
});

const r = spawnSync(process.execPath, [uniBin, 'build', '-p', 'h5'], {
  cwd: appRoot,
  stdio: 'inherit',
});
if (r.status !== 0) process.exit(r.status ?? 1);

// tkl.html 兜底：vite publicDir 理论上会拷，双保险保证口令页随包
const tklSrc = path.join(appRoot, 'public', 'tkl.html');
if (fs.existsSync(tklSrc)) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(tklSrc, path.join(outDir, 'tkl.html'));
}
console.log('[h5] 构建完成 →', outDir);
