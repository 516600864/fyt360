/**
 * 验证系统设置面（admin-settings + auth/admin/password + site/provider 留空保留语义）：
 * 1. GET overview（凭据矩阵掩码）→ 2. POST site/provider 新建伪凭据 → 3. 留空编辑（apikey/secret 保留 + status disabled）→
 * 4. 改密端点拒绝路径（短密码/旧密错）→ 5. 真实改密 + 还原 → 6. DELETE provider_config 还原现场
 * 用法：node verify-settings-admin.mjs
 */
import jwt from 'jsonwebtoken';
import { connectDb } from './lib/db.mjs';
import { loadDotEnv } from './lib/common.mjs';

loadDotEnv();
const BASE = 'https://mk.fyt360.cn/api';
const SITE = process.env.PAY_TEST_SITE_ID ?? '07642761-7991-4357-bdc1-997462559e68';

const token = jwt.sign(
  { adminId: '00000000-0000-0000-0000-000000000000', username: 'verify-bot', role: 'platform_admin', siteIds: [] },
  process.env.JWT_SECRET, { expiresIn: '1h' },
);
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = await connectDb();
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? `  ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

await sleep(5000);

// 记录现有真实凭据（还原用）
const { rows: saved } = await db.query(
  `SELECT provider, apikey, api_secret FROM provider_config WHERE site_id = $1::uuid AND provider = 'mayixingqiu'`,
  [SITE],
);

// 1. overview
let r = await call('GET', '/admin/settings/overview');
ok(r.status === 200 && Array.isArray(r.j.data?.sites), 'GET overview 200', `sites=${r.j.data?.sites?.length}`);
ok(!JSON.stringify(r.j).match(/[0-9a-f]{20,}/i), '响应无凭据原文（掩码）');

// 2. 新建伪凭据
r = await call('POST', '/site/provider', { site_id: SITE, provider: 'mayixingqiu', apikey: 'testkey1234567890abcdef', api_secret: 'topsecret999' });
ok(r.status === 200 && r.j.ok, 'POST site/provider 新建');

// 3. 留空编辑：只改 status → apikey/secret 应保留
r = await call('POST', '/site/provider', { site_id: SITE, provider: 'mayixingqiu', apikey: '', status: 'disabled' });
ok(r.status === 200 && r.j.ok, '留空 apikey 编辑 200');
const { rows: after } = await db.query(
  `SELECT apikey, api_secret, status FROM provider_config WHERE site_id = $1::uuid AND provider = 'mayixingqiu'`,
  [SITE],
);
ok(after[0]?.apikey === 'testkey1234567890abcdef', '留空 apikey=保留原值', after[0]?.apikey);
ok(after[0]?.api_secret === 'topsecret999', '未传 secret=保留原值');
ok(after[0]?.status === 'disabled', 'status=disabled 生效', after[0]?.status);

// 4. 改密拒绝路径 + 真实闭环（须真实登录 token：adminId 必须命中 admin_user）
r = await call('POST', '/auth/login', { username: process.env.VERIFY_ADMIN_USER ?? 'admin', password: process.env.VERIFY_ADMIN_PWD ?? process.env.ADMIN_INIT_PASSWORD ?? '' });
ok(r.status === 200 && r.j.ok, '真实管理员登录');
const realToken = r.j.data?.token ?? '';
const realH = { Authorization: `Bearer ${realToken}`, 'Content-Type': 'application/json' };
const callAuth = async (body) => {
  const rr = await fetch(BASE + '/auth/admin/password', { method: 'POST', headers: realH, body: JSON.stringify(body) });
  return { status: rr.status, j: await rr.json().catch(() => ({})) };
};
r = await callAuth({ old_password: 'x', new_password: 'short' });
ok(r.status === 400 && r.j.code === 'BAD_PASSWORD', '短密码 → 400 BAD_PASSWORD');
r = await callAuth({ old_password: 'definitely-wrong', new_password: 'newpass12345' });
ok(r.status === 400 && r.j.code === 'WRONG_OLD_PASSWORD', '旧密错 → 400 WRONG_OLD_PASSWORD', r.j.message);

const REAL_PWD = process.env.VERIFY_ADMIN_PWD ?? process.env.ADMIN_INIT_PASSWORD;
if (REAL_PWD) {
  const r2 = await callAuth({ old_password: REAL_PWD, new_password: 'tmppwd12345' });
  ok(r2.status === 200 && r2.j.ok, '真实改密成功');
  const r3 = await call('POST', '/auth/login', { username: process.env.VERIFY_ADMIN_USER ?? 'admin', password: 'tmppwd12345' });
  ok(r3.status === 200 && r3.j.ok, '新密可登录');
  const r4 = await callAuth({ old_password: 'tmppwd12345', new_password: REAL_PWD });
  ok(r4.status === 200 && r4.j.ok, '还原原密码');
  const r5 = await call('POST', '/auth/login', { username: process.env.VERIFY_ADMIN_USER ?? 'admin', password: REAL_PWD });
  ok(r5.status === 200 && r5.j.ok, '原密恢复可登录');
} else {
  console.log('⚠️ 跳过真实改密闭环（VERIFY_ADMIN_USER/VERIFY_ADMIN_PWD 未配置）');
}

// 6. 还原 provider_config 现场
if (saved[0]) {
  await db.query(
    `UPDATE provider_config SET apikey = $2, api_secret = $3, status = 'active' WHERE site_id = $1::uuid AND provider = 'mayixingqiu'`,
    [SITE, saved[0].apikey, saved[0].api_secret],
  );
} else {
  await db.query(`DELETE FROM provider_config WHERE site_id = $1::uuid AND provider = 'mayixingqiu'`, [SITE]);
}
ok(true, '清理还原 provider_config 现场');

console.log(`\n结果：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
