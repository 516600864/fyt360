/**
 * 自营交易链真实 DB 验证（trade-chain verify）。
 * 用法：node deploy/scripts/verify-trade-chain.mjs seed|check|cleanup
 *  seed   → 插入测试自营商品（10 元单 SKU 库存 5）
 *  check  → 校验订单/元宝/佣金/库存（对照预期）
 *  cleanup→ 删测试商品 + 还原 user10 元宝/佣金（按预注册的 tx ref 回滚）
 * 预期（user10 L1，站点无支付凭据走 mock，rate=0.2 默认）：
 *   下单 pay_price=10.00 → 库存 5→4 → commission=2.00 → L1 自购 rate=0 → 无佣金
 *   元宝 = floor(10×100) = 1000
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

// 复用部署脚本的 dotenv + 网关执行
async function loadDeps() {
  const common = await import(`file://${path.join(root, 'deploy/scripts/lib/common.mjs').replace(/\\/g, '/')}`);
  const dbmod = await import(`file://${path.join(root, 'deploy/scripts/lib/db.mjs').replace(/\\/g, '/')}`);
  common.loadDotEnv();
  const db = await dbmod.connectDb();
  return { db };
}

const GOODS_TITLE = '测试自营商品-交易链验证-验证后删除';
const SITE = '07642761-7991-4357-bdc1-997462559e68';

const mode = process.argv[2] ?? '';
const { db } = await loadDeps();

if (mode === 'seed') {
  await db.query(
    `INSERT INTO self_goods (site_id, title, main_imgs, detail_imgs, skus, delivery_type, status)
     VALUES ('${SITE}', '${GOODS_TITLE}', '[]', '[]',
             '[{"sku_id":"t1","spec":"标准装","price":10,"stock":5}]'::jsonb, 'express', 'on')`,
  );
  const r = await db.query(`SELECT goods_id FROM self_goods WHERE title = '${GOODS_TITLE}' LIMIT 1`);
  console.log('SEEDED goods_id =', r.rows[0].goods_id);
} else if (mode === 'check') {
  const g = await db.query(`SELECT skus->0->>'stock' AS stock FROM self_goods WHERE title = '${GOODS_TITLE}' LIMIT 1`);
  const o = await db.query(
    `SELECT id, order_sn, pay_price::float AS pay, commission::float AS comm, platform_status, fulfill_status, settled_at
       FROM "order" WHERE order_sn LIKE 'SELF:%' AND goods_snapshot->>'title' = '${GOODS_TITLE}'
      ORDER BY id DESC LIMIT 1`,
  );
  const oid = o.rows[0]?.id;
  const ingot = await db.query(
    `SELECT balance, total_earned FROM ingot_account WHERE user_id = 10 LIMIT 1`,
  );
  const tx = oid
    ? await db.query(`SELECT amount, balance_after FROM ingot_tx WHERE user_id = 10 AND type = 'ORDER_REBATE' AND ref_id = '${oid}' LIMIT 1`)
    : { rows: [] };
  const cf = oid ? await db.query(`SELECT level, amount::float AS amt, status FROM commission_flow WHERE order_id = ${oid}`) : { rows: [] };
  console.log(JSON.stringify({
    stock_after: g.rows[0]?.stock,
    order: o.rows[0] ?? null,
    ingot_now: ingot.rows[0] ?? null,
    rebate_tx: tx.rows[0] ?? null,
    commission_flows: cf.rows,
  }, null, 1));
} else if (mode === 'cleanup') {
  await db.query(`DELETE FROM commission_flow WHERE order_id IN (SELECT id FROM "order" WHERE goods_snapshot->>'title' = '${GOODS_TITLE}')`);
  await db.query(
    `DELETE FROM ingot_tx WHERE user_id = 10 AND type = 'ORDER_REBATE' AND ref_id IN (
       SELECT id::text FROM "order" WHERE goods_snapshot->>'title' = '${GOODS_TITLE}')`,
  );
  await db.query(`DELETE FROM ingot_account WHERE user_id = 10 AND total_earned <= 1000 AND balance <= 1000`);
  await db.query(`DELETE FROM "order" WHERE goods_snapshot->>'title' = '${GOODS_TITLE}'`);
  await db.query(`DELETE FROM self_goods WHERE title = '${GOODS_TITLE}'`);
  const g = await db.query(`SELECT COUNT(*)::int AS n FROM self_goods WHERE title = '${GOODS_TITLE}'`);
  const o = await db.query(`SELECT COUNT(*)::int AS n FROM "order" WHERE order_sn LIKE 'SELF:%'`);
  const a = await db.query(`SELECT COALESCE(balance,0)::int AS bal, COALESCE(total_earned,0)::int AS te FROM ingot_account WHERE user_id = 10 LIMIT 1`);
  console.log('CLEANUP goods_left =', g.rows[0].n, '| self_orders_left =', o.rows[0].n, '| ingot =', JSON.stringify(a.rows[0] ?? { bal: 0, te: 0 }));
} else {
  console.error('usage: node verify-trade-chain.mjs seed|check|cleanup');
}
await db.end();
