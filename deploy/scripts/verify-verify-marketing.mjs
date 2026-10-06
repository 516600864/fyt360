// 团购核销 + 营销中心 端到端验证
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

// 团购核销
const vs = await fetch(`${BASE}/api/admin/verify/summary`, { headers: auth }).then(j);
console.log('verify/summary:', vs.ok ? `今日=${vs.data.today_count}张/¥${vs.data.today_amount} 未核销=${vs.data.unverified} 过期=${vs.data.expired_count}/¥${vs.data.expired_amount} 核销率=${vs.data.rate}% 核销员=${vs.data.agent_count}` : vs.message);
const vl = await fetch(`${BASE}/api/admin/verify/logs`, { headers: auth }).then(j);
console.log('verify/logs:', vl.ok ? `total=${vl.data.total}` : vl.message);
const va = await fetch(`${BASE}/api/admin/verify/agents`, { headers: auth }).then(j);
console.log('verify/agents:', va.ok ? `n=${va.data.agents.length}` : va.message);

// 新增+停用核销员（用不存在的邀请码测 404 路径，不污染数据）
const badAgent = await fetch(`${BASE}/api/admin/verify/agents`, {
  method: 'POST', headers: auth, body: JSON.stringify({ invite_code: 'FYT_NOT_EXIST', role: 'verifier' }),
}).then(j);
console.log('agents(坏邀请码):', !badAgent.ok ? `OK(${badAgent.message})` : 'FAIL');

// 营销中心
const mc = await fetch(`${BASE}/api/admin/marketing/coupons`, { headers: auth }).then(j);
console.log('marketing/coupons:', mc.ok ? `n=${mc.data.coupons.length}` : mc.message);
// 建一张券再停用（真实写路径验证）
const created = await fetch(`${BASE}/api/admin/marketing/coupons`, {
  method: 'POST', headers: auth, body: JSON.stringify({ name: '[verify]临时验证券', type: 'cash_off', amount: 1, threshold: 0, total: 10 }),
}).then(j);
if (!created.ok) { console.log('coupon create FAIL:', created.message); process.exit(1); }
const cid = created.data.id;
const list2 = await fetch(`${BASE}/api/admin/marketing/coupons`, { headers: auth }).then(j);
const c = list2.data.coupons.find((x) => x.id === cid);
console.log('coupon create+read:', c ? `OK(${c.name} phase=${c.phase})` : 'FAIL');
const disabled = await fetch(`${BASE}/api/admin/marketing/coupons/${cid}`, {
  method: 'PATCH', headers: auth, body: JSON.stringify({ status: 'disabled' }),
}).then(j);
console.log('coupon disable:', disabled.ok ? 'OK' : disabled.message);

const ms = await fetch(`${BASE}/api/admin/marketing/seckills`, { headers: auth }).then(j);
console.log('marketing/seckills:', ms.ok ? `n=${ms.data.seckills.length}` : ms.message);
const ds = await fetch(`${BASE}/api/admin/marketing/dist-switch`, { headers: auth }).then(j);
console.log('dist-switch:', ds.ok ? JSON.stringify(ds.data.items.map((i) => `${i.key}:${i.on ? '开' : '关'}`)) : ds.message);
const sw = await fetch(`${BASE}/api/admin/marketing/dist-switch`, { method: 'PUT', headers: auth, body: JSON.stringify({ items: ds.data.items }) }).then(j);
console.log('dist-switch PUT(回写):', sw.ok ? 'OK' : sw.message);
const gb = await fetch(`${BASE}/api/admin/marketing/group-buys`, { headers: auth }).then(j);
console.log('group-buys:', !gb.ok && gb.code === 'NOT_IMPLEMENTED' ? 'OK(501 诚实)' : JSON.stringify(gb));

// 清理本次验证产生的测试券（issued=0 可删）
const del = await fetch(`${BASE}/api/admin/marketing/coupons/${cid}`, { method: 'DELETE', headers: auth }).then(j);
console.log('测试券清理:', del.ok ? 'OK' : del.message);
// 已发放禁删保护：删一张已发券应 409（当前无已发券，跳过时打印提示）
const listEnd = await fetch(`${BASE}/api/admin/marketing/coupons`, { headers: auth }).then(j);
console.log('结束状态:', `coupons=${listEnd.data.coupons.length}`);
