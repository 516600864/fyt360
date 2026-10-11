// 探针：验证各站点蚂蚁 apikey 归属（掩码显示前 4+后 4）
import fs from 'node:fs';
import { connectDb } from './lib/db.mjs';

for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}

const db = await connectDb();
const r = await db.query(`
  SELECT s.code, s.name, p.provider, p.apikey, p.status, p.test_status
    FROM provider_config p
    JOIN site s ON s.site_id = p.site_id
   WHERE p.provider = 'mayixingqiu'
   ORDER BY s.code`);
for (const row of r.rows) {
  const k = row.apikey ?? '';
  const masked = k.length > 8 ? k.slice(0, 4) + '****' + k.slice(-4) : k;
  console.log(`${row.code.padEnd(8)} | ${row.name.padEnd(10)} | apikey=${masked} (${k.length}) | status=${row.status}/${row.test_status}`);
}
await db.end();
