// 站点选择/佣金结算/提现审核 端到端验证：登录 → sites/my → commission config → PATCH 等级 → PUT 规则 → withdraw summary/list
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
if (!login.ok) { console.log('登录失败:', login.message); process.exit(1); }
const auth = { Authorization: `Bearer ${login.data.token}`, 'Content-Type': 'application/json' };
const j = (r) => r.json();

// 1. 选站数据源
const my = await fetch(`${BASE}/api/admin/sites/my`, { headers: auth }).then(j);
console.log('sites/my:', my.ok ? `can_aggregate=${my.data.can_aggregate} sites=[${my.data.sites.map((s) => `${s.code}(${s.status})`).join(',')}]` : my.message);

// 2. 佣金结算配置（读）
const cfg0 = await fetch(`${BASE}/api/admin/commission/config`, { headers: auth }).then(j);
console.log('config(read):', cfg0.ok
  ? `levels=[${cfg0.data.levels.map((l) => `${l.code}:${l.ingot_price}宝/${(l.self_rate * 100).toFixed(0)}%`).join(' ')}] stats=${JSON.stringify(cfg0.data.stats)} rules=${Object.keys(cfg0.data.rules).join(',')}`
  : cfg0.message);

// 3. 编辑 L2 档位（写后读校验，再还原）
const patch = await fetch(`${BASE}/api/admin/commission/levels/L2`, {
  method: 'PATCH', headers: auth, body: JSON.stringify({ self_rate: 0.4, direct_rate: 0.1, ingot_price: 5000 }),
}).then(j);
const cfg1 = await fetch(`${BASE}/api/admin/commission/config`, { headers: auth }).then(j);
const l2 = cfg1.ok ? cfg1.data.levels.find((l) => l.code === 'L2') : null;
console.log('levels/L2 PATCH:', patch.ok, '→ 回读', l2 ? `ingot=${l2.ingot_price} self=${l2.self_rate} direct=${l2.direct_rate}` : 'FAIL');

// 4. 规则写入（withdraw_rule 白名单键）
const put = await fetch(`${BASE}/api/admin/commission/config/withdraw_rule`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ value: { min_amount: 10, fee_rate: 0, per_txn_limit: 5000 } }),
}).then(j);
console.log('config/withdraw_rule PUT:', put.ok ? 'OK' : put.message);

// 5. 提现 summary + 列表
const ws = await fetch(`${BASE}/api/admin/withdraw/summary`, { headers: auth }).then(j);
console.log('withdraw/summary:', ws.ok ? `pending=${ws.data.pending_count}/¥${ws.data.pending_amount} available=¥${ws.data.available_amount}(${ws.data.available_users}人) paid=¥${ws.data.paid_amount} rule=${JSON.stringify(ws.data.rule)}` : ws.message);
const wl = await fetch(`${BASE}/api/admin/withdraw`, { headers: auth }).then(j);
console.log('withdraw(list):', wl.ok ? `total=${wl.data.total} items=${wl.data.items.length}` : wl.message);

// 6. 非法键拒绝校验
const bad = await fetch(`${BASE}/api/admin/commission/config/hack_key`, { method: 'PUT', headers: auth, body: JSON.stringify({ value: { x: 1 } }) }).then(j);
console.log('非法键拒绝:', !bad.ok ? `OK(${bad.code ?? bad.message})` : 'FAIL: 竟然成功了');
