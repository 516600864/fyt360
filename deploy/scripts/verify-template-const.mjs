#!/usr/bin/env node
/**
 * verify-template-const.mjs —— 「模板读模块级常量」静态守卫（2026-10-03 新增）
 *
 * 背景：D先生真机报「搜索京东/肯德基卡死」，连查三轮网络/缓存/图片全部健康，
 * 真正的错是：
 *   TypeError: Cannot read properties of undefined (reading '其它会员')
 *   at 渲染函数 (vendor.js)
 * 根因 = `TYPE_EMOJI` 是 `<script>` 顶层 const，uni 编译产物里**不进 this**，
 * 模板 `TYPE_EMOJI[r.cat_name]` 读到 undefined 直接抛；**渲染函数一抛，整个页面
 * 停止更新**，loading 遮罩就永远停在 0.2s —— 用户所见「卡死」，而数据其实早就到了。
 *
 * 这类 bug 后端 E2E 永远测不出来（接口 100% 正常），只能静态拦。
 *
 * 规则：`<script>` 顶层 `const XXX =`（XXX 为大写）若出现在 `<template>` 里，
 *      则它必须经 methods/computed 暴露，或显式挂进 data；否则判定为 ❌。
 *      这里采取更严的口径：模板里**不允许**出现裸的模块级常量名，
 *      一律要求写成 methods 调用（单一来源，且能顺手加兜底）。
 *
 * 用法：node deploy/scripts/verify-template-const.mjs
 * 退出码 0 = 全绿；1 = 有 ❌（CI 可拦）。
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../apps/mini/src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.vue')) out.push(p);
  }
  return out;
}

const results = [];
let bad = 0;
let checked = 0;

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf-8');
  const tpl = src.match(/<template>([\s\S]*?)<\/template>/);
  const scr = src.match(/<script>([\s\S]*?)<\/script>/);
  if (!tpl || !scr) continue;

  const template = tpl[1];
  const script = scr[1];

  // ① 脚本区（去掉 template）里的大写模块级常量
  const constNames = [...script.matchAll(/^const\s+([A-Z][A-Z0-9_]{2,})\s*=/gm)].map((m) => m[1]);

  for (const name of new Set(constNames)) {
    // ② 模板里是否裸引用（排除 ::v-xxx="CAT_EMOJI" 这类不会取值的情况也很简单，全查）
    const re = new RegExp(`(?<![\\w.$])${name}\\b`, 'g');
    const hits = [...template.matchAll(re)];
    if (hits.length === 0) continue;
    checked++;

    // ③ 判定：是否已挂 data（data 段内出现裸名）或 被 methods/computed 引用并暴露
    const dataBlock = script.match(/data\(\)\s*\{\s*return\s*\{([\s\S]*?)\n\s{4}\};/);
    const inData = dataBlock
      ? new RegExp(`(^|[\\s,{])${name}\\s*[,}]`, 'm').test(dataBlock[1])
      : false;

    const rel = file.replace(ROOT, '').replace(/\\/g, '/');
    if (inData) {
      results.push({ ok: true, rel, name, hits: hits.length });
    } else {
      bad++;
      results.push({ ok: false, rel, name, hits: hits.length });
    }
  }
}

console.log('══════════════════════════════════════════════════════════');
console.log(' 模板读模块级常量 静态守卫（2026-10-03 渲染崩溃守卫）');
console.log('══════════════════════════════════════════════════════════');

for (const r of results) {
  console.log(
    `${r.ok ? '✓' : '✗'} ${r.rel} · ${r.name} · 模板引用 ${r.hits} 处 · ${
      r.ok ? '已挂 data，安全' : '❌未挂 data → 渲染读 undefined 会整页崩'
    }`
  );
}

console.log('─'.repeat(60));
console.log(`检查 ${checked} 处模板↔模块级常量引用，${bad} 处危险`);
if (bad > 0) {
  console.log('');
  console.log('修法：把常量保留在模块级，但模板一律改走 methods 调用，');
  console.log('     并在 methods 内加 `?.[key] ?? 默认值` 兜底 —— 字典缺项也只影响单个图标，不会崩整页。');
}
console.log(bad === 0 ? '\n结果：全绿' : `\n结果：${bad} 处危险`);
process.exit(bad === 0 ? 0 : 1);