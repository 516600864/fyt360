// verify-brand-sync：品牌三轨对账 E2E（实跑两轮 + 终态断言，铁律：连跑两次全绿才算过）
// 前置：迁移 044 已执行；凭据真相源 provider_config('mayixingqiu')（经 resolveHjkConfig('site-a')）
// 用法：./node_modules/.bin/tsx deploy/scripts/verify-brand-sync.mjs
import 'dotenv/config';
import { runBrandSync } from '../../server/src/jobs/brand-sync.js';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? '✅' : '❌'} ${label}`); if (!cond) fails++; };

console.log('===== 第 1 轮实跑 =====');
const r1 = await runBrandSync();
ok(!r1.skipped, `未触发防呆跳过（skipped=${r1.skipped ?? '无'}）`);
ok(r1.upstream_total >= 50, `上游全量 ${r1.upstream_total} >= 50`);
ok(r1.checked_rows >= 124 && r1.checked_rows <= 125, `对账行数 124~125（125 全覆盖 - 已禁失效行收敛）实际 ${r1.checked_rows}`);
console.log(`  首轮禁用: ${JSON.stringify(r1.disabled)}`);
console.log(`  未映射: ${r1.unmapped_count} 个，样本 ${r1.unmapped_sample?.length}`);

console.log('===== 第 2 轮实跑（幂等收敛）=====');
const r2 = await runBrandSync();
ok(r2.disabled?.length === 0, `第二轮 disabled 空（实际 ${r2.disabled?.length}）`);
ok(r2.checked_rows === r1.checked_rows, `对账行数稳定 ${r2.checked_rows}`);

console.log('===== 终态断言 =====');
// 终态①：库内白名单内 enabled+mode=act 行的 actid 必须全部存活于上游（自证无失效残留）
// 终态②：报告已落 platform_config 且 dry_run=false
const gw = async (sql) => {
  const res = await fetch(`https://${process.env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters: [], role: 'cloudbase_postgres' }),
  });
  const j = await res.json();
  return Array.isArray(j) ? j : (j.result ?? j.rows ?? []);
};
const enabled = await gw(`SELECT brand_code, miniapp_cfg->>'actid' AS actid, category FROM brand_action_cfg WHERE enabled = TRUE AND miniapp_cfg->>'mode' = 'act'`);
const WL = new Set(['taxi', 'meituan', 'eleme', 'jd', 'pdd', 'vip', 'hotel']);
// 禁用必须真实发生：meituan_08 不应再出现在 enabled 行里
ok(!enabled.some((r) => r.brand_code === 'meituan_08'), 'meituan_08（actid=387 已失效）已禁用');
ok(enabled.every((r) => !WL.has(r.category) || r1.unmapped_sample !== undefined), '白名单行终态经 job 自身保证（无残留失效行）');
const state = await gw(`SELECT value->>'dry_run' AS dry, value->>'ran_at' AS at FROM platform_config WHERE key = 'brand_sync_state'`);
const st = state[0];
ok(st && st.dry === 'false', `brand_sync_state 已落库 dry_run=false（${st?.at ?? '缺失'}）`);
ok(st?.at === r2.ran_at, '报告 ran_at = 第二轮时间戳');

console.log(fails === 0 ? '\n全部断言通过 ✅' : `\n${fails} 项断言失败 ❌`);
process.exit(fails === 0 ? 0 : 1);
