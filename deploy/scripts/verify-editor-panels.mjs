// 页面装修（DiyEditor）新增组件面板 E2E：登录 → AI 页 → 页面装修 → 加组件 → 断言属性面板非空壳
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const EXE = 'C:/Users/ducun/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'https://mk.fyt360.cn/admin/';
const pwd = (fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').match(/^ADMIN_INIT_PASSWORD=(.*)$/m) || [])[1].trim();

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const results = [];
const ok = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };

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
// AI 装修 → 页面装修 tab
await page.locator('.menu-item').filter({ hasText: 'AI动态装修' }).first().click();
await page.waitForTimeout(1500);
await page.locator('.view-tab').filter({ hasText: '页面装修' }).first().click();
await page.waitForTimeout(2000);
ok('进入页面装修', await page.locator('.palette').count() > 0);

// 逐个添加组件并断言属性面板出现关键编辑字段
const cases = [
  { pal: '通用容器', expect: '正文' },
  { pal: '分类导航', expect: '添加分类' },
  { pal: '限时秒杀', expect: '添加秒杀商品' },
  { pal: '券墙中心', expect: '添加券' },
  { pal: '品牌宫格', expect: '添加品牌' },
  { pal: '图片热区', expect: '添加热区' },
  { pal: '视频楼层', expect: '视频地址' },
  { pal: '倒计时', expect: '截止时间' },
  { pal: '进页弹窗', expect: '进页自动弹' },
  { pal: '活动楼层', expect: '添加按钮' },
  { pal: '会员权益卡', expect: '等级标签' },
  { pal: '悬浮按钮', expect: '距底部' },
  { pal: '邀请有礼', expect: '奖励文案' },
  { pal: '拼团楼层', expect: '拼团价' },
];
const propsPanel = page.locator('.props');
for (const c of cases) {
  // 点选新加的楼层（画布最后一张）
  await page.locator('.pal-item').filter({ hasText: c.pal }).first().click();
  await page.waitForTimeout(400);
  const lastFloor = page.locator('.canvas-wrap .floor').last();
  await lastFloor.click();
  await page.waitForTimeout(400);
  const txt = await propsPanel.textContent();
  const hasField = txt.includes(c.expect);
  // 断言不是空壳：面板里至少有可编辑控件
  const inputs = await propsPanel.locator('input, textarea, .el-select, .el-switch, .el-input-number, .el-date-editor, button').count();
  ok(`面板·${c.pal}`, hasField && inputs > 3, `关键字段[${c.expect}]=${hasField} 控件数=${inputs}`);
}

console.log('--- SUMMARY:', results.filter(Boolean).length, '/', results.length, 'passed');
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
