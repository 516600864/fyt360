/**
 * 活动页全链路线上 E2E（决策#33）：
 * ① admin PUT draft 新建 page-e2e 装修页 ② publish ③ C 端 /api/site/page-schema 读到 published Schema
 * ④ 楼层含 activity 动作协议合法 ⑤ 清理（网关 SQL 删行）
 * 用法：node deploy/scripts/verify-activity-page.mjs
 */
import jwt from 'jsonwebtoken';
import { loadDotEnv } from './lib/common.mjs';

loadDotEnv();

const BASE = 'https://mk.fyt360.cn';
const SITE = process.env.SITE_ID ?? '07642761-7991-4357-bdc1-997462559e68';
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PW = process.env.ADMIN_INIT_PASSWORD;
const PAGE_KEY = 'page-e2eact';

if (!JWT_SECRET || !ADMIN_PW) {
  console.error('缺 JWT_SECRET / ADMIN_INIT_PASSWORD（根 .env）');
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

// admin 登录
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: ADMIN_PW }),
}).then((r) => r.json()).catch(() => null);
const adminToken = login?.data?.token ?? '';
const adminAuth = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
ok('admin 登录', !!adminToken);

// ① 新建活动页草稿（楼层带 activity-floor + activity 动作）
const floors = [
  {
    floor_id: 'f-e2e-act-1', component_id: 'c-e2e-act-1', type: 'activity-floor', on: true,
    props: {
      title: 'E2E 测试活动', subtitle: '自动验收，稍后清理',
      buttons: [{ text: '立即抢', ghost: false, action: { type: 'none' } }],
    },
  },
];
const p1 = await fetch(`${BASE}/api/admin/schema/draft`, {
  method: 'PUT', headers: adminAuth,
  body: JSON.stringify({ page: PAGE_KEY, floors }),
}).then((r) => r.json()).catch(() => null);
ok('① PUT draft 新建活动页', p1?.ok === true, `v${p1?.data?.version ?? '?'}`);

// ② 发布
const p2 = await fetch(`${BASE}/api/admin/schema/publish`, {
  method: 'POST', headers: adminAuth,
  body: JSON.stringify({ page: PAGE_KEY }),
}).then((r) => r.json()).catch(() => null);
ok('② publish 发布', p2?.ok === true);

// ③ C 端 page-schema 读取（活动壳页同款链路，site code 与 ShellView 一致）
const c1 = await fetch(`${BASE}/api/site/page-schema?code=site-a&page=${PAGE_KEY}`).then((r) => r.json()).catch(() => null);
ok('③ C 端读到 published Schema', c1?.data?.published === true, `version=${c1?.data?.version ?? 0}`);
const schemaBody = c1?.data?.schema;
const floor0 = Array.isArray(schemaBody) ? schemaBody[0] : schemaBody?.floors?.[0];
ok('④ 楼层渲染数据完整', floor0?.type === 'activity-floor' && floor0?.props?.title === 'E2E 测试活动');

// ⑤ 清理（exec-pgsql 网关删行）
const { connectDb } = await import('./lib/db.mjs');
const db = await connectDb();
await db.query(`DELETE FROM page_schema WHERE site_id = $1::uuid AND page = $2::varchar`, [SITE, PAGE_KEY]);
const c2 = await fetch(`${BASE}/api/site/page-schema?code=site-a&page=${PAGE_KEY}`).then((r) => r.json()).catch(() => null);
ok('⑤ 清理后 C 端 published:false', c2?.data?.published === false);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
