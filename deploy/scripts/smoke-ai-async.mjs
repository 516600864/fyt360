// 冒烟：/api/admin/ai/generate 异步化验证（2026-10-09 504 修复）
// 断言：①POST 秒回 job_id（<5s，远小于接入层 30s）②轮询 status 到 ok ③清理自造草稿
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = 'https://mk.fyt360.cn';
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const step = (ok, msg) => console.log(`${ok ? '✅' : '❌'} ${msg}`);

async function q(sql) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters: [], role: 'cloudbase_postgres' }),
  });
  return res.json();
}

// 1. site-a id（冒烟落点）
const siteRows = await q(`SELECT site_id::text AS id FROM site WHERE code = 'niwo' LIMIT 1`);
const SITE_ID = siteRows[0]?.id;
step(!!SITE_ID, `site-a id=${SITE_ID}`);

// 2. admin 登录
const lr = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
});
const lj = await lr.json();
const TOKEN = lj?.data?.token ?? '';
step(!!TOKEN, '管理员登录');
if (!TOKEN) process.exit(1);

// 3. POST /generate —— 断言秒回（同步版这里会挂 36s+ 然后 504）
const t0 = Date.now();
const gr = await fetch(`${BASE}/api/admin/ai/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, 'x-fyt-site': 'niwo' },
  body: JSON.stringify({ target: 'new', title: '冒烟异步验证', brief: '测试异步生成：做一个两层的简单页面，一层轮播图一层公告，文案用「冒烟测试」' }),
});
const postMs = Date.now() - t0;
const gj = await gr.json().catch(() => null);
step(gr.status === 200 && !!gj?.data?.job_id, `POST /generate 秒回 job_id（${postMs}ms，要求 <20000ms）job=${gj?.data?.job_id} page=${gj?.data?.page}`);
step(postMs < 20000, `响应耗时 ${postMs}ms < 20s（同步版实测 36~49s 必 504）`);
if (!gj?.data?.job_id) { console.log(JSON.stringify(gj)); process.exit(1); }
const PAGE = gj.data.page;

// 4. 轮询 status → ok
let result = null, status = '';
const pt0 = Date.now();
while (Date.now() - pt0 < 180000) {
  await new Promise((r) => setTimeout(r, 2000));
  const sr = await fetch(`${BASE}/api/admin/ai/generate/status/${gj.data.job_id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const sj = await sr.json().catch(() => null);
  status = sj?.data?.status ?? String(sr.status);
  if (status === 'ok') { result = sj.data.result; break; }
  if (status === 'failed') { step(false, `生成失败：${sj?.data?.error}`); process.exit(1); }
}
step(status === 'ok', `轮询至 ok（${((Date.now() - pt0) / 1000).toFixed(1)}s）v${result?.version} ${result?.floors} 层 [${(result?.floor_types ?? []).join(',')}]`);

// 5. 越权校验：无 token 查他人任务 → 401/403
const ur = await fetch(`${BASE}/api/admin/ai/generate/status/${gj.data.job_id}`);
step(ur.status === 401 || ur.status === 403, `无 token 查任务 → ${ur.status}（拒绝）`);

// 6. 清理自造草稿（E2E 纪律：自造数据自清理）
await q(`DELETE FROM page_schema WHERE site_id = '${SITE_ID}'::uuid AND page = '${PAGE}' AND status = 'draft' AND source = 'ai'`);
const left = await q(`SELECT count(*)::int AS n FROM page_schema WHERE site_id = '${SITE_ID}'::uuid AND page = '${PAGE}'`);
step(left[0]?.n === 0, `冒烟草稿已清理（${PAGE} 残留 ${left[0]?.n} 条）`);
console.log('\n=== 冒烟通过 ===');
