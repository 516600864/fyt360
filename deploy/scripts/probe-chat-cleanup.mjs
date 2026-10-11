import fs from 'node:fs';
import { connectDb } from './lib/db.mjs';
for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}
const db = await connectDb();
const r = await db.query(`
  SELECT id, site_id, session_id, role, kind, LEFT(content, 40) AS c, created_at
    FROM chat_message WHERE user_id = 25 ORDER BY id DESC LIMIT 8`);
for (const row of r.rows) console.log(`#${row.id} | ${row.session_id} | ${row.role}/${row.kind} | ${row.c} | ${row.created_at}`);
// 清探针残留（session 前缀 probe-keyfix-）
const del = await db.query(`DELETE FROM chat_message WHERE user_id = 25 AND session_id LIKE 'probe-keyfix-%' RETURNING id`);
console.log(`cleaned: ${del.rows.length}`);
await db.end();
