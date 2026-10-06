/**
 * 会员管理（51 屏 + 39B 抽屉）E2E：
 *  1 登录 → 2 列表结构 → 3 搜索 → 4 详情 360 → 5 四域子资源 → 6 调账闭环（+/- 对冲 + 留痕）→ 7 禁用/启用 → 8 注销（合成用户）
 */
const BASE = 'https://mk.fyt360.cn';
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:') });
let pass = 0, fail = 0;
const ok = (cond, name, note = '') => { console.log((cond ? '✅' : '❌'), name, note ? `— ${note}` : ''); cond ? pass++ : fail++; };

const G = 'https://' + process.env.TCB_ENV + '.api.tcloudbasegateway.com/v1/rdb/exec-pgsql';
const GH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.TCB_API_KEY };
const gdb = async (sql, parameters = []) => {
  const r = await fetch(G, { method: 'POST', headers: GH, body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }) });
  const t = await r.text();
  const j = JSON.parse(t);
  return Array.isArray(j) ? j : (j.rows ?? []);
};

const H = {};
let T = '';
async function api(path, opts = {}) {
  const r = await fetch(BASE + '/api' + path, { headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

(async () => {
  // 1 登录
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INIT_PASSWORD }),
  });
  const lj = await lr.json();
  T = lj?.data?.token ?? '';
  Object.assign(H, { Authorization: `Bearer ${T}` });
  ok(!!T, '管理员登录');

  // 2 列表结构
  const l1 = await api('/admin/members?page=1&size=10');
  ok(l1.status === 200 && Array.isArray(l1.j?.data?.items), '会员列表返回 items', `${l1.j?.data?.items?.length} 条 / 核销员 ${l1.j?.data?.verifiers}`);
  const row0 = l1.j?.data?.items?.[0];
  ok(row0 && ['user_id', 'level', 'ingot_balance', 'order_count', 'commission_total', 'is_verifier', 'status'].every((k) => k in row0), '列表项字段齐全（8 列口径）');

  // 3 搜索 user_id=10
  const l2 = await api('/admin/members?q=10&page=1&size=5');
  ok(l2.j?.data?.items?.some((x) => x.user_id === 10), '按 user_id 搜索命中', `共 ${l2.j?.data?.total}`);

  // 4 详情 360
  const d = await api('/admin/members/10');
  ok(d.j?.ok && d.j?.data?.stats && 'openid' in d.j.data, '详情 360 视图（openid/unionid/统计四宫格）', `元宝 ${d.j?.data?.stats?.ingot_balance} / 订单 ${d.j?.data?.stats?.order_count}`);

  // 5 四域子资源 + 券码
  for (const p of ['orders', 'txs', 'coupons', 'verifies', 'codes']) {
    const s = await api(`/admin/members/10/${p}`);
    ok(s.status === 200 && s.j?.ok && Array.isArray(s.j?.data?.items), `域·${p} 可用`, `${s.j?.data?.items?.length} 条`);
  }

  // 6 调账闭环：+100 / -100 对冲，校验 balance_after 与流水留痕
  const before = d.j?.data?.stats?.ingot_balance ?? 0;
  const a1 = await api('/admin/members/10/adjust', { method: 'POST', body: JSON.stringify({ amount: 100, remark: 'E2E 调账测试（+）' }) });
  ok(a1.j?.ok && a1.j?.data?.balance_after === before + 100, '调账 +100 → 余额同步', `after=${a1.j?.data?.balance_after}`);
  const a2 = await api('/admin/members/10/adjust', { method: 'POST', body: JSON.stringify({ amount: -100, remark: 'E2E 调账测试（−）对冲回收' }) });
  ok(a2.j?.ok && a2.j?.data?.balance_after === before, '调账 -100 → 对冲还原', `after=${a2.j?.data?.balance_after}`);
  const txs = await gdb(`SELECT ref_id, amount, remark FROM ingot_tx WHERE user_id = 10 AND type = 'ADMIN_ADJUST' ORDER BY created_at DESC LIMIT 2`);
  ok(txs.length >= 2 && txs.every((t) => String(t.remark || '').includes('[管理员调账]')), '调账流水留痕（ADMIN_ADJUST ×2）', txs.map((t) => t.ref_id).join(','));
  const audits = await gdb(`SELECT action FROM admin_audit_log WHERE action = 'member.adjust' ORDER BY created_at DESC LIMIT 2`);
  ok(audits.length >= 2, '调账审计日志留痕（admin_audit_log）', `${audits.length} 条`);
  // 负超额拒绝
  const a3 = await api('/admin/members/10/adjust', { method: 'POST', body: JSON.stringify({ amount: -99999999, remark: 'E2E 超额' }) });
  ok(a3.status === 400 || a3.status === 409, '扣减超额被拒（单笔上限 400 / 余额不足 409 双守卫）', `HTTP ${a3.status}`);

  // 7 禁用/启用
  const b1 = await api('/admin/members/10/status', { method: 'POST', body: JSON.stringify({ status: 'banned' }) });
  const d2 = await api('/admin/members/10');
  ok(b1.j?.ok && d2.j?.data?.status === 'banned', '禁用生效');
  const b2 = await api('/admin/members/10/status', { method: 'POST', body: JSON.stringify({ status: 'active' }) });
  ok(b2.j?.ok, '启用还原');

  // 8 注销（合成测试用户，不动真实数据）
  const siteId = (await gdb(`SELECT site_id::text AS id FROM site LIMIT 1`))[0]?.id;
  const ins = await gdb(`INSERT INTO "user" (site_id, openid, nickname) VALUES ('${siteId}', 'e2e-dereg-${Date.now()}', 'e2e注销测试') RETURNING user_id`);
  const tid = ins[0]?.user_id;
  const dg = await api(`/admin/members/${tid}/deregister`, { method: 'POST', body: JSON.stringify({}) });
  const after = await gdb(`SELECT nickname, status, openid FROM "user" WHERE user_id = ${tid}`);
  ok(dg.j?.ok && after[0]?.nickname === '已注销用户' && after[0]?.status === 'banned' && after[0]?.openid === null, '注销 = 匿名化 + 禁用（openid 清空 → 静默登录永久不可命中）');
  const dg2 = await api(`/admin/members/${tid}/deregister`, { method: 'POST', body: JSON.stringify({}) });
  ok(dg2.status === 409, '重复注销被拒（409）');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 异常:', e.message); process.exit(1); });
