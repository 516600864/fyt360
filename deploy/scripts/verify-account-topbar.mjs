// E2E：决策#37 账户设置 + 消息中心（线上实测）
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = 'https://mk.fyt360.cn';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
});
const lj = await login.json();
console.log('登录 HTTP', login.status, lj.ok ? 'OK' : JSON.stringify(lj).slice(0, 200));
if (!lj.ok) process.exit(1);
const token = lj.data.token;
const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

// 1. GET profile
console.log('\n[1] GET /api/admin/account/profile');
const p = await (await fetch(`${BASE}/api/admin/account/profile`, { headers: H })).json();
ok(p.ok, 'profile 200');
ok(typeof p.data.username === 'string' && p.data.username.length > 0, `username=${p.data.username}`);
ok('nickname' in p.data && 'avatar' in p.data && 'email' in p.data, `三字段存在: nickname=${JSON.stringify(p.data.nickname)} avatar=${JSON.stringify(p.data.avatar)} email=${JSON.stringify(p.data.email)}`);
ok(Array.isArray(p.data.sites), `sites=[${(p.data.sites || []).map((s) => s.code).join(',')}]`);
ok(p.data.role_label === '平台管理员', `role_label=${p.data.role_label}`);

// 2. PATCH profile
console.log('\n[2] PATCH /api/admin/account/profile');
const nick = 'D先生' + Date.now().toString().slice(-5);
const u = await (await fetch(`${BASE}/api/admin/account/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ nickname: nick, email: 'd.e2e@example.com' }) })).json();
ok(u.ok && u.data.nickname === nick, `改昵称生效 → ${u.data?.nickname}`);
// 邮箱非法须 400
const bad = await fetch(`${BASE}/api/admin/account/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ email: 'not-an-email' }) });
ok(bad.status === 400, `非法邮箱被拒 HTTP ${bad.status}`);
// avatar 伪协议须 400
const bad2 = await fetch(`${BASE}/api/admin/account/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ avatar: 'javascript:alert(1)' }) });
ok(bad2.status === 400, `javascript: 头像被拒 HTTP ${bad2.status}`);
// 回读确认落库
const p2 = await (await fetch(`${BASE}/api/admin/account/profile`, { headers: H })).json();
ok(p2.data.nickname === nick && p2.data.email === 'd.e2e@example.com', `回读一致 nickname=${p2.data.nickname}`);
// 只改昵称（不含邮箱/头像）应记为非敏感 action=admin.profile_update
await (await fetch(`${BASE}/api/admin/account/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ nickname: nick }) })).json();

// 3. audit/mine
console.log('\n[3] GET /api/admin/account/audit/mine');
const a = await (await fetch(`${BASE}/api/admin/account/audit/mine?days=30&limit=100`, { headers: H })).json();
ok(a.ok, 'audit/mine 200');
ok(a.data.total >= 3, `本人在���记录 ${a.data.total} 条（profile 改+敏感改 各 1）`);
const acts = (a.data.items || []).map((x) => x.action);
ok(acts.includes('admin.profile_update'), '含 admin.profile_update');
ok(acts.includes('admin.profile_update_sensitive'), '含 admin.profile_update_sensitive（头像/邮箱敏感变更）');

// 4. notifications
console.log('\n[4] GET /api/admin/account/notifications');
const n = await (await fetch(`${BASE}/api/admin/account/notifications`, { headers: H })).json();
ok(n.ok, 'notifications 200');
ok('has_unread' in n.data, `has_unread=${n.data.has_unread}（MVP 圆点只问有无）`);
ok(n.data.total >= 2, `总条数 ${n.data.total}`);
const srcs = [...new Set((n.data.items || []).map((x) => x.source))];
ok(srcs.includes('audit'), `含审计回执源，实际源=[${srcs.join(',')}]`);
ok((n.data.items || []).some((x) => x.title.includes('个人资料')), '回执条目标题可读');
ok((n.data.items || []).every((x) => typeof x.id === 'string' && x.id.includes(':')), '每条有复合键 id（source:source_id）');

// 5. 标已读（幂等两次）
console.log('\n[5] POST /api/admin/account/notifications/read');
const first = (n.data.items || [])[0];
if (first) {
  const r1 = await (await fetch(`${BASE}/api/admin/account/notifications/read`, { method: 'POST', headers: H, body: JSON.stringify({ ids: [first.id] }) })).json();
  ok(r1.ok, `标已读 HTTP OK marked=${r1.data?.marked}`);
  const r2 = await (await fetch(`${BASE}/api/admin/account/notifications/read`, { method: 'POST', headers: H, body: JSON.stringify({ ids: [first.id] }) })).json();
  ok(r2.ok && r2.data.marked === 1, `重复标已读幂等（ON CONFLICT DO UPDATE）marked=${r2.data?.marked}`);
  const n2 = await (await fetch(`${BASE}/api/admin/account/notifications`, { headers: H })).json();
  const target = (n2.data.items || []).find((x) => x.id === first.id);
  ok(target?.read === true, `已读态回填正确 read=${target?.read}`);
} else { fail++; console.log('  ✗ 无可标记的通知'); }

// 6. 越权：audit/mine 无 operator 参数（防越权）
console.log('\n[6] 安全边界');
const inj = await (await fetch(`${BASE}/api/admin/account/audit/mine?operator=999`, { headers: H })).json();
const allMine = (inj.data.items || []).length;
const a3 = await (await fetch(`${BASE}/api/admin/account/audit/mine`, { headers: H })).json();
ok(allMine === (a3.data.items || []).length, 'operator 注入参数被忽略（始终只返回本人）');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
