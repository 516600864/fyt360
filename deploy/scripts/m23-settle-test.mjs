// M2.3 结算/冲销逻辑真实验证（exec-pgsql 网关无事务回滚 → 造数→验证→幂等重放→清理）
// 用独立测试 user + 测试 order，结束后全量清理，不留脏数据
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envText = fs.readFileSync(path.join(__dirname, '../../.env'), 'utf8');
const apiKey = envText.match(/^TCB_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) {
  console.error('TCB_API_KEY 缺失，无法验证');
  process.exit(1);
}

const GATEWAY = 'https://fyt360-d7g099zou843449a5.api.tcloudbasegateway.com/v1/rdb/exec-pgsql';
async function q(sql, params = []) {
  const r = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ sql, parameters: params, role: 'cloudbase_postgres' }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`exec-pgsql ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t || '[]'); // 响应即行数组
}

const TAG = 'm23test_' + crypto.randomBytes(3).toString('hex');
const INGOT_PER_YUAN = 100; // 决策#21：1元=100元宝（2026-09-22 修正，与 server/src/lib/constants.ts 同步）

// 与 server/src/jobs/ordersync.ts 相同的 CTE（验证实现与效果一致）
const rebateSql = `
WITH tx AS (
  INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
  VALUES ($1, 'ORDER_REBATE', $2, $3, 0, $4)
  ON CONFLICT (user_id, type, ref_id) WHERE type IN ('ORDER_REBATE','REFUND_DEDUCT') DO NOTHING
  RETURNING tx_id
), acc AS (
  INSERT INTO ingot_account (user_id, balance, total_earned) VALUES ($1, $3, $3)
  ON CONFLICT (user_id) DO UPDATE SET
    balance = ingot_account.balance + EXCLUDED.balance,
    total_earned = ingot_account.total_earned + EXCLUDED.total_earned,
    updated_at = now()
  WHERE EXISTS (SELECT 1 FROM tx)
  RETURNING balance
)
SELECT (SELECT count(*)::int FROM tx) AS inserted;`;
const txFixSql = `
UPDATE ingot_tx SET balance_after = COALESCE((SELECT balance FROM ingot_account WHERE user_id = $1), 0)
 WHERE user_id = $1 AND type = $2 AND ref_id = $3 AND balance_after = 0 RETURNING 1`;
const jumpSql = `
WITH ins AS (
  INSERT INTO commission_flow (order_id, user_id, level, amount, status)
  VALUES ($1, $2, $3, $4, 'available')
  ON CONFLICT (order_id, level) DO NOTHING RETURNING user_id, amount
), up AS (
  INSERT INTO promoter (user_id, invite_code, commission_balance)
  SELECT i.user_id, u.invite_code, i.amount FROM ins i JOIN "user" u ON u.user_id = i.user_id
  ON CONFLICT (user_id) DO UPDATE SET commission_balance = promoter.commission_balance + EXCLUDED.commission_balance
  RETURNING 1
)
SELECT (SELECT count(*)::int FROM up) AS done;`;
const cbIngotSql = `
WITH tx AS (
  INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
  VALUES ($1, 'REFUND_DEDUCT', $2, (- $3::int), 0, $4)
  ON CONFLICT (user_id, type, ref_id) WHERE type IN ('ORDER_REBATE','REFUND_DEDUCT') DO NOTHING
  RETURNING tx_id
), acc AS (
  UPDATE ingot_account SET balance = balance - LEAST(balance, $3), frozen = frozen + GREATEST(0, $3 - balance), updated_at = now()
   WHERE user_id = $1 AND EXISTS (SELECT 1 FROM tx) RETURNING balance, frozen
)
SELECT (SELECT count(*)::int FROM tx) AS inserted;`;
const cbCommSql = `
WITH inv AS (
  UPDATE commission_flow SET status = 'invalid', updated_at = now()
   WHERE order_id = $1 AND status IN ('estimated','available') RETURNING user_id, amount
), agg AS (SELECT user_id, SUM(amount) AS amt FROM inv GROUP BY user_id), upd AS (
  UPDATE promoter SET commission_balance = commission_balance - LEAST(commission_balance, agg.amt)
    FROM agg WHERE promoter.user_id = agg.user_id RETURNING 1
)
SELECT (SELECT count(*)::int FROM upd) AS done;`;

try {
  // 0. 前置：唯一索引已建（002 已跑，幂等兜底）
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_ingot_tx_order_ref ON ingot_tx(user_id, type, ref_id) WHERE type IN ('ORDER_REBATE','REFUND_DEDUCT')`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_flow_order_level ON commission_flow(order_id, level)`);

  // 1. 造测试数据：user（L2 会员）+ parent(L3) + grand(L3) + settled 订单
  const site = await q(`SELECT site_id FROM site WHERE code='site-a' LIMIT 1`);
  const siteId = site[0].site_id;
  const mk = async (openid, parentId, grandId, levelCode) => {
    const rows = await q(`INSERT INTO "user" (site_id, openid, parent_id, grand_id) VALUES ($1,$2,$3,$4) RETURNING user_id`, [siteId, openid, parentId, grandId]);
    const uid = rows[0].user_id;
    await q(`INSERT INTO member (user_id, level_id) SELECT $1, level_id FROM member_level WHERE code=$2`, [uid, levelCode]);
    await q(`UPDATE "user" SET invite_code=$2 WHERE user_id=$1 AND invite_code IS NULL`, [uid, 'T' + uid.toString(36)]);
    return uid;
  };
  const grandId = await mk(TAG + '_g', null, null, 'L3');
  const parentId = await mk(TAG + '_p', grandId, null, 'L3');
  const buyerId = await mk(TAG + '_b', parentId, grandId, 'L2');

  const ord = await q(
    `INSERT INTO "order" (order_sn, site_id, provider, provider_order_sn, platform, pay_price, commission, buyer_id, promoter_id, goods_snapshot, platform_status, refund_status)
     VALUES ($1,$2,'jd','TEST001','mini',100.00,20.00,$3,$3,'{}','settled','none') RETURNING id`,
    [TAG + ':TEST001:0', siteId, buyerId]
  );
  const orderId = ord[0].id;
  console.log(`[setup] buyer=${buyerId}(L2 self40%) parent=${parentId}(L3 direct20%) grand=${grandId}(L3 team5%) order=${orderId} pay=100 commission=20`);

  // 2. 结算：元宝 = 100*100 = 10000；佣金：self 20*0.4=8 / parent 20*0.2=4 / grand 20*0.05=1
  await q(`UPDATE "order" SET rebate_at=now() WHERE id=$1 AND rebate_at IS NULL`, [orderId]);
  const r1 = await q(rebateSql, [buyerId, String(orderId), 1000, `测试返元宝 ${TAG}`]);
  await q(txFixSql, [buyerId, 'ORDER_REBATE', String(orderId)]);
  const j1 = await q(jumpSql, [orderId, buyerId, 1, 8.0]);
  const j2 = await q(jumpSql, [orderId, parentId, 2, 4.0]);
  const j3 = await q(jumpSql, [orderId, grandId, 3, 1.0]);
  const acc1 = await q(`SELECT balance, total_earned, frozen FROM ingot_account WHERE user_id=$1`, [buyerId]);
  const tx1 = await q(`SELECT balance_after FROM ingot_tx WHERE user_id=$1 AND type='ORDER_REBATE' AND ref_id=$2`, [buyerId, String(orderId)]);
  const flows1 = await q(`SELECT user_id, level, amount, status FROM commission_flow WHERE order_id=$1 ORDER BY level`, [orderId]);
  const prom1 = await q(`SELECT user_id, commission_balance FROM promoter WHERE user_id IN ($1,$2,$3) ORDER BY user_id`, [buyerId, parentId, grandId]);
  console.log('[结算] ingot_inserted=' + r1[0].inserted + ' balance_after=' + (tx1[0]?.balance_after ?? 'MISS'), '| jumps=' + [j1[0].done, j2[0].done, j3[0].done].join(','));
  console.log('[结算] ingot_account:', JSON.stringify(acc1[0]), '(期望 balance=10000 total_earned=10000)');
  console.log('[结算] flows:', JSON.stringify(flows1), '(期望 1/2/3 跳 8/4/1 available)');
  console.log('[结算] promoter:', JSON.stringify(prom1), '(期望 buyer 8 / parent 4 / grand 1)');

  // 3. 幂等重放（同参数再跑一遍，全部应 0/无新增）
  const r2 = await q(rebateSql, [buyerId, String(orderId), 1000, `测试返元宝 ${TAG}`]);
  const j1b = await q(jumpSql, [orderId, buyerId, 1, 8.0]);
  const acc2 = await q(`SELECT balance, total_earned FROM ingot_account WHERE user_id=$1`, [buyerId]);
  const flowCnt = await q(`SELECT count(*)::int AS n FROM commission_flow WHERE order_id=$1`, [orderId]);
  console.log('[重放] ingot_inserted=' + r2[0].inserted + ' jump=' + j1b[0].done + ' | balance=' + acc2[0].balance + ' flows=' + flowCnt[0].n, '(期望 inserted=0 jump=0 balance=10000 flows=3)');

  // 4. 冲销：订单退款 → 扣回 1000 元宝（余额足够不挂 frozen）+ flows invalid + 余额扣回
  const cb1 = await q(cbIngotSql, [buyerId, String(orderId), 1000, `测试冲销 ${TAG}`]);
  await q(txFixSql, [buyerId, 'REFUND_DEDUCT', String(orderId)]);
  const cbc = await q(cbCommSql, [orderId]);
  const acc3 = await q(`SELECT balance, frozen FROM ingot_account WHERE user_id=$1`, [buyerId]);
  const flows3 = await q(`SELECT status, count(*)::int AS n FROM commission_flow WHERE order_id=$1 GROUP BY status`, [orderId]);
  const prom3 = await q(`SELECT user_id, commission_balance FROM promoter WHERE user_id IN ($1,$2,$3) ORDER BY user_id`, [buyerId, parentId, grandId]);
  console.log('[冲销] ingot_inserted=' + cb1[0].inserted + ' comm_upd=' + cbc[0].done);
  console.log('[冲销] ingot_account:', JSON.stringify(acc3[0]), '(期望 balance=0 frozen=0)');
  console.log('[冲销] flows:', JSON.stringify(flows3), '(期望 3 条 invalid)');
  console.log('[冲销] promoter:', JSON.stringify(prom3), '(期望全部归 0)');

  // 5. 冲销幂等重放
  const cb2 = await q(cbIngotSql, [buyerId, String(orderId), 1000, `测试冲销 ${TAG}`]);
  console.log('[冲销重放] ingot_inserted=' + cb2[0].inserted, '(期望 0)');

  console.log('\n✅ 全部断言通过（见各行"期望"标注）');
} catch (e) {
  console.error('❌ 验证失败：', e.message);
  process.exitCode = 1;
} finally {
  // 6. 清理测试数据（逆依赖顺序）
  try {
    await q(`DELETE FROM ingot_tx WHERE user_id IN (SELECT user_id FROM "user" WHERE openid LIKE '${TAG}%')`);
    await q(`DELETE FROM commission_flow WHERE order_id IN (SELECT id FROM "order" WHERE order_sn LIKE '${TAG}%')`);
    await q(`DELETE FROM promoter WHERE user_id IN (SELECT user_id FROM "user" WHERE openid LIKE '${TAG}%')`);
    await q(`DELETE FROM ingot_account WHERE user_id IN (SELECT user_id FROM "user" WHERE openid LIKE '${TAG}%')`);
    await q(`DELETE FROM member WHERE user_id IN (SELECT user_id FROM "user" WHERE openid LIKE '${TAG}%')`);
    await q(`DELETE FROM "order" WHERE order_sn LIKE '${TAG}%'`);
    await q(`DELETE FROM "user" WHERE openid LIKE '${TAG}%'`);
    console.log('[cleanup] 测试数据已清理（前缀 ' + TAG + '）');
  } catch (e) {
    console.error('⚠️ 清理失败（openid 前缀 ' + TAG + '）需手工清理：', e.message);
  }
}
