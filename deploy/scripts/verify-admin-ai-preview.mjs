// ③ 终验：AI 真实生成一版含新组件的楼层 → FloorPreview 渲染无「未上线」占位
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const EXE = 'C:/Users/ducun/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'https://mk.fyt360.cn/admin/';
const pwd = (fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').match(/^ADMIN_INIT_PASSWORD=(.*)$/m) || [])[1].trim();

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);
if (/login/.test(page.url())) {
  await page.locator('input:visible').nth(0).fill('admin');
  await page.locator('input[type="password"]').first().fill(pwd);
  await page.locator('button').filter({ hasText: /登录/ }).first().click();
  await page.waitForTimeout(2500);
}
if (/select-site/.test(page.url())) {
  await page.locator('[class*="site"], .el-card, button').filter({ hasText: /进入|site-a|站点/ }).first().click();
  await page.waitForTimeout(2500);
}
// AI 装修：子菜单默认展开，直接点「AI动态装修」子项
await page.locator('.menu-item').filter({ hasText: 'AI动态装修' }).first().click();
await page.waitForTimeout(2000);

// 填 brief：点名新组件（秒杀/券墙/品牌宫格/邀请有礼），迫使 FloorPreview 走新分支
await page.locator('textarea.prompt-box').first().fill('做一个吃货节促销首页：顶部大轮播，中间放限时秒杀、券墙中心、品牌宫格和邀请有礼楼层，底部商品流。');
const gen = page.locator('.primary-btn.wide, button.primary-btn').first();
const disabled = await gen.getAttribute('disabled');
console.log('[gen btn] disabled=', disabled !== null ? 'yes' : 'no', '| text=', (await gen.textContent()).trim());
await gen.click();
console.log('[gen] clicked, waiting up to 60s...');
await page.waitForTimeout(60000);

const body = await page.content();
const pvClasses = ['pv-seckill', 'pv-cwall', 'pv-bmatrix', 'pv-invite', 'pv-banner', 'pv-gcard'];
const found = pvClasses.filter((c) => body.includes(c));
const unknown = body.includes('组件未上线');
console.log(`[assert] 预览渲染到的 pv 类: ${found.join(', ') || '无'}`);
console.log(`[assert] 「组件未上线」占位出现: ${unknown ? '是 ← FAIL' : '否'}`);
const pass = found.length >= 2 && !unknown;
console.log('--- RESULT:', pass ? 'PASS ✓ 预览走的是真实组件 mock，无占位框' : 'FAIL');
await browser.close();
process.exit(pass ? 0 : 1);
