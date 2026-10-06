// E2E：真实浏览器验证 h5 渲染 + admin 登录流程（mk.fyt360.cn 全链路）
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/D先生/AppData/Roaming/npm/node_modules/');
const { chromium } = require('playwright');

const env = readFileSync('.env', 'utf8');
const pwd = (env.match(/^ADMIN_INIT_PASSWORD=(.*)$/m) || [])[1];

// 定位 chromium-1155 可执行文件
const bpRoot = process.env.LOCALAPPDATA + '\\ms-playwright';
const candidates = [
  bpRoot + '\\chromium-1155\\chrome-win64\\chrome.exe',
  bpRoot + '\\chromium-1155\\chrome-win\\chrome.exe',
];
const exe = candidates.find((p) => existsSync(p));
if (!exe) throw new Error('chromium not found');

const browser = await chromium.launch({ executablePath: exe, headless: true });

// ① H5
const h5 = await browser.newPage({ viewport: { width: 390, height: 844 } });
const h5Errors = [];
h5.on('pageerror', (e) => h5Errors.push(String(e)));
h5.on('console', (m) => { if (m.type() === 'error') h5Errors.push(m.text()); });
await h5.goto('https://mk.fyt360.cn/h5/', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
await h5.waitForTimeout(1500);
await h5.screenshot({ path: 'C:/Temp/fyt360/e2e-h5.png' });
const h5Text = (await h5.content()).slice(0, 200);
console.log('[h5] title=', await h5.title(), '| console errors:', h5Errors.length ? h5Errors.slice(0, 3) : 'none');

// ② Admin 登录全流程
const admin = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const adminErrors = [];
admin.on('pageerror', (e) => adminErrors.push(String(e)));
await admin.goto('https://mk.fyt360.cn/admin/', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
await admin.waitForTimeout(800);
await admin.screenshot({ path: 'C:/Temp/fyt360/e2e-admin-login.png' });
await admin.getByPlaceholder('用户名').fill('admin');
await admin.getByPlaceholder('密码').fill(pwd);
await admin.getByRole('button', { name: /登\s*录/ }).click();
await admin.waitForTimeout(2500);
await admin.screenshot({ path: 'C:/Temp/fyt360/e2e-admin-after.png' });
const url = admin.url();
const token = await admin.evaluate(() => localStorage.getItem('fyt_admin_token'));
console.log('[admin] after-login url=', url, '| token set=', !!token, '| pageerrors:', adminErrors.length ? adminErrors.slice(0, 3) : 'none');

await browser.close();
console.log('[done] screenshots: e2e-h5.png / e2e-admin-login.png / e2e-admin-after.png');
