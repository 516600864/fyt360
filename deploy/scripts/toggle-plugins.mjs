// 临时切换 cloudbaserc.json 插件集合：node toggle-plugins.mjs [--with-container]
// 默认摘除 container 插件；--with-container 恢复完整配置
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './lib/common.mjs';

const p = path.join(repoRoot, 'cloudbaserc.json');
const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const j = JSON.parse(raw);
const full = [
  {
    use: '@cloudbase/framework-plugin-container',
    inputs: { serviceName: 'fyt360-api', dockerfile: 'server/Dockerfile', cpu: 1, mem: 2 },
  },
  {
    use: '@cloudbase/framework-plugin-website',
    inputs: { buildCommand: 'npm run build:admin', outputPath: 'apps/admin/dist', name: 'fyt360-admin' },
  },
  {
    use: '@cloudbase/framework-plugin-website',
    inputs: { buildCommand: 'npm run build:h5', outputPath: 'apps/h5/dist', name: 'fyt360-h5' },
  },
];
const withContainer = process.argv.includes('--with-container');
const onlyContainer = process.argv.includes('--only-container');
j.framework.plugins = onlyContainer
  ? full.filter((x) => x.use === '@cloudbase/framework-plugin-container')
  : withContainer
    ? full
    : full.filter((x) => x.use !== '@cloudbase/framework-plugin-container');
fs.writeFileSync(p, JSON.stringify(j, null, 2), 'utf8');
console.log('plugins =', j.framework.plugins.map((x) => x.use).join(', '));
