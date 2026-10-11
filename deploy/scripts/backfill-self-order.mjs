// 补偿 ¥95 团购单：微信支付已成功但回调静默 no-op（site 歧义 bug），手工推进 paid + 产核销券。
// 幂等：仅 created 可推进；核销券 ON CONFLICT DO NOTHING。⚠️ 只动 D先生 明确说的这笔。
import 'dotenv/config';
const ORDER_SN = 'SELF_20261011_A9883438B17F';
const gw = async (sql, parameters = []) => {
  const res = await fetch(`https://${process.env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
  });
  if (res.status !== 200) throw new Error(res.status + ' ' + (await res.text()).slice(0, 300));
  return JSON.parse(await res.text());
};

// 1. 前置核对：单必须仍是 created（防重复补偿 / 防改错单）
const pre = await gw(
  `SELECT o.id::text, o.order_sn, o.platform_status, o.fulfillment, o.pay_price::float AS pay, s.code
     FROM "order" o JOIN site s ON s.site_id = o.site_id WHERE o.order_sn = $1`, [ORDER_SN]);
console.log('前置:', JSON.stringify(pre));
if (!pre[0] || pre[0].platform_status !== 'created') {
  console.log('单不存在或已推进，终止。'); process.exit(pre[0] ? 0 : 1);
}
const id = pre[0].id;

// 2. created → paid（RETURNING 判行数，网关铁律）
const upd = await gw(
  `UPDATE "order" SET platform_status='paid', paid_at=COALESCE(paid_at, now()), fulfill_status='pending'
    WHERE id=$1::bigint AND platform_status='created'
    RETURNING id::text, platform_status, paid_at::text`, [id]);
if (!upd[0]) { console.log('UPDATE 0 行，终止。'); process.exit(1); }
console.log('推进:', JSON.stringify(upd));

// 3. 到店核销券（settleSelfOrder 同款：code=GC<orderId>，次数=sku num，7 天）
const cp = await gw(
  `INSERT INTO group_coupon (order_id, code, total_times, status, expire_at)
   VALUES ($1::bigint, $2, GREATEST(1, COALESCE((SELECT (sku_snapshot->>'num')::int FROM "order" WHERE id=$1::bigint), 1)), 'unused', now() + interval '7 days')
   ON CONFLICT (code) DO NOTHING RETURNING code`, [id, `GC${id}`]);
console.log('核销券:', JSON.stringify(cp.length ? cp : '已存在(幂等跳过)'));
console.log(`\n✅ 补偿完成：${ORDER_SN} → paid，核销券 GC${id}`);
