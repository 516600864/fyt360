// 探针第二轮：text + actid 组合（actid 取自 deploy/seed/actlist.json 实际活动）
// 104=【京东】国家补贴享8折 | 141=美团到店 | 89=饿了么天天领红包 | 1=美团外卖红包
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
async function q(sql) {
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters: [], role: 'cloudbase_postgres' }),
  });
  if (res.status !== 200) throw new Error(res.status + ' ' + (await res.text()).slice(0, 200));
  return JSON.parse(await res.text());
}
const rows = await q(`SELECT apikey FROM provider_config WHERE provider='mayixingqiu' AND status='active' AND test_status='passed' LIMIT 1`);
const key = rows[0]?.apikey;
if (!key) throw new Error('无可用 apikey');

const API = 'https://api-gw.haojingke.com/index.php/v2/api/open/union';

async function probe(label, params) {
  const qs = new URLSearchParams({ apikey: key, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')) });
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${API}?${qs}`, { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await res.json().catch(() => null);
    if (!j) { console.log(`\n[${label}] HTTP ${res.status} 非 JSON`); return; }
    const d = Array.isArray(j.data) ? j.data[0] : j.data;
    console.log(`\n[${label}] ${Date.now() - t0}ms ${JSON.stringify({
      status_code: j.status_code, message: (j.message ?? '').slice(0, 50),
      pf: d?.pf, status: d?.status,
      url: String(d?.url ?? '').slice(0, 80),
      we_app: d?.we_app_info?.app_id ? `${d.we_app_info.app_id} | ${(d.we_app_info.path ?? '').slice(0, 70)}` : null,
      price: d?.goods?.goods_price ?? null,
    })}`);
    if (d?.goods?.goods_name) console.log(`  goods_name: ${String(d.goods.goods_name).slice(0, 60)}`);
  } catch (e) {
    console.log(`\n[${label}] FAIL ${e.message?.slice(0, 100)}`);
  }
}

// jd + 国补活动
await probe('jd u.jd.com + actid104国补', { text: 'https://u.jd.com/F1aEq4R', actid: 104 });
await probe('jd item数字sku + actid104', { text: 'https://item.jd.com/100012043978.html', actid: 104 });
await probe('jd 3.cn短链 + actid104', { text: 'https://3.cn/1AbCdEf', actid: 104 });
// 美团 / 饿了么 + 对应活动
await probe('美团skuViewId + actid141到店', { text: 'G56RMTNJ2FZ373P4E2VNPXEGFY', actid: 141 });
await probe('美团关键词 + actid1外卖红包', { text: '美团外卖红包', actid: 1 });
await probe('饿了么关键词 + actid89领红包', { text: '饿了么红包', actid: 89 });
// tb 口令 + actid（cross-check 是否互相干扰）
await probe('tb口令 + actid104(错配对照)', { text: 'k4PP2RdTYtaxZGx86WIGw9uAUJ-bMmA9vJsBM2vY89eTo', actid: 104 });
