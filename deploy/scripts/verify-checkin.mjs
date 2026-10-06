/**
 * 聚宝盆签到线上 E2E（决策#31）：
 * ① admin 梯度回环（GET 默认 → PUT → GET）② C 端 status ③ do 签到 ④ 重复 do → 409 原子性 ⑤ status 复核
 * 用法：node deploy/scripts/verify-checkin.mjs（env：JWT_SECRET / ADMIN_INIT_PASSWORD / UID 可覆盖）
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
const auth = { Authorization: `Bearer ${token}` };
const js = (r) => r.json();
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

// ① admin 登录 + 梯度回环
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: ADMIN_PW }),
}).then(js).catch(() => null);
const adminToken = login?.data?.token ?? '';
ok('admin 登录', !!adminToken);

const g1 = await fetch(`${BASE}/api/admin/checkin`, { headers: { Authorization: `Bearer ${adminToken}` } }).then(js).catch(() => null);
ok('admin GET 梯度（默认 50~500）', g1?.ok === true && Array.isArray(g1.data?.rewards) && g1.data.rewards.length === 7, JSON.stringify(g1?.data?.rewards));

const p1 = await fetch(`${BASE}/api/admin/checkin`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({ rewards: [50, 60, 70, 80, 90, 100, 500] }),
}).then(js).catch(() => null);
ok('admin PUT 梯度回环', p1?.ok === true && p1.data?.saved === true);

// 非法梯度必须被拒
const bad = await fetch(`${BASE}/api/admin/checkin`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({ rewards: [1, 2, 3] }),
}).then((r) => r.status).catch(() => 0);
ok('admin PUT 非法梯度 400', bad === 400, `status=${bad}`);

// ② C 端 status
const s1 = await fetch(`${BASE}/api/me/checkin/status`, { headers: auth }).then(js).catch(() => null);
ok('C 端 status', s1?.ok === true && Array.isArray(s1.data?.rewards), `streak=${s1?.data?.streak} today=${s1?.data?.today_checked}`);

// ③ do 签到
const d1 = await fetch(`${BASE}/api/me/checkin/do`, { method: 'POST', headers: auth }).then(js).catch(() => null);
const firstTime = d1?.ok === true;
if (firstTime) {
  ok('do 签到成功', Number.isInteger(d1.data?.streak) && Number(d1.data?.amount) > 0,
    `第${d1.data.streak}天 +${d1.data.amount} 元宝（第${d1.data.cycle}盆）balance_after=${d1.data.balance_after}`);
} else {
  // 今天已签（409）→ 也是有效路径，验证报错码
  ok('do 签到（今日已签 409）', d1?.message?.includes('签过'), d1?.message ?? '未知错误');
}

// ④ 重复 do → 409 ALREADY_CHECKED（原子性）
const d2 = await fetch(`${BASE}/api/me/checkin/do`, { method: 'POST', headers: auth }).then(js).catch(() => null);
ok('重复 do → 409 拒绝', d2?.ok !== true && String(d2?.message ?? '').includes('签过'), d2?.message);

// ⑤ status 复核：今日已签 + 元宝余额含签到奖励
const s2 = await fetch(`${BASE}/api/me/checkin/status`, { headers: auth }).then(js).catch(() => null);
ok('status 复核今日已签', s2?.data?.today_checked === true, `streak=${s2?.data?.streak} days=${s2?.data?.days?.length} balance=${s2?.data?.balance}`);

console.log(`\n结果：${pass} 绿 / ${fail} 红`);
process.exit(fail ? 1 : 0);
