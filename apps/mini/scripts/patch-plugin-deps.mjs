// patch-plugin-deps.mjs：构建后补丁 —— 给使用了插件原生组件的编译产物注入 usingComponents。
// 背景：uni-app（vite, vue3）对 pages.json globalStyle.usingComponents 声明的插件组件
// 既不注入页面 json、也不注入嵌套组件 json，而 WeChat 要求「谁的 wxml 用了该标签，
// 谁的 json 必须声明」→ 运行时组件解析失败。此脚本扫描 dist 内所有 wxml，
// 出现 <box 标签的同名 json 注入 plugin://mayi-movie/box（幂等，可重复执行）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'build', 'mp-weixin');
const PLUGIN_TAGS = {
  box: 'plugin://mayi-movie/box', // mayi-movie 影票插件（蚂蚁星球）
};

let patched = 0;
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.wxml')) continue;
    const wxml = fs.readFileSync(p, 'utf8');
    const jsonPath = p.replace(/\.wxml$/, '.json');
    if (!fs.existsSync(jsonPath)) continue;
    const need = Object.entries(PLUGIN_TAGS)
      .filter(([tag]) => new RegExp(`<${tag}[\\s/>]`).test(wxml))
      .map(([tag, ref]) => [tag, ref]);
    if (!need.length) continue;
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    json.usingComponents = json.usingComponents ?? {};
    let changed = false;
    for (const [tag, ref] of need) {
      if (json.usingComponents[tag] !== ref) { json.usingComponents[tag] = ref; changed = true; }
    }
    if (changed) {
      fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
      patched++;
      console.log('[patch-plugin-deps]', path.relative(dist, jsonPath), '←', need.map(([t, r]) => `${t}=${r}`).join(', '));
    }
  }
};

if (!fs.existsSync(dist)) {
  console.error('[patch-plugin-deps] dist 不存在，先执行 uni build');
  process.exit(1);
}
walk(dist);
console.log('[patch-plugin-deps] done, patched:', patched);
