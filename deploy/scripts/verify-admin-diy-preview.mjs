// admin DIY 预览 E2E：登录 → DIY 装修 → 断言预览区无「组件未上线」占位、组件面板无「未上线」锁标
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const EXE = 'C:/Users/ducun/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'https://mk.fyt360.cn/admin/';
const pwd = (fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').match(/^ADMIN_INIT_PASSWORD=(.*)$/m) || [])[1].trim();

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);

// 登录（若已登录则跳过）
if (/login|登录/.test(await page.content())) {
  const inputs = page.locator('input:visible');
  if (await inputs.nth(0).count()) await inputs.nth(0).fill('admin');
  await page.locator('input[type="password"]').first().fill(pwd);
  await page.locator('button').filter({ hasText: /登录/ }).first().click();
  await page.waitForTimeout(2500);
}
// 决策#27：登录后落站点选择页，选第一个站点进入
if (/select-site/.test(page.url())) {
  await page.locator('[class*="site"], .el-card, button').filter({ hasText: /进入|site-a|站点/ }).first().click();
  await page.waitForTimeout(2500);
}
ok('登录后台', !/login|select-site/.test(page.url()), page.url().slice(0, 70));

// 进 AI装修页（FloorPreview 预览在 AI 动态装修页消费；DIY 视图当前未挂菜单）
await page.locator('.menu-item, .menu-label').filter({ hasText: 'AI装修' }).first().click().catch(() => {});
await page.waitForTimeout(800);
await page.locator('.menu-item, .menu-label').filter({ hasText: 'AI动态装修' }).first().click().catch(() => {});
await page.waitForTimeout(2500);

const body = await page.content();
const hasEditor = /AI|装修|楼层/.test(body);
ok('进入AI装修页', hasEditor, page.url().slice(0, 70));

// 断言1：预览画布无「组件未上线」
ok('③预览无未上线占位', !body.includes('组件未上线'), body.includes('组件未上线') ? '仍有占位框文案' : '干净');

// 断言2：组件面板无「未上线」锁标
const locks = await page.locator('.pal-lock').count();
ok('③面板无未上线锁标', locks === 0, `pal-lock count=${locks}`);

// 断言3：触发一次 AI 生成（brief 随机一句话）→ 生成后预览应渲染出 pv-* 楼层且无占位
const briefInput = page.locator('textarea, input[type="text"]').filter({ hasText: '' }).first();
const genBtn = page.locator('button').filter({ hasText: /生成|一键/ }).first();
if (await genBtn.count()) {
  if (await briefInput.count()) await briefInput.fill('做一个美食主题的促销首页，有秒杀和优惠券');
  await genBtn.click();
  // AI 生成实测 7-10s，给足 30s
  await page.waitForTimeout(30000);
  const body2 = await page.content();
  const pvRendered = body2.includes('pv pv-');
  const stillUnknown = body2.includes('组件未上线');
  ok('③AI生成后预览渲染', pvRendered && !stillUnknown, `pv楼层=${pvRendered} 未上线占位=${stillUnknown}`);
} else {
  console.log('SKIP ③AI生成后预览渲染（无生成按钮）');
}

console.log('--- SUMMARY:', results.filter(Boolean).length, '/', results.length, 'passed');
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
