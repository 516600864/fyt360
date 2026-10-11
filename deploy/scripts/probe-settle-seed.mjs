// 探针：结算配置站点级化后各站数据实况（member_level / platform_config 播种情况）
import { connectDb } from './lib/db.mjs';

const db = await connectDb();

const sites = await db.query(`SELECT site_id::text AS id, code, name, status FROM site ORDER BY created_at`);
console.log('== sites ==');
for (const s of sites.rows) console.log(s.code, '|', s.status, '|', s.id);

const lv = await db.query(`
  SELECT s.code, COUNT(ml.level_id) AS levels,
         COALESCE(string_agg(ml.code || ':' || COALESCE(ml.ingot_price::text,'-'), ', ' ORDER BY ml.sort), '') AS detail
    FROM site s LEFT JOIN member_level ml ON ml.site_id = s.site_id
   GROUP BY s.code ORDER BY s.code`);
console.log('\n== member_level per site ==');
for (const r of lv.rows) console.log(r.code, '| levels =', r.levels, '|', r.detail);

const pc = await db.query(`
  SELECT s.code, COUNT(pc.key) AS keys,
         COALESCE(string_agg(pc.key, ', '), '') AS detail
    FROM site s LEFT JOIN platform_config pc ON pc.site_id = s.site_id
   GROUP BY s.code ORDER BY s.code`);
console.log('\n== platform_config per site ==');
for (const r of pc.rows) console.log(r.code, '| keys =', r.keys, '|', r.detail);

const plat = await db.query(`SELECT key FROM platform_config WHERE site_id IS NULL`);
console.log('\n== platform_config 平台键(NULL) ==', plat.rows.map(r => r.key).join(', ') || '(无)');

await db.end();
