// 端到端验证：商品与品牌 / 分销 / AI 三屏接口（读 .env 登录，不在命令行明文）
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = 'https://mk.fyt360.cn';

const lr = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
}).then((r) => r.json());
if (!lr.ok) { console.error('登录失败:', lr.message); process.exit(1); }
const auth = { Authorization: `Bearer ${lr.data.token}` };

const get = async (p) => (await fetch(`${BASE}/api${p}`, { headers: auth })).json();
const post = async (p, body) => (await fetch(`${BASE}/api${p}`, {
  method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})).json();

/* 1. 自营商品 */
const g = await get('/admin/self-goods?size=10');
console.log('self-goods:', g.ok ? `ok tabs=${JSON.stringify(g.data.tabs)} items=${g.data.items.length} 首条=${g.data.items[0] ? JSON.stringify({ t: g.data.items[0].title.slice(0, 12), price: g.data.items[0].price, stock: g.data.items[0].stock, st: g.data.items[0].status }) : '空'}` : `FAIL ${g.message}`);

/* 2. 品牌三轨 */
const b = await get('/admin/brands');
console.log('brands:', b.ok ? `ok items=${b.data.items.length} 首条=${b.data.items[0] ? JSON.stringify({ n: b.data.items[0].name, act: b.data.items[0].action_type, on: b.data.items[0].enabled }) : '空'}` : `FAIL ${b.message}`);

/* 3. 分销 summary + roots + tree */
const ds = await get('/admin/distribution/summary');
console.log('dist/summary:', ds.ok ? JSON.stringify(ds.data) : `FAIL ${ds.message}`);
const dr = await get('/admin/distribution/roots');
console.log('dist/roots:', dr.ok ? `ok items=${dr.data.items.length} 首=${dr.data.items[0] ? JSON.stringify({ id: dr.data.items[0].user_id, team: dr.data.items[0].team }) : '空'}` : `FAIL ${dr.message}`);
if (dr.ok && dr.data.items.length) {
  const dt = await get(`/admin/distribution/tree?user_id=${dr.data.items[0].user_id}`);
  console.log('dist/tree:', dt.ok ? `ok root=${dt.data.root.user_id} items=${dt.data.items.length} 首行=${dt.data.items[0] ? JSON.stringify({ hop: dt.data.items[0].hop, lv: dt.data.items[0].level_code, comm: dt.data.items[0].commission }) : '无下级'}` : `FAIL ${dt.message}`);
}

/* 4. AI overview + generate 501 */
const ai = await get('/admin/ai/overview');
console.log('ai/overview:', ai.ok ? `ok pages=${ai.data.pages.map((p) => `${p.page}v${p.version}(${p.floors.length}层)`).join(',')} logs=${ai.data.logs.length} agent_ready=${ai.data.agent_ready}` : `FAIL ${ai.message}`);
const gen = await post('/admin/ai/generate', { prompt: '测试' });
console.log('ai/generate:', gen.ok === false && /尚未接入/.test(gen.message ?? '') ? `501 如实提示 ✓ (${gen.message.slice(0, 30)}…)` : JSON.stringify(gen).slice(0, 120));
