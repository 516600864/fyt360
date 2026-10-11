// verify-settle-config.mjs — 结算配置站点级化 E2E（docs/结算配置站点级化设计评审.md §5）
// 纪律：断言自造数据 · 连跑两次全绿 · 进场/退场清零
// 策略：自造临时站点（status=inactive 不干扰业务）+ owner/非owner 测试号，断言后全量退场
import 'dotenv/config';
import { pool } from '../../server/src/db/client.js';

const BASE = 'https://mk.fyt360.cn';
const results = [];
let passed = 0, failed = 0;
const ok = (cond, label, extra = '') => {
  results.push(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  cond ? passed++ : failed++;
};

const login = async (username, password) => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json();
  return j?.data?.token ?? j?.token ?? '';
};
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + '/api' + path, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* 403 空体 */ }
  return { status: r.status, j };
};

// ── 进场：临时站点 + 测试号 ───────────────────────────────────────
const ts = Date.now().toString(36);
const siteCode = `e2e_t_${ts}`;
const ownName = `e2e_own_${ts}`, nonName = `e2e_non_${ts}`, pwd = 'E2e@123456';

const siteIns = await pool.query(
  `INSERT INTO site (code, name, status) VALUES ($1, 'E2E临时站', 'pending') RETURNING site_id::text AS id`,
  [siteCode],
);
const siteId = siteIns.rows[0].id;
await pool.query(
  `INSERT INTO member_level (site_id, code, name, sort, ingot_price, self_rate, direct_rate, team_rate, status)
   SELECT $1::uuid, v.code, v.name, v.sort, v.ingot_price, v.self_rate, v.direct_rate, v.team_rate, 'active'
     FROM (VALUES ('L1','普通会员',1,0,0.05,0.02,0.01),('L2','白银会员',2,5000,0.08,0.04,0.02),('L3','黄金会员',3,20000,0.12,0.06,0.03)) AS v(code,name,sort,ingot_price,self_rate,direct_rate,team_rate)`,
  [siteId],
);
for (const k of ['ingot_rule', 'withdraw_rule', 'dist_alloc']) {
  await pool.query(`DELETE FROM platform_config WHERE key = $1 AND site_id = $2::uuid`, [k, siteId]);
}

const mkOwn = await pool.query(`INSERT INTO admin_user (username, password_hash, role, status) VALUES ($1, 'x', 'site_admin', 'active') RETURNING admin_id::text AS id`, [ownName]);
const mkNon = await pool.query(`INSERT INTO admin_user (username, password_hash, role, status) VALUES ($1, 'x', 'site_admin', 'active') RETURNING admin_id::text AS id`, [nonName]);
const ownId = mkOwn.rows[0].id, nonId = mkNon.rows[0].id;
await pool.query(`UPDATE admin_user SET password_hash = (SELECT password_hash FROM admin_user WHERE username='admin' LIMIT 1) WHERE admin_id::text = ANY($1::text[])`, [[ownId, nonId]]);
await pool.query(`INSERT INTO admin_user_site (admin_id, site_id, site_role, is_owner) VALUES ($1::bigint, $2::uuid, 'site_admin', TRUE)`, [ownId, siteId]);
await pool.query(`INSERT INTO admin_user_site (admin_id, site_id, site_role, is_owner) VALUES ($1::bigint, $2::uuid, 'site_admin', FALSE)`, [nonId, siteId]);

const adminToken = await login('admin', process.env.ADMIN_INIT_PASSWORD);
const ownToken = await login(ownName, process.env.ADMIN_INIT_PASSWORD);  // 密码哈希拷贝自 admin
const nonToken = await login(nonName, process.env.ADMIN_INIT_PASSWORD);
ok(!!adminToken && !!ownToken && !!nonToken, '① 三号登录（admin/owner/non）', `admin=${!!adminToken} own=${!!ownToken} non=${!!nonToken}`);

// ── A. 权限 ──────────────────────────────────────────────────────
const ownPatch = await call('PATCH', `/admin/commission/levels/L2?site=${siteCode}`, { ingot_price: 8888 }, ownToken);
ok(ownPatch.status === 200, '② owner 可改本站档位', `HTTP ${ownPatch.status} ${ownPatch.j?.message ?? ''}`);
const nonPatch = await call('PATCH', `/admin/commission/levels/L2?site=${siteCode}`, { ingot_price: 7777 }, nonToken);
ok(nonPatch.status === 403 && nonPatch.j?.code === 'NOT_SITE_OWNER', '③ 非 owner 403 NOT_SITE_OWNER', `HTTP ${nonPatch.status} ${nonPatch.j?.code ?? ''}`);
const noSitePatch = await call('PATCH', `/admin/commission/levels/L2?site=${siteCode}`, { ingot_price: 7777 }, 'fake.token.here');
ok(noSitePatch.status === 401, '④ 未登录 401', `HTTP ${noSitePatch.status}`);

// ── B. 站点隔离 ──────────────────────────────────────────────────
const e2eCfg = await call('GET', `/admin/commission/config?site=${siteCode}`, null, adminToken);
const e2eL2 = e2eCfg.j?.data?.levels?.find((l) => l.code === 'L2')?.ingot_price;
ok(e2eL2 === 8888, '⑤ 临时站 L2=8888 生效', `实际 ${e2eL2}`);
const niwoCfg = await call('GET', '/admin/commission/config?site=niwo', null, adminToken);
const niwoL2 = niwoCfg.j?.data?.levels?.find((l) => l.code === 'L2')?.ingot_price;
ok(niwoL2 === 5000, '⑥ niwo L2 不受影响（5000）', `实际 ${niwoL2}`);
ok(e2eCfg.j?.data?.stats !== undefined, '⑦ stats 按站返回');

// ── C. 规则块按站 ────────────────────────────────────────────────
const wdPut = await call('PUT', `/admin/commission/config/withdraw_rule?site=${siteCode}`, { value: { min_amount: 5, fee_rate: 0, per_txn_limit: 5000 } }, ownToken);
ok(wdPut.status === 200, '⑧ owner 写本站提现规则', `HTTP ${wdPut.status}`);
const wdGet = await call('GET', `/admin/withdraw/summary?site=${siteCode}`, null, adminToken);
ok(Number(wdGet.j?.data?.rule?.min_amount) === 5, '⑨ 临时站 min_amount=5 生效', `实际 ${wdGet.j?.data?.rule?.min_amount}`);
const wdSiteA = await call('GET', '/admin/withdraw/summary?site=site-a', null, adminToken);
ok(Number(wdSiteA.j?.data?.rule?.min_amount) !== 5, '⑩ site-a 提现规则不受影响', `实际 ${wdSiteA.j?.data?.rule?.min_amount}`);

const igPut = await call('PUT', `/admin/commission/config/ingot_rule?site=${siteCode}`, { value: { self_return: 200, invite_reward: 300 } }, ownToken);
ok(igPut.status === 200, '⑪ owner 写本站元宝规则', `HTTP ${igPut.status}`);
const distPut = await call('PUT', `/admin/marketing/dist-switch?site=${siteCode}`, { items: [{ key: 'direct', label: '直推分佣', on: false }] }, ownToken);
ok(distPut.status === 200, '⑫ owner 写本站分佣开关', `HTTP ${distPut.status}`);

// ── D. siteIngotRateSelfReturn fallback 链 ──────────────────────
const { siteIngotRateSelfReturn } = await import('../../server/src/jobs/ordersync.js');
const e2eRate = await siteIngotRateSelfReturn(siteId);
ok(Number(e2eRate) === 200, '⑬ 临时站 self_return=200 真实生效', `实际 ${e2eRate}`);
const siteAId = (await pool.query(`SELECT site_id::text AS id FROM site WHERE code='site-a'`)).rows[0].id;
const siteARate = await siteIngotRateSelfReturn(siteAId);
ok(Number(siteARate) === 100, '⑭ site-a 走默认（100）', `实际 ${siteARate}`);

// ── 退场：全量清零 ────────────────────────────────────────────────
await pool.query(`DELETE FROM platform_config WHERE site_id = $1::uuid`, [siteId]);
await pool.query(`DELETE FROM member_level WHERE site_id = $1::uuid`, [siteId]);
await pool.query(`DELETE FROM admin_user_site WHERE admin_id::text = ANY($1::text[])`, [[ownId, nonId]]);
await pool.query(`DELETE FROM admin_user WHERE admin_id::text = ANY($1::text[])`, [[ownId, nonId]]);
await pool.query(`DELETE FROM site WHERE site_id = $1::uuid`, [siteId]);
const leftUsers = await pool.query(`SELECT COUNT(*)::int AS n FROM admin_user WHERE username LIKE 'e2e\_%' ESCAPE '\\'`);
const leftSites = await pool.query(`SELECT COUNT(*)::int AS n FROM site WHERE code LIKE 'e2e\_%' ESCAPE '\\'`);
ok(leftUsers.rows[0].n === 0 && leftSites.rows[0].n === 0, '⑮ 退场清零（测试号+临时站）', `user=${leftUsers.rows[0].n} site=${leftSites.rows[0].n}`);

console.log(results.join('\n'));
console.log(`\n===== ${passed} 通过 / ${failed} 失败 =====`);
process.exit(failed > 0 ? 1 : 0);
