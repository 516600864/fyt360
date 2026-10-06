// 订单中心端到端验证：读 .env 凭据 → 登录 → 调 /api/admin/orders 各 tab → 打印计数与首行
// 只输出业务数据，不输出任何密钥
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const BASE = 'https://mk.fyt360.cn';
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
}).then((r) => r.json());

if (!login.ok) {
  console.log('登录失败:', login.message, login.code ?? '');
  process.exit(1);
}
const token = login.data.token;
const auth = { Authorization: `Bearer ${token}` };

const get = async (p) => (await fetch(`${BASE}${p}`, { headers: auth })).json();

const sites = await get('/api/admin/orders/sites');
console.log('sites:', sites.ok ? sites.data.sites.map((s) => s.code).join(',') : sites.message);

for (const tab of ['all', 'self', 'cps', 'ingot', 'after']) {
  const j = await get(`/api/admin/orders?tab=${tab}&page=1&size=3`);
  if (!j.ok) {
    console.log(`${tab}: ERROR`, j.message);
    continue;
  }
  const t = j.data.tabs;
  console.log(`${tab}: tabs{all=${t.all}, self=${t.self}, cps=${t.cps}, ingot=${t.ingot}, after=${t.after}} rows=${j.data.items.length}`);
  if (j.data.items[0]) {
    const o = j.data.items[0];
    console.log('  首行:', JSON.stringify({
      sn: o.order_sn, type: o.type, site: o.site_code, goods: String(o.goods_title).slice(0, 18),
      pay: o.pay_price, buyer: o.buyer, status: o.status, commission: o.commission,
    }));
  }
}

// CSV 导出头几行
const exp = await fetch(`${BASE}/api/admin/orders/export?tab=all`, { headers: auth });
const csv = await exp.text();
console.log('export:', exp.status, 'csv lines =', csv.split('\n').length, '| 表头:', csv.split('\n')[0]);
