// 探针：为什么看板「支付手续费」显示 ¥0.00 —— 复放 fee SQL 逐条件实锤
import fs from 'node:fs';
for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const { connectDb } = await import('./lib/db.mjs');
const db = await connectDb();

// 1. 两笔 self 单全字段
const o = await db.query(`
  SELECT o.order_sn, o.provider, o.pay_price::float AS pay_price, o.commission::float AS commission,
         o.payment_no, o.platform_status, o.refund_status,
         o.paid_at, o.settled_at, s.code AS site_code
    FROM "order" o JOIN site s ON s.site_id = o.site_id
   WHERE o.order_sn IN ('SELF_20261011_584A124BC4B2','SELF_20261011_A9883438B17F')`);
console.log('两笔订单实况:');
for (const r of o.rows) {
  console.log(`  ${r.order_sn} site=${r.site_code} provider=${r.provider} pay=${r.pay_price} ` +
    `payment_no=${r.payment_no === null ? 'NULL' : JSON.stringify(r.payment_no)} ` +
    `status=${r.platform_status} refund=${r.refund_status} paid_at=${r.paid_at?.toISOString?.() ?? r.paid_at}`);
}

// 2. niwo 近7日 self 实收总览（无 payment_no 条件）
const g = await db.query(`
  SELECT s.code,
         COUNT(*)::int AS cnt,
         COALESCE(SUM(o.pay_price),0)::float AS receipt,
         COUNT(*) FILTER (WHERE o.payment_no IS NOT NULL AND o.payment_no <> '')::int AS with_payno,
         COUNT(*) FILTER (WHERE o.payment_no IS NULL OR o.payment_no = '')::int AS no_payno
    FROM "order" o JOIN site s ON s.site_id = o.site_id
   WHERE o.provider='self' AND o.paid_at >= now() - interval '7 days'
   GROUP BY s.code`);
console.log('近7日 self 单（无 payment_no 过滤）:', JSON.stringify(g.rows));

// 3. 站点费率
const sp = await db.query(`
  SELECT s.code, sp.commission_rate::float AS rate, sp.status
    FROM site_payment sp JOIN site s ON s.site_id = sp.site_id`);
console.log('site_payment.commission_rate:', JSON.stringify(sp.rows));

// 4. 复放看板 fee SQL（niwo，近7日）
const f = await db.query(`
  SELECT COALESCE(SUM(o2.pay_price),0)::float AS self_paid_gmv
    FROM "order" o2 JOIN site s2 ON s2.site_id = o2.site_id
   WHERE s2.code='niwo' AND o2.provider='self'
     AND o2.payment_no IS NOT NULL AND o2.payment_no <> ''
     AND o2.paid_at >= now() - interval '7 days'`);
console.log('fee SQL 命中实收(带 payment_no 条件):', f.rows[0].self_paid_gmv);

await db.end();
