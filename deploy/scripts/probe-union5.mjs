// 探针第五轮（纠错定责）：变量隔离矩阵 —— apikey × extend_id × 文案形态
// 背景：D先生 实测 jd/美团/pdd/vip 全通（带 extend_id），我的第一轮探针全挂（无 extend_id、裸链接、另一把 key）
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const r = await fetch(GATEWAY, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
  body: JSON.stringify({ sql: "SELECT site_id, apikey FROM provider_config WHERE provider='mayixingqiu' AND status='active' AND test_status='passed'", parameters: [], role: 'cloudbase_postgres' }),
});
const keys = [...new Map((await r.json()).map((x) => [x.apikey, x])).values()];
console.log('可用 key:', keys.map((k) => `${k.apikey.slice(0, 4)}…(site ${k.site_id.slice(0, 8)})`).join(' '));
const keyA = keys.find((k) => k.apikey.startsWith('b47c'))?.apikey ?? keys[0].apikey; // site-a
const keyB = keys.find((k) => k.apikey.startsWith('2403'))?.apikey ?? keys[keys.length - 1].apikey; // D先生用的

const API = 'https://api-gw.haojingke.com/index.php/v2/api/open/union';

async function probe(label, apikey, params) {
  const qs = new URLSearchParams({ apikey, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  let j = null;
  for (let i = 0; i < 3 && !j; i++) {
    try {
      const res = await fetch(`${API}?${qs}`);
      j = await res.json().catch(() => null);
    } catch (e) {
      if (i === 2) { console.log(`\n[${label}] NET FAIL ${e.cause?.code ?? e.message}`); return; }
      await new Promise((r2) => setTimeout(r2, 800));
    }
  }
  const d = Array.isArray(j?.data) ? j.data[0] : j?.data;
  console.log(`\n[${label}] ${JSON.stringify({
    sc: j?.status_code, pf: d?.pf, st: d?.status,
    url: String(d?.url ?? '').slice(0, 55),
    we: d?.we_app_info?.app_id ?? '',
    price: d?.goods?.goods_price ?? '',
  })}`);
}

const JD_TEXT = 'https://u.jd.com/Fg1fZX6'; // D先生真实样例链接
const JD_TEXT_FULL = '【美津浓户外梭织风衣男士单层防风连帽外套男 白色【春秋款】 2XL 】 【在售价】279元 【券后价】269元 --------------- 【下单链接】https://u.jd.com/Fg1fZX6';
const TB_KL = 'k4PP2RdTYtaxZGx86WIGw9uAUJ-bMmA9vJsBM2vY89eTo';
const MT_LINK = '【先领】美团外卖通用红包 👉http://dpurl.cn/45c1Jzzz'; // D先生真实样例

// ── jd 变量隔离：key × extend_id × 文案 ──
await probe('jd裸链 Akey 无ext', keyA, { text: JD_TEXT });
await probe('jd裸链 Akey ext25', keyA, { text: JD_TEXT, extend_id: '25' });
await probe('jd裸链 Bkey 无ext', keyB, { text: JD_TEXT });
await probe('jd裸链 Bkey ext25', keyB, { text: JD_TEXT, extend_id: '25' });
await probe('jd文案 Bkey ext25(复刻D先生)', keyB, { text: JD_TEXT_FULL, extend_id: '25' });
// ── tb 口令 + extend_id（第一轮成功的复核）──
await probe('tb口令 Akey ext25', keyA, { text: TB_KL, extend_id: '25' });
// ── 美团真实短链（第一轮只试了关键词没带链接）──
await probe('美团短链 Akey ext25', keyA, { text: MT_LINK, extend_id: '25' });
await probe('美团短链 Bkey ext25', keyB, { text: MT_LINK, extend_id: '25' });
// ── vip 真实短链 ──
await probe('vip短链 Akey ext25', keyA, { text: 'https://t.vip.com/pqnylb', extend_id: '25' });
