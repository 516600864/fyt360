// tb getorder 真实响应字段探测：拉一页最新订单，dump 单条记录全部字段
// 目的：确认实付价字段名（pay_price=0 但 commission>0 的根因）
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

// ⛔ 凭据只从 .env 取（HJK_APIKEY / HJK_API_KEY），严禁硬编码真值——本仓库公开
const apikey = env.HJK_APIKEY ?? env.HJK_API_KEY;
if (!apikey) {
  console.error('缺少 HJK_APIKEY：请在项目根 .env 配置蚂蚁星球 apikey 后重跑');
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, '0');
const bjStr = (d) => {
  const t = new Date(d.getTime() + 8 * 3_600_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
};

const end = new Date();
const start = new Date(end.getTime() - 2 * 3_600_000); // tb 时间窗上限 3h，取 2h 保险

const qs = new URLSearchParams({
  apikey,
  start_time: bjStr(start),
  end_time: bjStr(end),
  page_no: '1',
  page_size: '5',
  get_tkl: '0',
});

const url = `http://api-gw.haojingke.com/index.php/v1/api/tb/getorder?${qs}`;
const r = await fetch(url);
const text = await r.text();
let j;
try { j = JSON.parse(text); } catch { console.log('非 JSON:', r.status, text.slice(0, 300)); process.exit(1); }
console.log('code:', j.code ?? j.status_code ?? j.status, '| msg:', j.msg ?? j.message ?? '');

const results = j?.data?.results ?? {};
const dto = results.publisher_order_dto;
const list = Array.isArray(dto) ? dto : dto && typeof dto === 'object' ? [dto] : [];
console.log('本页条数:', list.length);
if (list[0]) {
  console.log('--- 首条订单全字段:');
  for (const [k, v] of Object.entries(list[0])) {
    console.log(`  ${k} = ${JSON.stringify(v)}`);
  }
} else {
  console.log('原始 data 键:', Object.keys(j?.data ?? {}));
  console.log(JSON.stringify(j).slice(0, 800));
}
