// 探针：查 AI 管家最近一笔 tb 转链的真实入参（chat_message 落库证据）
import { readFileSync } from 'node:fs';
for (const line of readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const { connectDb } = await import('./lib/db.mjs');
const db = await connectDb();

const r = await db.query(`
  SELECT id, user_id, session_id, role, kind, LEFT(content, 300) AS content, meta, created_at
    FROM chat_message
   WHERE content ILIKE '%澳洲驱虫%' OR meta::text ILIKE '%澳洲驱虫%'
   ORDER BY created_at DESC LIMIT 8`);
console.log('== 澳洲驱虫相关 ==');
for (const x of r.rows) console.log(JSON.stringify(x, null, 1));

const r2 = await db.query(`
  SELECT id, user_id, role, kind, LEFT(content, 200) AS content, meta, created_at
    FROM chat_message
   WHERE meta::text ILIKE '%convert_link%' OR kind ILIKE '%convert%'
   ORDER BY created_at DESC LIMIT 8`);
console.log('\n== 最近 convert_link 类 ==');
for (const x of r2.rows) console.log(JSON.stringify(x, null, 1));

const r3 = await db.query(`
  SELECT id, user_id, role, kind, LEFT(content, 200) AS content, meta, created_at
    FROM chat_message
   WHERE content ~ '(m\\.tb\\.cn|taobao|￥|¥|MF|CZ|HU|FU)' AND role = 'user'
   ORDER BY created_at DESC LIMIT 8`);
console.log('\n== 最近用户粘贴的 tb 形态输入 ==');
for (const x of r3.rows) console.log(JSON.stringify(x, null, 1));

await db.end();
