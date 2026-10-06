/**
 * 验证支付商户管理面（admin-payment）：
 * 1. GET overview（空态）→ 2. PUT 新建（伪凭据）→ 3. GET 回读掩码/布尔 → 4. PUT 仅改 status →
 * 5. 校验拒绝路径（坏商户号/坏密钥/坏 PEM）→ 6. DELETE 还原现场
 * 用法：node verify-payment-admin.mjs
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { connectDb } from './lib/db.mjs';
import { loadDotEnv } from './lib/common.mjs';

loadDotEnv();
const BASE = 'https://mk.fyt360.cn/api';
const SITE = process.env.PAY_TEST_SITE_ID ?? '07642761-7991-4357-bdc1-997462559e68';

const token = jwt.sign(
  { adminId: '00000000-0000-0000-0000-000000000000', username: 'verify-bot', role: 'platform_admin', siteIds: [] },
  process.env.JWT_SECRET, { expiresIn: '1h' },
);
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const db = await connectDb();
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? `  ${extra}` : ''}`);
  cond ? pass++ : fail++;
};

await sleep(5000); // 容器实例切换延迟

// 1. 空态 overview
let r = await call('GET', '/admin/payment/overview');
ok(r.status === 200 && r.j.ok && Array.isArray(r.j.data.list), 'GET overview 200', `kpis=${JSON.stringify(r.j.data?.kpis)}`);

// 2. 新建（伪凭据全量）
r = await call('PUT', `/admin/payment/${SITE}`, {
  mch_id: '1619123456', mch_key: 'a'.repeat(32), serial_no: '5157FBB671F5976A52B58A6BDCD5B7E2B64F8C9E',
  cert: pem, commission_rate: 0.15, status: 'active',
});
ok(r.status === 200 && r.j.ok, 'PUT 新建凭据 200', JSON.stringify(r.j.data ?? r.j.message));

// 3. 回读：掩码 + 布尔 + 不漏原文
r = await call('GET', '/admin/payment/overview');
const row = r.j.data?.list?.find((x) => x.site_id === SITE);
ok(!!row && row.configured && row.mch_masked === '1619****3456', '回读 configured + 商户号掩码', row?.mch_masked);
ok(!!row && row.has_key && row.has_cert && row.serial_masked?.endsWith('8C9E'), '密钥/私钥布尔 + 序列号掩码', row?.serial_masked);
const raw = JSON.stringify(r.j);
ok(!raw.includes('a'.repeat(32)) && !raw.includes('PRIVATE KEY'), '响应不含密钥/PEM 原文');
ok(row?.status === 'active' && Math.abs(row.commission_rate - 0.15) < 1e-9, '状态 + 佣金率 0.15 回读');

// 4. 仅改 status（停用→启用）
r = await call('PUT', `/admin/payment/${SITE}`, { status: 'disabled' });
ok(r.status === 200 && r.j.ok, 'PUT 仅 status → disabled');
r = await call('GET', '/admin/payment/overview');
ok(r.j.data.list.find((x) => x.site_id === SITE)?.status === 'disabled', '停用态回读');

// 5. 拒绝路径
r = await call('PUT', `/admin/payment/${SITE}`, { mch_id: '12345', mch_key: 'a'.repeat(32), serial_no: 'X', cert: pem });
ok(r.status === 400 && r.j.code === 'BAD_MCH_ID', '坏商户号 → 400 BAD_MCH_ID', r.j.message);
r = await call('PUT', `/admin/payment/${SITE}`, { mch_id: '1619123456', mch_key: 'short', serial_no: 'X'.repeat(40), cert: pem });
ok(r.status === 400 && r.j.code === 'BAD_MCH_KEY', '坏 APIv3 密钥 → 400 BAD_MCH_KEY');
r = await call('PUT', `/admin/payment/${SITE}`, { mch_id: '1619123456', mch_key: 'a'.repeat(32), serial_no: 'X'.repeat(40), cert: 'not-a-pem' });
ok(r.status === 400 && r.j.code === 'BAD_CERT', '坏 PEM → 400 BAD_CERT');
r = await call('PUT', `/admin/payment/${SITE}`, { mch_id: '1619123456', commission_rate: 5 });
ok(r.status === 400 && r.j.code === 'BAD_RATE', '佣金率 >1 → 400 BAD_RATE');

// 6. 还原现场
await db.query(`DELETE FROM site_payment WHERE site_id = $1::uuid`, [SITE]);
r = await call('GET', '/admin/payment/overview');
const clean = !r.j.data.list.find((x) => x.site_id === SITE)?.configured;
ok(clean, '清理还原：测试站点回未配置态');

console.log(`\n结果：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
