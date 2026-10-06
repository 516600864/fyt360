// patch-buildver.mjs：构建后把页面里的 buildVer 常量替换为「真实构建时间戳」。
//
// 为什么需要（2026-10-03，D先生真机报「搜京东还是卡死」排查发现）：
//   buildVer 原是源码里手写的硬编码常量 'BUILD 20260930.1135'，改了代码也不变。
//   → 出遮罩时看到的版本号永远是同一个，D先生无法判断真机跑的是修复前还是修复后的包，
//     「我明明改了怎么还卡」这类问题就会反复出现且无法自证。
//   → 改成构建时按 mtime 注入真实时间戳（格式 BUILD YYYYMMDD.HHmm），
//     每次构建产物自带身份，出遮罩即可自证包的版本，与 D先生的验收铁律
//     「dist 时间戳 / bundle 抽查 / 浏览器实测」同一思路。
//
// 幂等：可重复执行。只替换两种形态：
//   1) buildVer: 'BUILD 20260930.1135'      （vite 未压缩，dist 内 js 仍保留字符串字面量）
//   2) buildVer:"BUILD 20260930.1135"       （压缩后无空格）
//   3) __FYT_BUILD_VER__                   （源码占位符写法）
// 匹配不到时不报错但计数为 0，由调用方（build:mp-weixin 链）提示。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '..', 'dist', 'build', 'mp-weixin');

if (!fs.existsSync(dist)) {
  console.error('[patch-buildver] dist 不存在，先执行 uni build');
  process.exit(1);
}

const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const VER = `BUILD ${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.${p(d.getHours())}${p(d.getMinutes())}`;

let patched = 0;
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    if (fs.statSync(fp).isDirectory()) {
      walk(fp);
      continue;
    }
    if (!name.endsWith('.js')) continue;
    const src = fs.readFileSync(fp, 'utf8');
    if (!src.includes('BUILD ')) continue;
    // 保留版本号右引号前的内容，仅替换 BUILD 时间串
    const out = src.replace(/BUILD \d{8}\.\d{4}/g, VER);
    if (out !== src) {
      fs.writeFileSync(fp, out);
      patched++;
      console.log('[patch-buildver]', path.relative(dist, fp), '←', VER);
    }
  }
};
walk(dist);

// 构建级落档：把本次版本号写进 dist，供部署/验收脚本读取核对
fs.writeFileSync(path.join(dist, 'BUILD_VERSION.txt'), `${VER}\n${new Date().toISOString()}\n`);

console.log('[patch-buildver] done, ver =', VER, '| patched files =', patched);
if (patched === 0) {
  console.warn('[patch-buildver] ⚠ 未匹配到任何 BUILD 版本串 —— 若预期注入成功，请检查源码 buildVer 是否被改动');
}
