/**
 * admin-50 系统设置扩展验证：roles / admins CRUD / audit / 权限隔离（依赖 verify-settings-admin.mjs 的公共逻辑）
 * 用法：node verify-settings-50.mjs
 */
import jwt from 'jsonwebtoken';
import { connectDb } from './lib/db.mjs';
import { loadDotEnv } from './lib/common.mjs';

loadDotEnv();
const BASE = 'https://mk.fyt360.cn/api';
const db = await connectDb();
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? `  ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

await new Promise((r) => setTimeout(r, 3000));

// 真实超管登录
const lg = await fetch(BASE + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INIT_PASSWORD }),
});
const lgj = await lg.json();
ok(lg.status === 200 && lgj.ok, '超管登录');
const sH = { Authorization: `Bearer ${lgj.data.token}`, 'Content-Type': 'application/json' };
const callS = async (method, path, body) => {
  const rr = await fetch(BASE + path, { method, headers: sH, body: body ? JSON.stringify(body) : undefined });
  return { status: rr.status, j: await rr.json().catch(() => ({})) };
};

let r = await callS('GET', '/admin/settings/roles');
ok(r.status === 200 && r.j.data.roles.length === 3, 'GET roles 3 内置角色', r.j.data?.roles?.map((x) => x.role_code).join('/'));

r = await callS('GET', '/admin/settings/admins');
ok(r.status === 200 && r.j.data.admins.length >= 1, 'GET admins 列表', `n=${r.j.data?.admins?.length}`);

// overview：凭据卡含 updated_at 掩码字段
r = await callS('GET', '/admin/settings/overview');
const p0 = Object.values(r.j.data.sites[0].providers)[0];
ok(r.status === 200 && 'updated_at' in p0 && 'key_masked' in p0, 'overview 凭据卡字段齐（updated_at/掩码）');

// 新建只读账号（绑站点）
const ts = `vbot${Date.now() % 100000}`;
const ov = await callS('GET', '/admin/settings/overview');
const siteId = ov.j.data.sites[0].site_id;
r = await callS('POST', '/admin/settings/admins', { username: ts, password: 'initpwd12345', role: 'readonly_ops', site_ids: [siteId] });
ok(r.status === 200 && r.j.ok, 'POST admins 新建只读账号', ts);
const newId = r.j.data?.admin_id;

// 新账号登录 → 访问系统设置须 403 PLATFORM_ONLY
const lg2 = await fetch(BASE + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: ts, password: 'initpwd12345' }),
});
const lg2j = await lg2.json();
ok(lg2.status === 200 && lg2j.ok, '新账号可登录');
const rr3 = await fetch(BASE + '/admin/settings/overview', { headers: { Authorization: `Bearer ${lg2j.data.token}` } });
ok(rr3.status === 403, '只读账号访问系统设置 → 403 PLATFORM_ONLY');

// 防锁死：超管改自己角色 → 400
const selfId = String(lgj.data.admin.adminId);
r = await callS('PUT', `/admin/settings/admins/${selfId}`, { role: 'readonly_ops' });
ok(r.status === 400 && r.j.code === 'SELF_LOCKOUT', '改自己角色 → 400 SELF_LOCKOUT');

// 停用新账号 → 登录须 401
r = await callS('PUT', `/admin/settings/admins/${newId}`, { status: 'disabled' });
ok(r.status === 200, '停用新账号');
const lg3 = await fetch(BASE + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: ts, password: 'initpwd12345' }),
});
ok(lg3.status === 401, '停用后登录 → 401');

// 审计：应含 create/login/provider.save 记录
r = await callS('GET', '/admin/settings/audit?limit=50');
const actions = (r.j.data?.items ?? []).map((x) => x.action);
ok(r.status === 200 && actions.includes('admin.create'), '审计含 admin.create', `n=${actions.length}`);
ok(actions.includes('admin.login'), '审计含 admin.login（登录埋点）');
ok(actions.includes('provider.save'), '审计含 provider.save（凭据埋点）');

// 模块过滤
r = await callS('GET', '/admin/settings/audit?module=provider&days=7');
ok(r.status === 200 && (r.j.data.items ?? []).every((x) => x.target_type === 'provider'), '审计模块过滤 provider');

// 清理测试账号
await db.query(`DELETE FROM admin_user_site WHERE admin_id::text = $1::text`, [newId]);
await db.query(`DELETE FROM admin_user WHERE admin_id::text = $1::text`, [newId]);
ok(true, '清理测试账号还原现场');

console.log(`\n结果：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
