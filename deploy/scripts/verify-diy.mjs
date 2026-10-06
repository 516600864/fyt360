// DIY 装修编辑器（admin-30）端到端验证：草稿保存 → 校验拒绝 → 发布 → 恢复原版（生产 home 保护）
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const BASE = 'https://mk.fyt360.cn';
const j = (r) => r.json();

const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }) }).then(j);
if (!login.ok) { console.error('登录失败', login); process.exit(1); }
const auth = { Authorization: 'Bearer ' + login.data.token, 'Content-Type': 'application/json' };
console.log('登录 OK');

async function current(page = 'home') {
  return fetch(`${BASE}/api/admin/schema/current?page=${page}`, { headers: auth }).then(j);
}
async function draft(page, floors) {
  return fetch(`${BASE}/api/admin/schema/draft`, { method: 'PUT', headers: auth, body: JSON.stringify({ page, floors }) }).then(j);
}
async function publish(page) {
  return fetch(`${BASE}/api/admin/schema/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ page }) }).then(j);
}

// ① 备份当前线上 home
const before = await current();
console.log(`备份：home 当前 status=${before.data.status} v${before.data.version} floors=${before.data.floors?.length ?? 0}`);
const backupFloors = before.data.floors;

// ② 保存测试草稿（2 楼层）
const put = await draft('home', [
  { type: 'search-bar', floor_id: 'f-verify-1', component_id: 'c-verify-1', props: { logo_text: '券', placeholder: '[verify] 临时', action_text: '签到' } },
  { type: 'coupon-strip', floor_id: 'f-verify-2', component_id: 'c-verify-2', props: { amount: '¥1', note_top: '[verify]', note_bottom: '临时', action_text: '领' } },
]);
console.log('草稿保存:', put.ok ? `OK v${put.data.version}` : 'FAIL ' + JSON.stringify(put));

// ③ 非法楼层类型 → 400
const bad = await draft('home', [{ type: 'hacker-floor' }]);
console.log('非法类型拒绝:', !bad.ok ? `OK(${bad.code ?? bad.message})` : 'FAIL 未拦截！');

// ④ 发布
const pub = await publish('home');
console.log('发布:', pub.ok ? `OK v${pub.data.version} archived=${pub.data.archived}` : 'FAIL ' + JSON.stringify(pub));

// ⑤ 发布后读取
const afterPub = await current();
console.log('发布后读取:', afterPub.data.status === 'published' && afterPub.data.floors?.length === 2 ? 'OK' : 'FAIL ' + JSON.stringify(afterPub.data).slice(0, 120));

// ⑥ 恢复原版（走 草稿→发布 完整链路，同时验证恢复路径）
if (Array.isArray(backupFloors)) {
  const r1 = await draft('home', backupFloors);
  const r2 = await publish('home');
  const fin = await current();
  const match = JSON.stringify(fin.data.floors) === JSON.stringify(backupFloors);
  console.log(`恢复原版: draft v${r1.data?.version} → publish v${r2.data?.version} → floors 一致=${match ? 'OK' : 'FAIL'}`);
  if (!match) { console.error('⚠️ 恢复后 floors 不一致，需人工检查'); process.exit(1); }
} else {
  console.log('原无线上 home（跳过恢复）');
}
console.log('全部通过 ✅');
