// 探针：user_push_quota 分布与签到提醒候选实况
import fs from 'node:fs';
for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const { connectDb } = await import('./lib/db.mjs');
const db = await connectDb();

const c = await db.query(`SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conrelid='user_push_quota'::regclass AND contype IN ('u','p')`);
console.log('约束:', JSON.stringify(c.rows));

const r = await db.query(`
  SELECT q.user_id, q.quota, s.code,
         (c.last_date AT TIME ZONE 'Asia/Shanghai')::date AS last_day,
         (c.user_id IS NULL OR (c.last_date AT TIME ZONE 'Asia/Shanghai')::date <> '2026-10-12'::date) AS cand
    FROM user_push_quota q
    JOIN site s ON s.site_id = q.site_id
    LEFT JOIN checkin_record c ON c.site_id = q.site_id AND c.user_id = q.user_id
   ORDER BY s.code, q.user_id`);
console.log('quota 行明细:');
for (const row of r.rows) {
  console.log(`  site=${row.code} user=${row.user_id} quota=${row.quota} 今日已签=${row.last_day === '2026-10-12'} 候选=${row.cand}`);
}

// user25 授权累计口径：quota 现值 + updated_at
const u25 = await db.query(`SELECT q.quota, q.updated_at, s.code FROM user_push_quota q JOIN site s ON s.site_id=q.site_id WHERE q.user_id=25`);
console.log('user25:', JSON.stringify(u25.rows));
await db.end();
