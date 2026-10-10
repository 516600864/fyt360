// 探针：万能转链 /v2/api/open/union 逐形态实测（2026-10-09 D先生 同意后执行）
// 目标：核清五问 —— ①佣金字段 ②归因 extend_id ③tkl ④jd 数字sku ⑤actid 必填性
// 铁律：判定权交上游；只读探针，不改任何业务代码。
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
async function q(sql, parameters = []) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(res.status + ' ' + text.slice(0, 300));
  return JSON.parse(text);
}

const rows = await q(
  `SELECT site_id, apikey, status, test_status FROM provider_config WHERE provider = 'mayixingqiu' LIMIT 5`,
);
console.log('== provider_config mayixingqiu ==');
for (const r of rows) console.log(JSON.stringify(r));
const key = rows.find((r) => r.status === 'active' && r.test_status === 'passed')?.apikey;
if (!key) throw new Error('无可用 apikey');
console.log('apikey 尾4位:', key.slice(-4));

const API = 'https://api-gw.haojingke.com/index.php/v2/api/open/union';

async function probe(label, params) {
  const qs = new URLSearchParams({ apikey: key, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) });
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${API}?${qs}`, { signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    let j = null;
    try { j = JSON.parse(text); } catch { /* 非 JSON */ }
    if (!j) {
      console.log(`\n[${label}] HTTP ${res.status} ${Date.now() - t0}ms 非 JSON: ${text.slice(0, 160)}`);
      return;
    }
    const d = Array.isArray(j.data) ? j.data[0] : j.data;
    const brief = {
      status_code: j.status_code, message: (j.message ?? '').slice(0, 60),
      pf: d?.pf, status: d?.status,
      url: String(d?.url ?? d?.shorturl ?? '').slice(0, 70),
      we_app: d?.we_app_info ? `${d.we_app_info.app_id} | ${(d.we_app_info.path ?? '').slice(0, 60)}` : null,
      tkl: d?.tkl ? String(d.tkl).slice(0, 24) : '',
      // 佣金字段地毯式扫描（键名不确定 → 全对象找 commission/佣金/rate）
      commission_keys: d ? Object.keys(d).filter((k) => /comm|rate|佣金|rebate|fee/i.test(k)) : [],
      goods_price: d?.goods?.goods_price ?? null,
    };
    console.log(`\n[${label}] ${Date.now() - t0}ms ${JSON.stringify(brief)}`);
  } catch (e) {
    console.log(`\n[${label}] FAIL ${e.message?.slice(0, 120)}`);
  }
}

// ── 探针矩阵（样例取自官方文档 + 既有实测样例）──────────────────────────
// ① jd 家族
await probe('jd u.jd.com 合一链接', { text: 'https://u.jd.com/F1aEq4R' });
await probe('jd 字符串itemId', { text: 'y84Q6Una8DWPUVvOUc6BPUVvOUc6B4_3yuxuQptcPQUMJeDQR' });
await probe('jd item.jd.com 数字sku', { text: 'https://item.jd.com/100012043978.html' });
// ② tb 淘口令
await probe('tb 淘口令11位', { text: 'k4PP2RdTYtaxZGx86WIGw9uAUJ-bMmA9vJsBM2vY89eTo' });
// ③ pdd
await probe('pdd goods_sign', { text: 'E9j2eAJA2ANHvLqxwfbAsQceUCnEjOfG_JQbbdKyAzG' });
// ④ vip
await probe('vip axr口令(格式样例)', { text: 'axr://test123456' });
// ⑤ 美团 / 饿了么
await probe('美团 skuViewId', { text: 'G56RMTNJ2FZ373P4E2VNPXEGFY' });
await probe('美团关键词文本', { text: '美团外卖红包' });
await probe('饿了么关键词文本', { text: '淘宝闪购 饿了么红包' });
// ⑥ extend_id 归因探针（对照：同 tb 样例带 extend_id）
await probe('tb口令+extend_id', { text: 'k4PP2RdTYtaxZGx86WIGw9uAUJ-bMmA9vJsBM2vY89eTo', extend_id: '999999' });
// ⑦ 免参校验：空 text 无 actid
await probe('空参对照', {});

console.log('\n== 对照组：旧接口 tb getunionurl（佣金字段现状基准） ==');
{
  const qs = new URLSearchParams({ apikey: key, item_id: 'k4PP2RdTYtaxZGx86WIGw9uAUJ-bMmA9vJsBM2vY89eTo', get_tkl: '1', title: 'FYT360 精选好物' });
  const res = await fetch(`https://api-gw.haojingke.com/index.php/v1/api/tb/getunionurl?${qs}`);
  const j = await res.json().catch(() => null);
  const d = (typeof j?.data === 'object' && j?.data) || {};
  console.log(JSON.stringify({
    url: String(d.coupon_click_url ?? '').slice(0, 60),
    tkl: d.coupon_full_tpwd ? String(d.coupon_full_tpwd).slice(0, 20) : '',
    commission: d.commission ?? null,
    has_goods_name: !!d.goods_name,
  }));
}
