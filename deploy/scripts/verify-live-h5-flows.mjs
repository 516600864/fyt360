// H5 线上 E2E：②搜索框点击 ③（admin 预览另测）④CPS 商品点击进详情页
import { chromium } from 'playwright-core';

const EXE = 'C:/Users/ducun/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe';
const BASE = 'https://mk.fyt360.cn/h5/';

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.err]', m.text().slice(0, 120)); });

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2500);

// ② 搜索条：搜索框点击 → 应 toast 搜索请使用小程序（H5 无搜索页），且不应跳权益页
const beforeUrl = page.url();
const searchBox = page.locator('.search-box').first();
if (await searchBox.count()) {
  await searchBox.click();
  await page.waitForTimeout(1200);
  const toast = await page.locator('uni-toast, .uni-toast, .uni-sample-toast').allTextContents().catch(() => []);
  const t = toast.join(' ');
  const navigated = page.url() !== beforeUrl;
  ok('②搜索框点击', !navigated && /搜索|小程序/.test(t), `toast="${t.slice(0, 40)}" navigated=${navigated} url=${page.url().slice(0, 80)}`);
} else {
  ok('②搜索框点击', false, '页面无 .search-box');
}

// ④ goods-feed 第一张商品卡点击 → 应进 /pages/goods/detail
// 先记录跳转前 URL，找到 feed 卡片（pv-gcard 是 admin 预览类；端内为 f-goods-feed 的卡片）
// 端内卡片结构探测：含价格 ¥ 的可点击卡片
const backTo = () => page.goto(BASE, { waitUntil: 'networkidle' });

// 若上面发生了导航先回首页
if (page.url() !== beforeUrl) { await backTo(); await page.waitForTimeout(2000); }

// 找商品卡：f-goods-feed 渲染的卡片（class 含 goods/gcard/feed）
const cardSel = ['.gf-card', '.feed-card', '.goods-card', '.pv-gcard', '[class*="goods"] [class*="card"]'];
let clicked = false;
for (const sel of cardSel) {
  const c = page.locator(sel).first();
  if (await c.count()) {
    console.log('[probe] using card selector:', sel);
    await c.click();
    clicked = true;
    break;
  }
}
if (!clicked) {
  // 兜底：点所有含“¥”文本的 view 里最后一个 feed 区
  const cards = page.locator('text=/¥/');
  const n = await cards.count();
  console.log('[probe] ¥ nodes:', n);
  if (n > 0) { await cards.nth(Math.min(2, n - 1)).click(); clicked = true; }
}
await page.waitForTimeout(2500);
const u = page.url();
const onDetail = /pages\/goods\/detail/.test(u);
if (onDetail) {
  const priceTxt = await page.locator('.pc-num').first().textContent().catch(() => '');
  const titleTxt = await page.locator('.pc-title').first().textContent().catch(() => '');
  ok('④CPS点击进详情', true, `url含detail 价格=${priceTxt} 标题=${(titleTxt ?? '').slice(0, 16)}`);
  // 详情页「领券购买」按钮存在性
  const buy = await page.locator('.buy-btn').count();
  ok('④详情页购买按钮', buy > 0, `buy-btn=${buy}`);
} else {
  ok('④CPS点击进详情', false, `仍停留 ${u.slice(0, 90)}`);
}

console.log('--- SUMMARY:', results.filter(r => r.pass).length, '/', results.length, 'passed');
await browser.close();
process.exit(results.every(r => r.pass) ? 0 : 1);
