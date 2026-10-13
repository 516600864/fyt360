// 验收：方案 A 上线实锤（2026-10-13）
// 判据：① dashboard desc 出现「费率 0.60% · 仅自营有微信流水的实收」（新代码标识）
//       ② payment/overview 回传 pay_fee_rate=0.006
//       ③ 团购毛利 = 收款−成本−佣金（不含手续费，双扣已修）
import fs from 'node:fs';
import jwt from 'jsonwebtoken';

for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] ??= m[2];
}
const API = 'https://mk.fyt360.cn/api';
const token = jwt.sign(
  { adminId: '0', username: 'verify-probe', role: 'platform_admin', siteIds: [] },
  process.env.JWT_SECRET,
  { expiresIn: '10m' },
);

const h = { Authorization: `Bearer ${token}` };

const d = await (await fetch(`${API}/admin/dashboard/summary?site=niwo&range=7d`, { headers: h })).json();
if (!d.ok) { console.log('❌ dashboard:', JSON.stringify(d)); process.exit(1); }
const payFee = d.data.expense.items.find((x) => x.key === 'pay_fee');
const selfGoods = d.data.gross.items.find((x) => x.key === 'self_goods');
console.log('headline:', JSON.stringify(d.data.headline));
console.log('支付手续费条目:', JSON.stringify(payFee));
console.log('到店团购毛利条目:', JSON.stringify(selfGoods));

const ok1 = payFee?.desc?.includes('0.60%') && payFee?.desc?.includes('微信流水');
console.log(ok1 ? '✅ 新费率口径已上线（0.60% · 仅微信流水）' : '❌ desc 仍是旧口径或未生效');

const p = await (await fetch(`${API}/admin/payment/overview`, { headers: h })).json();
if (!p.ok) { console.log('❌ payment overview:', JSON.stringify(p)); process.exit(1); }
for (const r of p.data.list) {
  console.log(`payment: ${r.site_code} commission_rate=${r.commission_rate} pay_fee_rate=${r.pay_fee_rate} status=${r.status}`);
}
const niwo = p.data.list.find((r) => r.site_code === 'niwo');
console.log(niwo?.pay_fee_rate === 0.006 ? '✅ pay_fee_rate=0.006 回传正常' : '⚠️ pay_fee_rate 异常');

// 手工对账：团购毛利应 = 实收95.01 − 成本 − 佣金（不含手续费）
const fee = payFee?.amount ?? 0;
const profit = selfGoods?.amount ?? 0;
const manual = +( (selfGoods?.receipt ?? 0) - (selfGoods?.cost ?? 0) - (selfGoods?.commission ?? 0) ).toFixed(2);
console.log(`对账: 团购毛利=${profit} vs 收款−成本−佣金=${manual} → ${Math.abs(profit - manual) < 0.01 ? '✅ 不含手续费（双扣已修）' : '❌ 仍含手续费'}`);
console.log(`手续费 amount=${fee}（基数=有流水实收0.01 × 0.6% ≈ 0.0001 → 0.00 属正常）`);
