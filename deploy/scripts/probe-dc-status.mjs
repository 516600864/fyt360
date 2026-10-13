// 诊断：星巴克 dc 单 332026101214350664869 为何卡「已付款/待结算」
import fs from 'node:fs';
const env = {};
for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

const { connectDb } = await import('./lib/db.mjs');
const db = await connectDb();

// 1) 本单现态
const o = await db.query(`
  SELECT order_sn, provider, platform_status, refund_status,
         paid_at, settled_at, platform_updated_at, commission, cost_amount, updated_at
    FROM "order" WHERE order_sn = '332026101214350664869'`);
console.log('== DB 订单现态 ==');
console.log(JSON.stringify(o.rows[0] ?? null, null, 2));

// 2) niwo dc 水位（判断 14:36 的上游更新是否在同步窗口内）
const w = await db.query(`
  SELECT provider, watermark, updated_at
    FROM sync_watermark WHERE site_id = (SELECT site_id FROM site WHERE code='niwo') AND provider='dc'`);
console.log('== niwo dc 水位 ==', JSON.stringify(w.rows[0] ?? null));

// 3) niwo 全部 dc 单状态分布（看是否从来没有任何 dc 单到过 settled）
const d = await db.query(`
  SELECT platform_status, COUNT(*) n FROM "order"
   WHERE site_id=(SELECT site_id FROM site WHERE code='niwo') AND provider='dc'
   GROUP BY platform_status`);
console.log('== niwo dc 单状态分布 ==', JSON.stringify(d.rows));

// 4) 全库 dc 单是否有任何 settled（验证「dc 永远到不了 settled」）
const g = await db.query(`SELECT platform_status, COUNT(*) n FROM "order" WHERE provider='dc' GROUP BY platform_status`);
console.log('== 全库 dc 状态分布 ==', JSON.stringify(g.rows));

await db.end();
