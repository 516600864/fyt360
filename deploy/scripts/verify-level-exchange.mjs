/**
 * M5 等级兑换真实 DB 验证（一次性，跑完即删）：
 * 1. ADMIN_ADJUST +5200 给 user10 → 2. HTTP 兑换 L2 → 3. 复核（member/ingot_tx/balance_after）
 * → 4. 平账还原（member 回 L1、ADMIN_ADJUST -200）→ 5. 复核归零
 * 用法：node deploy/scripts/m5-exchange-test.mjs step1|verify|cleanup
 */
import { loadDotEnv } from './lib/common.mjs';
import { connectDb } from './lib/db.mjs';

loadDotEnv();
const db = await connectDb();
const UID = 10;
const step = process.argv[2] ?? 'step1';

const one = async (sql) => (await db.query(sql)).rows[0];

if (step === 'step1') {
  // +5200 元宝（L2=5000 + 验证余额余量）
  const before = await one(`SELECT balance, total_earned FROM ingot_account WHERE user_id = ${UID}`);
  console.log('before:', before);
  await db.query(
    `INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
     VALUES (${UID}, 'ADMIN_ADJUST', 'm5-test', 5200, COALESCE((SELECT balance FROM ingot_account WHERE user_id = ${UID}), 0) + 5200, 'M5 兑换链路测试充值')
     `
  );
  await db.query(
    `INSERT INTO ingot_account (user_id, balance, total_earned) VALUES (${UID}, 5200, 5200)
     ON CONFLICT (user_id) DO UPDATE SET balance = ingot_account.balance + 5200, total_earned = ingot_account.total_earned + 5200, updated_at = now()`
  );
  await db.query(
    `UPDATE ingot_tx SET balance_after = COALESCE((SELECT balance FROM ingot_account WHERE user_id = ${UID}), 0)
      WHERE user_id = ${UID} AND type = 'ADMIN_ADJUST' AND ref_id = 'm5-test'`
  );
  console.log('charged:', await one(`SELECT balance, total_earned FROM ingot_account WHERE user_id = ${UID}`));
  console.log('>> 现在调用 POST /api/me/member/level/exchange {"code":"L2"}，然后跑 node m5-exchange-test.mjs verify');
} else if (step === 'verify') {
  console.log('account:', await one(`SELECT balance, frozen, total_earned FROM ingot_account WHERE user_id = ${UID}`));
  console.log('member:', await one(`SELECT ml.code, ml.name, m.level_exchanged_at FROM member m JOIN member_level ml ON ml.level_id = m.level_id WHERE m.user_id = ${UID}`));
  console.log('tx:', await one(`SELECT tx_id, type, ref_id, amount, balance_after, remark FROM ingot_tx WHERE user_id = ${UID} AND type = 'LEVEL_EXCHANGE' ORDER BY tx_id DESC LIMIT 1`));
} else if (step === 'cleanup') {
  // 平账：member 回 L1 + 元宝扣回当前余额（剩余 = 5200-5000 = 200）
  const acc = await one(`SELECT balance FROM ingot_account WHERE user_id = ${UID}`);
  await db.query(
    `UPDATE member SET level_id = (SELECT level_id FROM member_level WHERE code = 'L1'), level_exchanged_at = NULL WHERE user_id = ${UID}`
  );
  await db.query(
    `INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
     VALUES (${UID}, 'ADMIN_ADJUST', 'm5-cleanup', -${acc.balance}, 0, 'M5 测试平账（含测试充值余量回收）')`
  );
  await db.query(`UPDATE ingot_account SET balance = 0, total_earned = total_earned - ${5200 - acc.balance >= 0 ? 5200 - acc.balance : 0}, updated_at = now() WHERE user_id = ${UID}`);
  await db.query(`UPDATE ingot_tx SET balance_after = 0 WHERE user_id = ${UID} AND type = 'ADMIN_ADJUST' AND ref_id = 'm5-cleanup'`);
  console.log('after cleanup:', await one(`SELECT balance, total_earned FROM ingot_account WHERE user_id = ${UID}`));
  console.log('member:', await one(`SELECT ml.code FROM member m JOIN member_level ml ON ml.level_id = m.level_id WHERE m.user_id = ${UID}`));
}
await db.end();
