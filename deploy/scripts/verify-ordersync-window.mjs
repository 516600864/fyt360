#!/usr/bin/env node
/**
 * E2E：订单同步「四问」回归（D先生 2026-10-04）
 *
 * 覆盖本轮定位并修掉的缺陷：
 *   问1 下单/完成/状态更新时间三列必须分开且语义正确（错位是平台延迟，不是数据错）
 *   问2 订单类型必须细分到渠道（不能只有「CPS 供应链」一档）
 *   问3 电影票/点餐/充值三个接口路径与参数名正确（之前 100% 404，从没同步过）
 *   问4 饿了么等长尾平台不能因窗口过窄漏单（D先生点名单 4064786215607488142）
 *
 * ⛔ 本脚本断言的是**上游真实响应 + 库内真实数据**，不是「函数返回非空」。
 *    上一轮的教训：E2E 全绿但线上只入 2/1011 行 —— 断言的是算法，没断言数据。
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
async function q(sql, parameters = []) {
  const r = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
  });
  return JSON.parse(await r.text());
}
function md5(s) { return createHash('md5').update(s, 'utf8').digest('hex').toLowerCase(); }
function signOf(p, apikey, secret) {
  const sp = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const w = `apikey=${apikey}&secret=${secret}`;
  return md5(`${w}&${sp}&${w}`);
}
async function hjk(path, body, { signed, secret, apikey } = {}) {
  const p = { ...body };
  if (signed) p.sign = signOf(p, apikey, secret);
  p.apikey = apikey;
  const r = await fetch(`https://api-gw.haojingke.com/index.php/v2/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(p).toString(),
  });
  const t = await r.text();
  if (!t.trim().startsWith('{')) return { httpStatus: r.status, isJson: false };
  return { ...JSON.parse(t), isJson: true };
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log(`  ${cond ? '✅' : '❌'} ${msg}`); };

const cfg = (await q(`SELECT apikey, api_secret FROM provider_config WHERE provider='mayixingqiu' LIMIT 1`))[0];
const { apikey, api_secret: secret } = cfg;
const now = Math.floor(Date.now() / 1000);
const S = (h) => String(now - h * 3600);

// ══════════════════════════════════════════════════════════════════
console.log('\n【问 3】三类签名接口：路径 + 分页参数名 + 时间参数名（之前全部 404）');
// ══════════════════════════════════════════════════════════════════
const PATH_CASES = [
  { name: '点餐 diancan/orderlist', path: 'diancan/orderlist', body: { page: '1', limit: '20', starttime: S(720), endtime: String(now) } },
  { name: '电影票 movie/orderlist', path: 'movie/orderlist', body: { page: '1', limit: '20', starttime: S(720), endtime: String(now) } },
  { name: '充值 recharge/orderlist', path: 'recharge/orderlist', body: { page: '1', limit: '20', starttime: '1650000000', endtime: String(now) } },
];
for (const c of PATH_CASES) {
  const r = await hjk(c.path, c.body, { signed: true, secret, apikey });
  ok(r.isJson && r.status_code === 200,
    `${c.name} → status_code=200（修复前路径 open/dcorder、open/movieorder 全部 404）实际=${r.isJson ? r.status_code + '/' + r.message : 'HTTP ' + r.httpStatus + '(非JSON)'}`);
}

// recharge 分页参数名：必须 page/limit（pageindex/pagesize 上游不认 → 0 行）
const rBad = await hjk('recharge/orderlist', { pageindex: '1', pagesize: '20' }, { signed: true, secret, apikey });
const rGood = await hjk('recharge/orderlist', { page: '1', limit: '20' }, { signed: true, secret, apikey });
ok(rGood.isJson && rGood.status_code === 200 && (rGood.data?.total ?? 0) > 0,
  `recharge 用 page/limit → total=${rGood.data?.total}（829 单历史单，证明路径+参数都对）`);
ok((rGood.data?.list ?? []).length > (rBad.data?.list ?? []).length,
  `recharge 分页参数 page/limit 优于 pageindex/pagesize（后者返回 ${(rBad.data?.list ?? []).length} 行，前者 ${(rGood.data?.list ?? []).length} 行）`);

// recharge 时间参数名：updateTimeStart 会让签名直接失败
const rWrongTime = await hjk('recharge/orderlist', { page: '1', limit: '20', updateTimeStart: S(24), updateTimeEnd: String(now) }, { signed: true, secret, apikey });
ok(rWrongTime.isJson && rWrongTime.status_code !== 200,
  `recharge 用错时间参数名 updateTimeStart → 报「${rWrongTime.message}」（不认的 key 会让 strparam 对不上）`);

// 签名包裹：单纯 secret= 不行，必须 apikey+secret 复合
function signOnlySecret(p) {
  const sp = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  return md5(`secret=${secret}&${sp}&secret=${secret}`);
}
const pBad = { page: '1', limit: '20', starttime: S(720), endtime: String(now) };
const rBadSign = await hjk('movie/orderlist', { ...pBad, sign: signOnlySecret(pBad), apikey });
ok(rBadSign.isJson && rBadSign.status_code !== 200,
  `签名只用 secret= 包裹 → 报「${rBadSign.message}」（必须 apikey+secret 复合包裹）`);

// ══════════════════════════════════════════════════════════════════
console.log('\n【问 4】长尾平台漏单：窗口宽度必须覆盖状态更新时刻（D先生点名 4064786215607488142）');
// ══════════════════════════════════════════════════════════════════
const TARGET = '4064786215607488142';
const rT = await hjk('index/pforder', { page: '1', limit: '10', querytype: '2', pf_type: '', extend_id: '', orderid: TARGET, starttime: '', endtime: '' }, { apikey });
const target = rT?.data?.data?.[0];
ok(!!target, `上游直查目标单 ${TARGET} 命中（pf_type=${target?.pf_type}）`);
if (target) {
  const lagH = ((now - target.updated_at) / 3600).toFixed(1);
  console.log(`     目标单 updated_at 距今 ${lagH}h（下单距今 ${((now - target.ordertime) / 3600).toFixed(1)}h）`);
  const r72 = await hjk('index/pforder', { page: '1', limit: '10', querytype: '2', pf_type: '', extend_id: '', orderid: TARGET, starttime: S(72), endtime: String(now) }, { apikey });
  const r720 = await hjk('index/pforder', { page: '1', limit: '10', querytype: '2', pf_type: '', extend_id: '', orderid: TARGET, starttime: S(720), endtime: String(now) }, { apikey });
  ok((r72?.data?.total ?? 0) === 0, '72h 窗口拉不到该单（实测 total=0，这就是「饿了么不同步」的直接原因）');
  ok((r720?.data?.total ?? 0) >= 1, `720h 窗口能拉到（total=${r720?.data?.total}）→ windowHours('pf') 必须是 720 不是 72`);

  const inDb = await q(`SELECT order_sn, provider, biz_category, biz_channel, platform_status,
      paid_at::text, settled_at::text, platform_updated_at::text
    FROM "order" WHERE provider_order_sn = $1`, [TARGET]);
  ok(Array.isArray(inDb) && inDb.length === 1,
    `该单已入库：${JSON.stringify(inDb[0] ?? {}).slice(0, 200)}`);
  if (Array.isArray(inDb) && inDb[0]) {
    ok(inDb[0].provider === 'eleme', `落 provider=${inDb[0].provider}（pf_type=30 → eleme）`);
    ok(inDb[0].biz_channel === '饿了么', `biz_channel=${inDb[0].biz_channel}（问 2：类型细分生效）`);
    ok(inDb[0].platform_updated_at === target.updated_at
      ? true
      : Math.abs(new Date(inDb[0].platform_updated_at).getTime() / 1000 - target.updated_at) < 2,
    `platform_updated_at 与上游一致（${inDb[0].platform_updated_at} vs ${new Date(target.updated_at * 1000).toISOString()}）`);
  }
}

// ══════════════════════════════════════════════════════════════════
console.log('\n【问 1】三个时间列：语义分离 + 完整性 + 错位是平台延迟不是数据错');
// ══════════════════════════════════════════════════════════════════
const cols = await q(`SELECT column_name FROM information_schema.columns
  WHERE table_name = 'order' AND column_name IN ('paid_at','settled_at','platform_updated_at','biz_category','biz_channel')`);
const colNames = (Array.isArray(cols) ? cols : []).map((c) => c.column_name).sort();
ok(JSON.stringify(colNames) === JSON.stringify(['biz_category', 'biz_channel', 'paid_at', 'platform_updated_at', 'settled_at']),
  `迁移 035 五列齐备：${colNames.join(',')}`);

const nulls = await q(`SELECT count(*)::text AS total,
    count(*) FILTER (WHERE platform_updated_at IS NULL)::text AS upd_null,
    count(*) FILTER (WHERE paid_at IS NULL)::text AS paid_null
  FROM "order"`);
ok(Number(nulls[0]?.upd_null) === 0, `platform_updated_at 零 NULL（${nulls[0]?.total} 单全有水位 → 漏单根因已断）`);

const lag = await q(`SELECT provider, count(*)::text AS n,
    round(avg(EXTRACT(EPOCH FROM (platform_updated_at - paid_at))/3600)::numeric,1)::text AS avg_lag_h,
    round(max(EXTRACT(EPOCH FROM (platform_updated_at - paid_at))/3600)::numeric,1)::text AS max_lag_h,
    count(*) FILTER (WHERE platform_updated_at < paid_at - interval '10 min')::text AS badly_reversed
  FROM "order" WHERE provider <> 'self' AND platform_updated_at IS NOT NULL AND paid_at IS NOT NULL
  GROUP BY 1 ORDER BY count(*) DESC`);
console.table(lag);
const badTotal = (Array.isArray(lag) ? lag : []).reduce((s, r) => s + Number(r.badly_reversed ?? 0), 0);
ok(badTotal === 0, `无「更新时间早于下单 10 分钟以上」的逻辑倒挂（实测 ${badTotal} 条；pdd 有 114 条差 1~2 秒属字段精度差，不是错）`);

const lagMax = Math.max(...(Array.isArray(lag) ? lag : []).map((r) => Number(r.max_lag_h ?? 0)));
ok(lagMax > 100, `最大错位 ${lagMax}h 证实「下单/状态更新」严重分离 → 窗口必须按 platform_updated_at 走`);

// ══════════════════════════════════════════════════════════════════
console.log('\n【问 2】订单类型细分：不能只有「CPS 供应链」一档');
// ══════════════════════════════════════════════════════════════════
const cats = await q(`SELECT biz_category, count(*)::text AS n,
    string_agg(DISTINCT biz_channel, ',') AS channels
  FROM "order" WHERE biz_category IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC`);
console.table(cats);
const catCount = Array.isArray(cats) ? cats.length : 0;
ok(catCount >= 4, `业务分类 ≥4 档（实测 ${catCount}：自营/本地生活/电商/点餐…）`);
const channels = await q(`SELECT count(DISTINCT biz_channel)::text AS c FROM "order" WHERE biz_channel IS NOT NULL`);
ok(Number(channels[0]?.c) >= 8, `渠道细分 ≥8 个（实测 ${channels[0]?.c} 个：京东/拼多多/淘宝/美团/饿了么/滴滴/点餐/自营…）`);

// ══════════════════════════════════════════════════════════════════
console.log('\n【回归】pf_type 让位 v1 仍生效 + 分段不截断');
// ══════════════════════════════════════════════════════════════════
const leaked = await q(`SELECT count(*)::text AS n FROM "order"
  WHERE goods_snapshot ? 'pfType' AND (goods_snapshot->>'pfType')::int IN (1,2,3,6)`);
ok(Number(leaked[0]?.n) === 0, '库中无 pfType 1/2/3/6 的 pforder 单（仍让位 v1 联盟，避免金额覆盖）');

const counts = await q(`SELECT provider, count(*)::text AS n FROM "order" GROUP BY 1 ORDER BY count(*) DESC`);
console.table(counts);

console.log(`\n${'='.repeat(60)}\n通过 ${pass} / ${pass + fail}${fail ? `，失败 ${fail}` : '  全部通过 ✅'}\n${'='.repeat(60)}`);
process.exit(fail ? 1 : 0);
