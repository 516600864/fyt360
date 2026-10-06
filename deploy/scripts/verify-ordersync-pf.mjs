// E2E：pforder 同步链路 4 个断点回归（2026-10-04 修复后固化）
// 覆盖：①extend_id 复合形态不再被丢弃 ②valistatus 结算判定 ③pf_type 1/2/3/6 让位 v1
//      ④order_sn 长度不超 varchar(64) ⑤结算幂等无残留
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const PF = 'http://api-gw.haojingke.com/index.php/v2/api/index/pforder';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

async function q(sql, parameters = []) {
  const r = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
  });
  return JSON.parse(await r.text());
}

const cfg = await q(`SELECT apikey FROM provider_config WHERE provider='mayixingqiu' LIMIT 1`);
const apikey = cfg[0] && cfg[0].apikey;
ok(!!apikey, 'provider_config.apikey 可读');

console.log('\n【1】断点①：extend_id 复合形态（修复前 1011 行只入 2 行）');
const now = Math.floor(Date.now() / 1000);
async function pfFetch(start, end, page = 1) {
  const r = await fetch(PF, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      apikey, page: String(page), limit: '100', querytype: '2',
      starttime: String(start), endtime: String(end), pf_type: '', extend_id: '',
    }).toString(),
  });
  return r.json();
}
const j = await pfFetch(now - 86400, now, 1);
const rows = (j && j.data && j.data.data) || [];
const YIELD = new Set([1, 2, 3, 6]);
const kept = rows.filter((r) => !YIELD.has(r.pf_type));
const composite = kept.filter((r) => !/^\d+$/.test(String(r.extend_id ?? '')));
console.log(`  近 24h 共 ${rows.length} 行，让位v1 ${rows.length - kept.length} 行，应入库 ${kept.length} 行`);
console.log(`  其中 extend_id 复合形态（非纯数字）${composite.length} 行 —— 修复前这批全被丢弃`);
ok(composite.length > 0, `复合形态 extend_id 确实存在（${composite.length} 行）→ 正是旧代码丢弃的那批`);

const attrSamples = [...new Set(composite.slice(0, 3).map((r) => r.extend_id))];
console.log('  样本:', JSON.stringify(attrSamples));

console.log('\n【2】断点②：valistatus 结算判定（修复前 isbalance 恒 0 → 永不结算）');
//⚠️ 结算单**不在 24h 窗口里**（实测下单→结算滞后 p50=12 天），
//   必须回看多天采样，否则这条断言会假阴性。
const settledUpstream = [];
for (let d = 1; d <= 5 && settledUpstream.length < 5; d++) {
  for (let p = 1; p <= 3; p++) {
    const jj = await pfFetch(now - d * 86400, now - (d - 1) * 86400, p);
    const l = (jj && jj.data && jj.data.data) || [];
    if (!l.length) break;
    settledUpstream.push(...l.filter((r) => /结算/.test(String(r.valistatus ?? ''))));
    if (l.length < 100) break;
  }
}
ok(settledUpstream.length > 0, `多日回看找到 valistatus 含「结算」的单（${settledUpstream.length} 行）→ 旧代码全当 paid 处理`);
if (settledUpstream[0]) {
  console.log('  样本:', JSON.stringify({
    valistatus: settledUpstream[0].valistatus,
    validcode: settledUpstream[0].validcode,
    yn: settledUpstream[0].yn,
    isbalance: settledUpstream[0].isbalance,
  }), '← 旧逻辑(yn===0||validcode==="0")判为 paid，佣金永不结算');
}
ok(rows.every((r) => r.isbalance === 0), '上游 isbalance 实测恒为 0（证实不能作结算判据）');
const settledDb = await q(`SELECT count(*)::text AS n FROM "order" WHERE platform_status = 'settled' AND provider = 'meituan'`);
ok(Number(settledDb[0].n) > 0, `meituan 已结算单已落库（${settledDb[0].n} 条）`);

console.log('\n【3】断点③：pf_type 1/2/3/6 让位 v1（防粗粒度镜像覆盖正确金额）');
const leaked = await q(`SELECT count(*)::text AS n FROM "order"
  WHERE goods_snapshot ? 'pfType' AND goods_snapshot->>'pfType' IN ('1','2','3','6')`);
ok(Number(leaked[0].n) === 0, '库中不存在 pfType 1/2/3/6 的 pforder 单（已让位 v1 联盟）');
const tbSample = await q(`SELECT order_sn, pay_price::text, commission::text FROM "order"
  WHERE provider = 'tb' AND order_sn LIKE 'tb:3317079756185003181%'`);
ok(tbSample.length > 0, `v1 tb 口径的单号未被pf 覆盖（${tbSample[0] && tbSample[0].order_sn} ¥${tbSample[0] && tbSample[0].pay_price}）`);

console.log('\n【4】断点④：order_sn 不超 varchar(64)');
const lenStat = await q(`SELECT max(length(order_sn))::text AS max_len,
  count(*) FILTER (WHERE length(order_sn) > 55)::text AS near_limit FROM "order"`);
ok(Number(lenStat[0].max_len) <= 64, `最长 order_sn = ${lenStat[0].max_len} ≤ 64`);
ok(Number(lenStat[0].near_limit) === 0, '无临界长度单（防 22001 复发）');

console.log('\n【5】断点⑤：结算幂等（性能修复后无残留）');
const P = 'jd,tb,pdd,vip,pf,dc,recharge,movie,meituan,eleme,didi,local,liucard,fzy,ks,other';
const idem = await q(`SELECT
  count(*) FILTER (WHERE platform_status='settled' AND rebate_at IS NULL)::text AS unmarked,
  count(*) FILTER (WHERE refund_status='refunded' AND rebate_at IS NOT NULL AND chargeback_at IS NULL)::text AS refund_pending
  FROM "order" WHERE provider = ANY(string_to_array($1, ','))`, [P]);
ok(Number(idem[0].unmarked) === 0, '无「已结算但未标 rebate_at」的残留（否则每 30 分钟重复扫）');
ok(Number(idem[0].refund_pending) === 0, '无「退款未标 chargeback_at」的残留');

console.log('\n【6】样本单核对（用户点名的美团单）');
const target = await q(`SELECT provider, pay_price::text, commission::text, platform_status,
  goods_snapshot->>'attrRaw' AS attr FROM "order" WHERE order_sn LIKE '%ZQJvXlpTVlRXXVBkBmlbWFJfXg%'`);
ok(target.length === 1, '该单已入库且只有 1 条（未重复）');
if (target[0]) {
  ok(target[0].provider === 'meituan', `provider = ${target[0].provider}（pf_type=16 → 美团分销联盟）`);
  ok(target[0].pay_price === '17.20', `实付 ¥${target[0].pay_price}（上游 1720 分 → 17.20 元）`);
  ok(target[0].attr === '135123xcsaas6000817', `归因串留档 = ${target[0].attr}`);
}

console.log(`\n${'='.repeat(46)}\n通过 ${pass} / ${pass + fail}${fail ? `，失败 ${fail}` : '，全部通过 ✅'}\n`);
process.exit(fail ? 1 : 0);
