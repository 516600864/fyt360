/**
 * 签到订阅提醒线上 E2E（决策#32）：
 * ① admin push-config 回环（PUT tmpl+map → GET 复核 → 清理回空）② C 端 subscribe accept→quota 递增 ③ reject 不涨 ④ status 带 push_tmpl
 * 用法：node deploy/scripts/verify-checkin-push.mjs
 */
import jwt from 'jsonwebtoken';
import { loadDotEnv } from './lib/common.mjs';

loadDotEnv();

const BASE = 'https://mk.fyt360.cn';
const SITE = process.env.SITE_ID ?? '07642761-7991-4357-bdc1-997462559e68';
const UID = Number(process.env.UID ?? 10);
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PW = process.env.ADMIN_INIT_PASSWORD;

if (!JWT_SECRET || !ADMIN_PW) {
  console.error('缺 JWT_SECRET / ADMIN_INIT_PASSWORD（根 .env）');
  process.exit(1);
}

const token = jwt.sign({ typ: 'user', userId: UID, siteId: SITE }, JWT_SECRET);
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
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

// ① push-config 回环
const TEST_TMPL = `E2E_TMPL_${Date.now()}`;
const TEST_MAP = JSON.stringify({ thing1: { value: '该添金啦！今日可得{n}元宝' }, number2: { value: '{n}' } });
const p1 = await fetch(`${BASE}/api/admin/checkin/push-config`, {
  method: 'PUT', headers: adminAuth,
  body: JSON.stringify({ tmpl: TEST_TMPL, map: TEST_MAP }),
}).then((r) => r.json()).catch(() => null);
ok('admin PUT push-config', p1?.ok === true && p1.data?.configured === true, JSON.stringify(p1?.data));

const g1 = await fetch(`${BASE}/api/admin/checkin`, { headers: adminAuth }).then((r) => r.json()).catch(() => null);
ok('admin GET 复核 push 回环', g1?.data?.push?.tmpl === TEST_TMPL && String(g1?.data?.push?.map ?? '').includes('thing1'));

// 非法 map 必须被拒
const bad = await fetch(`${BASE}/api/admin/checkin/push-config`, {
  method: 'PUT', headers: adminAuth,
  body: JSON.stringify({ tmpl: TEST_TMPL, map: '{not-json' }),
}).then((r) => r.status).catch(() => 0);
ok('admin PUT 非法 map 400', bad === 400, `status=${bad}`);

// ② C 端 status 带 push_tmpl
const s1 = await fetch(`${BASE}/api/me/checkin/status`, { headers: auth }).then((r) => r.json()).catch(() => null);
ok('C 端 status 下发 push_tmpl', s1?.data?.push_tmpl === TEST_TMPL, `tmpl=${s1?.data?.push_tmpl}`);

// ③ subscribe accept ×2 → quota 递增
const a1 = await fetch(`${BASE}/api/me/checkin/subscribe`, { method: 'POST', headers: auth, body: JSON.stringify({ state: 'accept' }) }).then((r) => r.json()).catch(() => null);
const a2 = await fetch(`${BASE}/api/me/checkin/subscribe`, { method: 'POST', headers: auth, body: JSON.stringify({ state: 'accept' }) }).then((r) => r.json()).catch(() => null);
ok('subscribe accept 上报', a1?.data?.accepted === true && a2?.data?.quota === Number(a1?.data?.quota ?? 0) + 1, `quota ${a1?.data?.quota}→${a2?.data?.quota}`);

// ④ reject 不涨额度
const r1 = await fetch(`${BASE}/api/me/checkin/subscribe`, { method: 'POST', headers: auth, body: JSON.stringify({ state: 'reject' }) }).then((r) => r.json()).catch(() => null);
ok('subscribe reject 不涨额度', r1?.data?.accepted === false && r1?.data?.quota === undefined, JSON.stringify(r1?.data));

// ⑤ cron 手动触发（模板为 E2E 假 ID → 发送必失败，但任务应跑通并回报告警计数）
const jt = (await import('node:crypto')).createHmac('sha256', JWT_SECRET).update('checkin-remind').digest('hex').slice(0, 32);
const c1 = await fetch(`${BASE}/api/jobs/checkin-remind/cron?token=${jt}`, { method: 'POST' }).then((r) => r.json()).catch(() => null);
ok('cron 任务可执行（假模板 → failed/skipped 报告）', c1?.ok === true && Array.isArray(c1.data?.sites), JSON.stringify(c1?.data?.sites?.[0] ?? null));

// ⑥ 清理：恢复空配置
const cl = await fetch(`${BASE}/api/admin/checkin/push-config`, {
  method: 'PUT', headers: adminAuth,
  body: JSON.stringify({ tmpl: '', map: '' }),
}).then((r) => r.json()).catch(() => null);
const g2 = await fetch(`${BASE}/api/admin/checkin`, { headers: adminAuth }).then((r) => r.json()).catch(() => null);
ok('清理恢复未配置态', cl?.ok === true && g2?.data?.push?.tmpl === '');

console.log(`\n结果：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
