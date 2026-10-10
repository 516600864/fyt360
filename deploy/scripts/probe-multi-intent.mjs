/**
 * 探针：L2 多意图协议（2026-10-10 方案 A，D先生 拍板）
 * 真调 hy3 验证复合句拆解：「肚子饿了，打个车去吃个麦当劳」→ 打车卡片 + 麦当劳卡片连发。
 * 对照组：单意图句（回归）+ 旧格式兼容。
 * 用法：node --env-file=.env deploy/scripts/probe-multi-intent.mjs
 */
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const BASE = 'https://mk.fyt360.cn';

async function db(sql, p = []) {
  for (let a = 1; a <= 4; a++) {
    const j = await fetch(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
      body: JSON.stringify({ sql, parameters: p, role: 'cloudbase_postgres' }),
    }).then((r) => r.json());
    if (Array.isArray(j)) return j;
    if (a < 4) await new Promise((r) => setTimeout(r, 400 * a));
  }
  throw new Error('网关重试失败');
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function signUserToken(userId, siteId) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ userId, siteId, typ: 'user', iat: now, exp: now + 86400 });
  const sig = createHmac('sha256', env.JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function sse(path, token, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/event-stream')) {
    const j = await res.json().catch(() => ({}));
    return { status: res.status, events: [], json: j };
  }
  const text = await res.text();
  const events = [];
  for (const block of text.split('\n\n')) {
    let ev = 'message', data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (data) { try { events.push({ ev, j: JSON.parse(data) }); } catch { /* skip */ } }
  }
  return { status: res.status, events };
}

const sites = await db(`SELECT site_id::text AS id, code FROM site WHERE status='active' AND code='site-a' LIMIT 1`);
const SITE = sites[0].id;
const users = await db(`SELECT user_id::text AS id FROM "user" WHERE site_id::text IN ($1) ORDER BY user_id LIMIT 1`, [SITE]);
const USER_ID = Number(users[0].id);
const TOKEN = signUserToken(USER_ID, SITE);
console.log(`站点=${sites[0].code} 用户=${USER_ID}\n`);

// 退场兜底
await db(`DELETE FROM chat_message WHERE user_id::text IN ($1) AND site_id::text IN ($2)`, [String(USER_ID), SITE]);

const cases = [
  { label: '① 复合句（本次修复目标）', msg: '肚子饿了，打个车去吃个麦当劳', expect: ['intent(goto_service 打车)', 'intent(goto_service 麦当劳)'] },
  { label: '② 单意图回归', msg: '我想打个车', expect: ['intent(goto_service)'] },
  { label: '③ 闲聊回归', msg: '你好呀', expect: ['chit_chat'] },
];

for (const c of cases) {
  console.log(`── ${c.label}：「${c.msg}」`);
  const { status, events } = await sse('/api/chat/sse', TOKEN, { message: c.msg });
  if (status !== 200) { console.log(`   ✗ HTTP ${status}: ${JSON.stringify(events).slice(0, 200)}`); continue; }
  const kinds = [];
  for (const e of events) {
    if (e.ev === 'intent') kinds.push(`intent(${e.j.tool}${e.j.name ? ' ' + e.j.name : ''}${e.j.keyword ? ' ' + e.j.keyword : ''})`);
    else if (e.ev === 'card') kinds.push(`card(${e.j.kind}${e.j.kind === 'service_card' && e.j.service?.name ? ' ' + e.j.service.name : ''})`);
    else if (e.ev === 'text_delta') kinds.push(`text("${String(e.j.t ?? '').slice(0, 40)}")`);
    else if (e.ev === 'error') kinds.push(`ERROR(${e.j.code})`);
  }
  console.log('   事件流:', kinds.join(' → '));
  const intents = kinds.filter((k) => k.startsWith('intent(goto_service'));
  const cards = kinds.filter((k) => k.startsWith('card(service_card'));
  if (c.label.startsWith('①')) {
    // 打车类命中聚合轨吐 service_list（组卡）、直连品牌吐 service_card——两者都算服务卡
    const svcCards = kinds.filter((k) => k.startsWith('card(service_list') || k.startsWith('card(service_card'));
    console.log(intents.length >= 2 && svcCards.length >= 2 ? '   ✅ 复合句拆出 ≥2 意图、≥2 张服务卡' : '   ⚠️ 未拆出多意图，看上面事件流定责');
  }
  console.log('');
}

// 落库检查：本轮应有多条 assistant 行
const rows = await db(`SELECT kind, content, created_at::text FROM chat_message WHERE user_id::text IN ($1) AND site_id::text IN ($2) AND role='assistant' ORDER BY id DESC LIMIT 6`, [String(USER_ID), SITE]);
console.log('落库 assistant 行（最新在前）:');
for (const r of rows) console.log('  ', r.kind, '|', String(r.content).slice(0, 40));

// 退场
await db(`DELETE FROM chat_message WHERE user_id::text IN ($1) AND site_id::text IN ($2)`, [String(USER_ID), SITE]);
console.log('\n退场清零完成');
