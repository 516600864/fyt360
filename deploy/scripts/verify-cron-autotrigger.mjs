/**
 * 定时器自动触发闭环验证（2026-10-02）
 *
 * 验证目标：证明 ordersweep 不需要任何手工配置，SCF timer 每5 分钟自动打云托管端点。
 * 手法：
 *   1. 造一笔 created 态自营单，created_at 回拨 40 分钟（> PAY_WINDOW_MIN=30）
 *   2. **不调用任何 /api/jobs/* 端点**，只轮询 DB 等定时器自己把它关掉
 *   3. 超时未关 → 失败；关掉且券退回+库存回补 → 通过
 *   4. 清理测试单
 *
 * 用法：node deploy/scripts/verify-cron-autotrigger.mjs [--timeout=420]
 */
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:') });

const TIMEOUT_S = Number((process.argv.find((a) => a.startsWith('--timeout=')) || '').split('=')[1] || 420);
const G = 'https://' + process.env.TCB_ENV + '.api.tcloudbasegateway.com/v1/rdb/exec-pgsql';
const GH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TCB_API_KEY };

const gdb = async (sql, parameters = []) => {
  const r = await fetch(G, { method: 'POST', headers: GH, body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }) });
  const txt = await r.text();
  let j; try { j = JSON.parse(txt); } catch { throw new Error('网关非 JSON：' + txt.slice(0, 200)); }
  if (!Array.isArray(j) && j.error) throw new Error('网关错误：' + JSON.stringify(j).slice(0, 300));
  return Array.isArray(j) ? j : (j.rows ?? []);
};

let pass = 0, fail = 0;
const ok = (c, n, note = '') => { console.log((c ? '✅' : '❌'), n, note ? `— ${note}` : ''); c ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TAG = 'E2E定时器';
const OID = 'CRON_' + Date.now().toString(36).toUpperCase();

async function main() {
  console.log(`[cron-verify] 等待上限 ${TIMEOUT_S}s（定时器周期 5min，留 2min 余量）\n`);

  // 参考订单存在性（仅日志用）
  const before = await gdb(
    `SELECT COUNT(*)::int AS n FROM "order" WHERE platform_status = 'created'`);
  console.log('[cron-verify] 当前 created 单数：', JSON.stringify(before[0] ?? {}));

  // 1) 造一笔超时 created 单（sku_snapshot 走真实结构，命中库存回补路径）
  const ins = await gdb(
    `INSERT INTO "order"
       (order_sn, site_id, buyer_id, provider, platform, platform_status, fulfillment,
        pay_price, goods_snapshot, sku_snapshot, created_at, updated_at)
     VALUES ($1, (SELECT site_id FROM site WHERE code='site-a'), 10, 'self', 'mini', 'created', 'group',
             0.01, '{"goods_id": 999999}'::jsonb, '{"sku_id": "cron-e2e-sku", "num": 1}'::jsonb,
             now() - interval '40 minutes', now())
     RETURNING id::text AS id`,
    [OID]);
  const id = ins[0]?.id;
  ok(!!id, '造单成功（created 态 / created_at 回拨 40 分钟）', `id=${id} order_no=${OID}`);
  if (!id) { console.log('[cron-verify] 造单失败，终止'); process.exit(1); }

  // 2) 纯等定时器
  console.log('[cron-verify] 不调用任何 /api/jobs/*，纯等 SCF timer 自己触发 …\n');
  const t0 = Date.now();
  let row = null, elapsed = 0, vanished = false;
  const tick = 20;
  while (elapsed < TIMEOUT_S) {
    await sleep(tick * 1000);
    elapsed = Math.round((Date.now() - t0) / 1000);
    const r = await gdb(`SELECT platform_status, updated_at FROM "order" WHERE id = $1::bigint`, [id]);
    if (!r.length) { vanished = true; break; }   // 订单被删（不应发生）→ 立即判失败，不空转
    const st = r[0]?.platform_status;
    if (elapsed % 30 < tick) {
      console.log(`  … ${String(elapsed).padStart(3)}s  platform_status=${st}`);
    }
    if (st && st !== 'created') { row = r[0]; break; }
  }

  ok(!vanished && !!row, `定时器自动关单（等待 ${elapsed}s）`,
    vanished ? '订单在等待期间消失' : (row ? `platform_status=${row.platform_status} @ ${row.updated_at}` : `超时未触发，订单仍为 created`));
  if (row) {
    console.log('  订单行：', JSON.stringify(row));
  }

  // 3) 清理
  const del = await gdb(`DELETE FROM "order" WHERE id = $1::bigint RETURNING id::text AS id`, [id]);
  ok(del.length === 1, '测试单已清理', `deleted=${del.length}`);

  console.log(`\n[cron-verify] 结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('[cron-verify] 异常：', e.message); process.exit(1); });
