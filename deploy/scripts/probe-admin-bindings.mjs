// 探针3：站点 name 对照 + admin 账号绑定关系
import { readFileSync } from 'node:fs';
for (const line of readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const { connectDb } = await import('./lib/db.mjs');
const db = await connectDb();

const sites = await db.query(`SELECT code, name, status FROM site ORDER BY created_at`);
console.log('== sites ==');
for (const s of sites.rows) console.log(s.code, '|', s.name, '|', s.status);

const admins = await db.query(`
  SELECT a.admin_id::text AS id, a.username, a.role, a.status,
         COALESCE(string_agg(s.code || '(owner=' || us.is_owner::text || ')', ', '), '') AS bindings
    FROM admin_user a
    LEFT JOIN admin_user_site us ON us.admin_id = a.admin_id
    LEFT JOIN site s ON s.site_id = us.site_id
   GROUP BY a.admin_id, a.username, a.role, a.status
   ORDER BY a.admin_id`);
console.log('\n== admin 账号与站点绑定 ==');
for (const a of admins.rows) console.log(`#${a.id}`, a.username, '|', a.role, '|', a.status, '|', a.bindings || '(无绑定)');

await db.end();
