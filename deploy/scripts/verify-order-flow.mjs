/**
 * M6 订单链路真实 DB 验证（一次性，跑完即清）：
 * seed = 造自购测试单（buyer=promoter=user10, paid 未交付）
 * upL2 / downL1 = 升降 user10 等级（验证 est_rebate 计算）
 * cleanup = 删测试单 + 复核归零
 * 用法：node deploy/scripts/verify-order-flow.mjs seed|upL2|downL1|cleanup
 */
import { loadDotEnv } from './lib/common.mjs';
import { connectDb } from './lib/db.mjs';

loadDotEnv();
const db = await connectDb();
const SN = 'TEST-M6-VERIFY-001';
const step = process.argv[2] ?? 'seed';
const one = async (sql) => (await db.query(sql)).rows[0];

if (step === 'seed') {
  const exist = await one(`SELECT id FROM "order" WHERE order_sn = '${SN}' LIMIT 1`);
  if (exist) {
    console.log('already seeded, id =', exist.id);
  } else {
    await db.query(
      `INSERT INTO "order" (order_sn, site_id, provider, platform, pay_price, commission, buyer_id, promoter_id, goods_snapshot, platform_status, fulfill_status, refund_status, paid_at)
       VALUES ('${SN}', '07642761-7991-4357-bdc1-997462559e68', 'self', 'mini', 100.00, 2.50, 10, 10,
         '{"title": "测试订单-M6验证用-验证后删除", "pic": ""}'::jsonb, 'paid', 'pending', 'none', now())`
    );
    const r = await one(`SELECT id FROM "order" WHERE order_sn = '${SN}' LIMIT 1`);
    console.log('seeded, id =', r.id);
  }
  const m = await one(`SELECT ml.self_rate::float AS rate, ml.code FROM member m JOIN member_level ml ON ml.level_id = m.level_id WHERE m.user_id = 10`);
  console.log('user10 level =', m.code, 'self_rate =', m.rate);
} else if (step === 'upL2') {
  await db.query(`UPDATE member SET level_id = (SELECT level_id FROM member_level WHERE code = 'L2') WHERE user_id = 10`);
  console.log('user10 -> L2 (expect est_rebate = 2.50*0.4 = 1.00)');
} else if (step === 'downL1') {
  await db.query(`UPDATE member SET level_id = (SELECT level_id FROM member_level WHERE code = 'L1') WHERE user_id = 10`);
  console.log('user10 -> L1');
} else if (step === 'cleanup') {
  await db.query(`DELETE FROM "order" WHERE order_sn = '${SN}' AND buyer_id = 10`);
  const left = await one(`SELECT COUNT(*)::int AS n FROM "order" WHERE order_sn = '${SN}'`);
  const lv = await one(`SELECT ml.code FROM member m JOIN member_level ml ON ml.level_id = m.level_id WHERE m.user_id = 10`);
  console.log('test orders left =', left.n, '| user10 level =', lv.code);
}
await db.end();
