// sync.mjs：把共享渲染器（packages/renderer）同步拷贝到各端 src/renderer/
// 背景：uni-app 构建链对 src 外模块的 chunkFileNames 生成相对路径非法，
// 在 pnpm workspace 化之前，用「单源 + 构建前同步」桥接（见 docs/Schema引擎设计草案.md）。
// 用法：node packages/renderer/sync.mjs（mini/h5 构建脚本与 deploy.mjs 会自动调用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rendererRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(rendererRoot, '..', '..'); // packages/renderer 的上级的上级 = 仓库根
const targets = [
  path.join(repoRoot, 'apps', 'mini', 'src', 'renderer'),
  path.join(repoRoot, 'apps', 'h5', 'src', 'renderer'),
];

const copyDir = (from, to) => {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
};

for (const t of targets) {
  copyDir(path.join(rendererRoot, 'src'), t);
  copyDir(path.join(rendererRoot, 'schema'), path.join(t, 'schema'));
  console.log('[sync-renderer]', path.relative(repoRoot, t));
}
console.log('[sync-renderer] done');
