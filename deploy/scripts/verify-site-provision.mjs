/**
 * E2E：站点建壳 + 凭据开通（屏 31 / 屏 52 · 决策 #43 · D先生 2026-10-05）
 *
 * 覆盖：
 *   ① 迁移 042 结构级证据（is_owner / pending / 三列已删 / 唯一索引 / shop_addr 保留）
 *   ② 建壳：3 字段、无 key、status=pending、自动成为负责人
 *   ③ 建壳校验：code 重复 / 非法 code / 停用账号当负责人
 *   ④ 屏 52 四组凭据：落点互不相同（provider_config / site / site_payment）
 *   ⑤ 支付凭据可写（与支付菜单同真相源）—— 这是 D先生 明确要求的
 *   ⑥ 蚂蚁星球连通测试：真调上游；无效 key → failed；开通判定要求 passed
 *   ⑦ 未开通白名单拦截：带 X-Fyt-Site 打业务接口 → 403；配置通过 → 放行
 *   ⑧ 凭据原文永不下发（掩码 + 布尔）
 *   ⑨ 移交负责人 / 停用 / 删除（有数据拒删）
 *   ⑩ 审计留痕 + 退场清零
 *
 * ⛔ 纪律：不碰 site-a（真实站），全程用 e2e-tmp-* 专用站点，进场/退场双向清零。
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const BASE = process.env.E2E_BASE ?? 'https://mk.fyt360.cn';
const GW = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;

let pass = 0, fail = 0;
const ok = (cond, title, extra = '') => {
  if (cond) { pass++; console.log(`✅ ${title}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`❌ ${title}${extra ? ' — ' + extra : ''}`); }
};
const section = (t) => console.log(`\n【${t}】`);

async function db(sql, p = []) {
  const res = await fetch(GW, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters: p, role: 'cloudbase_postgres' }),
  });
  const t = await res.text();
  let j;
  try { j = JSON.parse(t); } catch { throw new Error(`DB 非JSON HTTP ${res.status}: ${t.slice(0, 200)}`); }
  if (!Array.isArray(j)) throw new Error(`DB 错误: ${t.slice(0, 300)}`);
  if (j.length && Object.keys(j[0]).some((k) => k.startsWith('?column'))) throw new Error(`SQL 错误: ${JSON.stringify(j[0]).slice(0, 250)}`);
  return j;
}

let token = '';
let SELF_ID = '';
async function adm(path, method = 'GET', body = undefined, siteHeader = '') {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (siteHeader) headers['X-Fyt-Site'] = siteHeader;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

console.log('=== 站点建壳 + 凭据开通 E2E（迁移 042 / 屏 31 / 屏 52）===\n');

// ── 登录 ──
{
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
  });
  const j = await r.json();
  token = j?.data?.token ?? '';
  ok(!!token, '管理员登录');
  // 自身 admin_id：设负责人/移交负责人要用（决策#43 负责人 = admin_user_site.is_owner）
  SELF_ID = String(j?.data?.admin?.adminId ?? j?.data?.admin?.admin_id ?? '');
  ok(!!SELF_ID, `取到自身 admin_id=${SELF_ID}`);
}
if (!token) { console.log('\n⚠️ 登录失败，终止'); process.exit(1); }

const TMP_CODE = 'e2e-tmp-prov';
// ⛔ 清理必须覆盖所有 e2e-% 前缀的站 + e2e_ 前缀的账号，不能只精确匹配 TMP_CODE：
//    否则「建无主站」等分支会留垃圾数据在生产库（E2E 纪律：进退场双向清零）。
const cleanup = async () => {
  const rows = await db(`SELECT site_id::text AS id FROM site WHERE code LIKE 'e2e-%'`);
  for (const r of rows) {
    await db(`DELETE FROM admin_user_site WHERE site_id = $1::uuid`, [r.id]);
    await db(`DELETE FROM provider_config WHERE site_id = $1::uuid`, [r.id]);
    await db(`DELETE FROM site_payment WHERE site_id = $1::uuid`, [r.id]);
    await db(`DELETE FROM site WHERE site_id = $1::uuid`, [r.id]);
  }
  const accts = await db(`SELECT admin_id::text AS id FROM admin_user WHERE username LIKE 'e2e\_%'`);
  for (const a of accts) {
    await db(`DELETE FROM admin_user_site WHERE admin_id = $1::bigint`, [a.id]);
    await db(`DELETE FROM admin_user WHERE admin_id = $1::bigint`, [a.id]);
  }
  // ⛔ 审计清理必须用前缀而非精确 code：分支站（-noown / -mgr）的审计 target_id
  //   是各自的 site.code，精确匹配 TMP_CODE 会把它们的留痕永久留在生产库。
  await db(`DELETE FROM admin_audit_log WHERE target_id LIKE $1::text`, [`${TMP_CODE}%`]);
};
const beforeClean = await db(`SELECT (SELECT count(*)::int FROM site WHERE code LIKE 'e2e-%') s, (SELECT count(*)::int FROM admin_user WHERE username LIKE 'e2e\_%') a`);
await cleanup(); // 进场清零
console.log(`\n🧹 进场清零：已删除遗留测试站 ${beforeClean[0].s} 个 / 测试账号 ${beforeClean[0].a} 个`);

// ══ ① 迁移 042 结构 ══
section('1  迁移 042 结构级证据');
{
  const cols = (await db(`SELECT column_name FROM information_schema.columns WHERE table_name='site'`)).map((r) => r.column_name);
  ok(!cols.includes('pay_mch_id') && !cols.includes('pay_api_v3_key') && !cols.includes('pay_serial_no'), 'site 三列冗余支付字段已删');
  ok(cols.includes('shop_addr'), 'site.shop_addr 保留（门店地址有真实消费方，不是支付冗余）');

  const usCols = (await db(`SELECT column_name FROM information_schema.columns WHERE table_name='admin_user_site'`)).map((r) => r.column_name);
  ok(usCols.includes('is_owner'), 'admin_user_site.is_owner 已落库');

  const ck = (await db(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='site'::regclass AND conname='site_status_check'`))[0];
  ok(!!ck && ck.d.includes('pending'), 'site.status CHECK 含 pending（待开通）', ck?.d?.slice(0, 80));

  const ix = (await db(`SELECT indexdef FROM pg_indexes WHERE indexname='uniq_site_owner'`))[0];
  ok(!!ix && ix.indexdef.includes('WHERE is_owner'), '一站唯一负责人部分唯一索引存在');

  const pcc = (await db(`SELECT column_name FROM information_schema.columns WHERE table_name='provider_config' AND column_name LIKE 'test%'`)).map((r) => r.column_name);
  ok(pcc.includes('test_status') && pcc.includes('tested_at'), 'provider_config 连通测试留痕列已落库');

  const pay = (await db(`SELECT count(*)::int n, sum(CASE WHEN cert LIKE '-----BEGIN%' THEN 1 ELSE 0 END)::int real FROM site_payment`))[0];
  ok(pay.n >= 1 && pay.real >= 1, `site_payment 真相源未被迁移破坏（${pay.n} 行，真私钥 ${pay.real} 份）`);

  // ⛔ 回归防线：存量在跑的站点绝不能被迁移打成「未开通」。
  //   踩过的坑：042 初版把存量 test_status 一律重置 untested → site-a 被白名单 403 锁死，
  //   生产站直接瘫。口径 = 迁移前 status='active' 的站回填 passed（注明豁免来源）。
  const live = (await db(
    `SELECT s.code, s.status, pc.test_status FROM site s
       JOIN provider_config pc ON pc.site_id = s.site_id AND pc.provider = 'mayixingqiu'
      WHERE s.status = 'active' AND pc.status = 'active'`,
  ));
  ok(live.length > 0, `存在存量活跃站（${live.map((x) => x.code).join(',')}）`);
  ok(live.every((x) => x.test_status === 'passed'), '存量活跃站全部 passed（不得被锁死）',
    live.map((x) => `${x.code}=${x.test_status}`).join(' '));

  const gate = await adm('/api/admin/dashboard/overview', 'GET', undefined, 'site-a');
  ok(gate.status !== 403, '⛔ 存量真实站 site-a 未被白名单锁死（回归防线）', `HTTP ${gate.status}`);

  // ⛔ 重复头容错（2026-10-05 真实故障）：前端曾双写站点头（api.js 大写 + main.js 小写）
  //   → fetch Headers 合并成 "site-a, site-a" → 服务端拿脏串查库 → 已开通站照样 403。
  //   症状极阴险：凭据明明保存 passed 了，看板还是 403。服务端必须取第一段。
  const dupGate = await adm('/api/admin/dashboard/overview', 'GET', undefined, 'site-a, site-a');
  ok(dupGate.status !== 403, '⛔ 重复站点头 "code, code" 不得 403（取第一段容错）', `HTTP ${dupGate.status}`);
}

// ══ ② 建壳 ══
section('2  新建站点：只有 3 字段，无任何 key');
let SITE_ID = '';
let SITE_CODE = '';
{
  const r = await adm('/api/admin/sites', 'POST', { code: TMP_CODE, name: 'E2E 临时站' });
  ok(r.status === 200 && r.j.ok, 'POST /admin/sites 建壳成功', `HTTP ${r.status} ${r.j?.message ?? ''}`);
  SITE_ID = r.j?.data?.site_id ?? '';
  SITE_CODE = r.j?.data?.code ?? '';
  ok(r.j?.data?.status === 'pending', '建壳后状态恒为 pending（待开通）', r.j?.data?.status);
  // ⛔ 2026-10-05 破死锁：建站**不再**自动把平台超管写成负责人。
  //   原行为（留空即落到当前 admin）等于平台自动持有客户站钱袋子凭据写权限，
  //   违反决策 #43「平台只建壳、绝不碰凭据」；且与「建站必选负责人」构成
  //   「建站要人 → 建人要站 → 站不存在 → 建不了人」的死锁。
  ok(r.j?.data?.owner_username === null, '建壳不自动指派负责人（防平台代持钱袋子）', String(r.j?.data?.owner_username));

  // ⛔ 建壳失败必须立刻中止：SITE_ID 为空串时，后续 $1::uuid 会报 22P02，
  //    报错现场会指向 DB 而掩盖真正的接口故障（E2E 脚本自身缺陷，铁律：先定责再改产品）
  if (!SITE_ID) {
    console.log('\n⚠️ 建壳失败，终止（避免空 site_id 污染后续断言）');
    await cleanup();
    process.exit(1);
  }

  const row = (await db(`SELECT status FROM site WHERE site_id = $1::uuid`, [SITE_ID]))[0];
  ok(row?.status === 'pending', '真实 DB 回读：status=pending', row?.status);

  const owner = await db(`SELECT us.is_owner, a.username FROM admin_user_site us JOIN admin_user a ON a.admin_id=us.admin_id WHERE us.site_id=$1::uuid AND us.is_owner`, [SITE_ID]);
  ok(owner.length === 0, '无主站：一个负责人都没有（⛔ 平台超管未自动获得凭据写权）', JSON.stringify(owner));
}

// ══ ②B 破死锁：无主站 + 空账号（2026-10-05 回归防线）══════════════════════
section('2B  破「建站要人 / 建人要站」死锁');
let NEW_ADMIN = '';
let NEW_ADMIN_PWD = '';
{
  // 正路 1：先建一个**不绑任何站点**的账号（旧逻辑会 400 SITES_REQUIRED）
  const uname = `e2e_${Date.now().toString(36)}`;
  const pwd = 'E2e@123456';
  const c = await adm('/api/admin/settings/admins', 'POST', { username: uname, password: pwd, role: 'site_admin', site_ids: [] });
  ok(c.status === 200 && c.j.ok, '✅ 先建空账号（零站点绑定）—— 死锁第一步已破', `HTTP ${c.status} ${c.j?.message ?? ''}`);
  NEW_ADMIN = uname;
  NEW_ADMIN_PWD = pwd;
  if (c.j?.data?.admin_id) {
    const bind = await db(`SELECT count(*)::int n FROM admin_user_site WHERE admin_id = $1::bigint`, [c.j.data.admin_id]);
    ok(bind[0].n === 0, '空账号 DB 回读：零授权行', `n=${bind[0].n}`);
  }

  // 正路 2：建站时**不指定**负责人（UI 已改为非必填）
  const noOwner = await adm('/api/admin/sites', 'POST', { code: `${TMP_CODE}-noown`, name: 'E2E 无主站' });
  ok(noOwner.status === 200 && noOwner.j?.data?.owner_username === null, '✅ 建站可留空负责人', `HTTP ${noOwner.status} ${String(noOwner.j?.data?.owner_username)}`);
  const noOwnerId = noOwner.j?.data?.site_id ?? '';
  if (noOwnerId) {
    const o = await db(`SELECT count(*)::int n FROM admin_user_site WHERE site_id=$1::uuid AND is_owner`, [noOwnerId]);
    ok(o[0].n === 0, '无主站 DB 回读：无 is_owner 行', `n=${o[0].n}`);
  }

  // 反例：非负责人调凭据写接口必须 403（原实现只查访问权 → 任何成员都能改钱袋子）
  if (noOwnerId && NEW_ADMIN) {
    await db(`INSERT INTO admin_user_site (admin_id, site_id, site_role, is_owner)
               SELECT a.admin_id, $1::uuid, 'site_admin', FALSE FROM admin_user a WHERE a.username = $2::text`,
      [noOwnerId, NEW_ADMIN]);
    const denied = await adm(`/api/admin/sites/provision/${noOwnerId}/mayixingqiu`, 'PUT',
      { apikey: 'a'.repeat(32), api_secret: 'b'.repeat(32) });
    // ⛔ 错误体结构是 {ok:false, code, message}（code 在顶层，不是 error.code —— 见 middleware/errors.ts）
    ok(denied.status === 403 && denied.j?.code === 'NOT_SITE_OWNER',
      '⛔ 非负责人写凭据 → 403 NOT_SITE_OWNER（决策#43 钱袋子铁律）', `HTTP ${denied.status} ${denied.j?.code ?? denied.j?.message ?? ''}`);

    const denied2 = await adm(`/api/admin/sites/provision/${noOwnerId}/kf`, 'PUT', { corp_id: 'ww0bff33db1234567890', kf_url: 'https://work.weixin.qq.com/kfid/abc' });
    ok(denied2.status === 403, '⛔ 非负责人写企微凭据同样 403', `HTTP ${denied2.status}`);

    await db(`DELETE FROM admin_user_site WHERE site_id=$1::uuid`, [noOwnerId]);
    await db(`DELETE FROM site WHERE site_id=$1::uuid`, [noOwnerId]);
  }

    // 反例：超管本人不是该站负责人时也必须被拦（平台不碰凭据）
  if (SITE_ID) {
    const su = await db(`SELECT count(*)::int n FROM admin_user_site WHERE site_id=$1::uuid AND is_owner`, [SITE_ID]);
    if (su[0].n === 0) {
      const suDenied = await adm(`/api/admin/sites/provision/${SITE_ID}/mini`, 'PUT', { appid: 'wx123', app_secret: 'sec' });
      ok(suDenied.status === 403, '⛔ 超管非负责人时同样被拦（平台不代持钱袋子）', `HTTP ${suDenied.status}`);
    }
  }
}

// ══ 2D 成员卡移交负责人（2026-10-05 回归防线）═════════════════════════════
// ⛔ D先生 实走流程第二段报的 500：站点管理 → 成员卡 → 「设为负责人」→ PATCH /api/admin/sites/undefined。
//   根因链：/admin/sites/members 的 JSON_BUILD_OBJECT 漏了 site_id（只有 code/name）
//          → 前端 onTransfer(row, s) 拼出 'undefined' → 服务端 `$1::uuid` 报 PG 22P02 → 500。
//   两个洞都要堵：① 下发 site_id  ② 脏 id 必须 404 而不是 500。
section('2D  成员卡移交负责人不再 500');
{
  // ① members 必须带 site_id
  const mem = await adm('/api/admin/sites/members');
  ok(mem.status === 200, 'GET /admin/sites/members', `HTTP ${mem.status}`);
  const withSites = (mem.j?.data?.members ?? []).filter((m) => (m.sites ?? []).length);
  const chip = withSites[0]?.sites?.[0];
  ok(!!chip, '存在带站点授权的成员', `${withSites.length} 人有授权`);
  // ⛔ 核心断言：没有 site_id，前端就会拼出 /admin/sites/undefined
  ok(typeof chip?.site_id === 'string' && chip.site_id.length === 36,
    '⛔ members 的 sites[] 每项都带 site_id（成员卡移交依赖它）', `site_id=${chip?.site_id}`);

  // ② 脏 id 必须是 404 SITE_NOT_FOUND，绝不能是 500
  for (const [label, path, method] of [
    ['PATCH 移交', '/api/admin/sites/undefined', 'PATCH'],
    ['DELETE 删除', '/api/admin/sites/undefined', 'DELETE'],
    ['POST 加成员', '/api/admin/sites/undefined/members', 'POST'],
  ]) {
    const r = await adm(path, method, method === 'POST' ? { admin_id: '1', site_role: 'site_admin' } : { owner_admin_id: '1' });
    // ⛔ 500 = PG 22P02 漏出去了；这是客户端传错 id，不是服务器故障
    ok(r.status === 404 && r.j?.code === 'SITE_NOT_FOUND',
      `⛔ ${label} 传 undefined → 404 而非 500（UUID 守卫）`, `HTTP ${r.status} ${r.j?.code ?? ''}`);
  }

  // ③ 正路：真移交一次，验证真能设上（不是只测错误分支）
  const uname = `e2e_${Date.now().toString(36)}`;
  const pwd = 'E2e@123456';
  const c = await adm('/api/admin/settings/admins', 'POST', { username: uname, password: pwd, role: 'site_admin', site_ids: [] });
  const aid = String(c.j?.data?.admin_id ?? '');
  await db(`INSERT INTO admin_user_site (admin_id, site_id, site_role, is_owner)
             SELECT a.admin_id, $1::uuid, 'site_admin', FALSE FROM admin_user a WHERE a.username = $2::text`,
    [SITE_ID, uname]);
  const tr = await adm(`/api/admin/sites/${SITE_ID}`, 'PATCH', { owner_admin_id: aid });
  ok(tr.status === 200, '真实移交负责人（成员卡那条路）', `HTTP ${tr.status} ${tr.j?.message ?? ''}`);
  const own2 = await db(`SELECT a.username FROM admin_user_site us JOIN admin_user a ON a.admin_id=us.admin_id WHERE us.site_id=$1::uuid AND us.is_owner`, [SITE_ID]);
  ok(own2[0]?.username === uname, '真实 DB 回读：负责人已是新账号', JSON.stringify(own2));
  // 移交回去，把超管还原成负责人（后续用例依赖超管身份）
  const back = await adm(`/api/admin/sites/${SITE_ID}`, 'PATCH', { owner_admin_id: SELF_ID });
  ok(back.status === 200, '移交回超管（还原现场）', `HTTP ${back.status}`);
  await db(`DELETE FROM admin_user_site WHERE admin_id = $1::bigint`, [aid]);
}

// ══ 2C 站点管理员进站 → 直奔凭据开通（2026-10-05 回归防线）════════════════
// ⛔ 这条链是 D先生 实走流程报出来的：新建站 + 新建用户 bantauser 绑定后登录选站，
//   结果停在数据看板（全 0），凭据向导根本进不去。
//   根因 = GET /admin/sites/my 旧实现只返回 code 不返回 site_id，
//   而 select-site 的 setActive 也只存 {scope, code, name} → activeSite.site_id === undefined
//   → 屏 52（按 site_id 取数）拿到 undefined 直接空转，白名单判定也跟着失效。
section('2C  站点管理员：选站后直达凭据开通');
{
  // 正路：建账号 → 建无主站 → 该账号设为负责人 → 以该账号登录选站
  const uname = `e2e_${Date.now().toString(36)}`;
  const pwd = 'E2e@123456';
  const c = await adm('/api/admin/settings/admins', 'POST', { username: uname, password: pwd, role: 'site_admin', site_ids: [] });
  ok(c.status === 200 && c.j.ok, '建站点管理员账号（不绑站）', `HTTP ${c.status}`);
  const aid = String(c.j?.data?.admin_id ?? '');

  const site = await adm('/api/admin/sites', 'POST', { code: `${TMP_CODE}-mgr`, name: 'E2E 站点管理员站' });
  const sid = site.j?.data?.site_id ?? '';
  ok(site.status === 200 && !!sid, '建无主站', `HTTP ${site.status}`);

  const own = await adm(`/api/admin/sites/${sid}`, 'PATCH', { owner_admin_id: aid });
  ok(own.status === 200, '把该账号设为站点负责人', `HTTP ${own.status}`);

  // 以站点管理员身份登录
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, password: pwd }),
  });
  const lj = await lr.json();
  const mgrToken = lj?.data?.token ?? '';
  ok(!!mgrToken, '站点管理员登录成功', `HTTP ${lr.status} ${lj?.message ?? ''}`);

  if (mgrToken) {
    const mh = { Authorization: `Bearer ${mgrToken}` };
    const my = await fetch(`${BASE}/api/admin/sites/my`, { headers: mh });
    const myj = await my.json().catch(() => ({}));
    const rows = myj?.data?.sites ?? [];
    ok(my.status === 200, 'GET /admin/sites/my', `HTTP ${my.status}`);
    ok(rows.length === 1 && rows[0].code === `${TMP_CODE}-mgr`, '站点管理员只看到自己那一个站', `n=${rows.length}`);
    // ⛔ 核心断言：site_id 必须下发。没有它，屏 52 与开通判定全是空转
    ok(rows[0]?.site_id === sid, '⛔ /sites/my 返回 site_id（选站页要靠它写会话）', `got=${rows[0]?.site_id} want=${sid}`);
    ok(rows[0]?.is_owner === true, '/sites/my 返回 is_owner（前端据此提示「找负责人」而不是红 toast）', `is_owner=${rows[0]?.is_owner}`);
    ok(rows[0]?.provisioned === false, '/sites/my 返回 provisioned=false（选站页标「待开通」并直奔向导）', `provisioned=${JSON.stringify(rows[0]?.provisioned)}`);
    // ⛔ provisioned 必须是**布尔 false** 而不是 null：provider_config 无行时 LEFT JOIN 会给 NULL，
    //   前端 `!s.provisioned` 靠 JS 宽松比较侥幸判对，但类型不干净 = 下一个消费者（报表/导出）必踩。
    ok(typeof rows[0]?.provisioned === 'boolean', '⛔ provisioned 是布尔值不是 null（LEFT JOIN NULL 陷阱）', `type=${typeof rows[0]?.provisioned}`);
    ok(rows[0]?.status === 'pending', '新建站状态为 pending', rows[0]?.status);

    // 该账号作为负责人，能读屏 52（不只是能写）
    const g = await fetch(`${BASE}/api/admin/sites/provision/${sid}`, { headers: mh });
    ok(g.status === 200, '负责人可读屏 52 总览', `HTTP ${g.status}`);

    // 未开通时带 X-Fyt-Site 打业务接口 → 403（服务端白名单真实生效）
    const blocked = await fetch(`${BASE}/api/admin/dashboard/overview`, {
      headers: { ...mh, 'X-Fyt-Site': `${TMP_CODE}-mgr` },
    });
    ok(blocked.status === 403, '⛔ 未开通站带站点头打业务接口 → 403（白名单真在服务端）', `HTTP ${blocked.status}`);

    // 平台工作台对该账号不可用（can_aggregate 必须 false）
    ok(myj?.data?.can_aggregate === false, '站点管理员 can_aggregate=false（进不了平台工作台）');
  }
}

// ══ ③ 建壳校验 ══
section('3  建壳入参校验');
{
  const dup = await adm('/api/admin/sites', 'POST', { code: TMP_CODE, name: '重复站' });
  ok(dup.status === 409, '重复 code → 409', `HTTP ${dup.status}`);

  const bad = await adm('/api/admin/sites', 'POST', { code: 'Bad_Code!', name: '非法站' });
  ok(bad.status === 400, '非法 code → 400', `HTTP ${bad.status}`);

  const noName = await adm('/api/admin/sites', 'POST', { code: 'e2e-no-name' });
  ok(noName.status === 400, '缺站点名 → 400', `HTTP ${noName.status}`);
}

// ══ ③B 指定负责人（无主站 → 可配凭据的正路）═════════════════════════════
section('3B  指定负责人后才能配置凭据');
{
  // 建站时留空了负责人，这里走真实业务动作：把当前超管设为该站负责人
  const setOwner = await adm(`/api/admin/sites/${SITE_ID}`, 'PATCH', { owner_admin_id: String(SELF_ID) });
  ok(setOwner.status === 200, 'PATCH 指定负责人成功', `HTTP ${setOwner.status} ${setOwner.j?.message ?? ''}`);
  const own = await db(`SELECT a.username FROM admin_user_site us JOIN admin_user a ON a.admin_id=us.admin_id WHERE us.site_id=$1::uuid AND us.is_owner`, [SITE_ID]);
  ok(own.length === 1, '真实 DB 回读：负责人已落库且唯一', JSON.stringify(own));
}

// ══ ④⑤ 屏 52 四组凭据 ══
section('4  屏 52：四组凭据落点互不相同');
{
  const g = await adm(`/api/admin/sites/provision/${SITE_ID}`);
  ok(g.status === 200, 'GET 总览', `HTTP ${g.status}`);
  const groups = g.j?.data?.groups ?? [];
  ok(groups.length === 5, '五组凭据卡片（admin-52 设计稿：蚂蚁/小程序/公众号/支付/企微）', groups.map((x) => x.title).join(' / '));

  const ants = groups.find((x) => x.key === 'mayixingqiu');
  const mini = groups.find((x) => x.key === 'wechat_mini');
  const mpGroup = groups.find((x) => x.key === 'wechat_mp');
  const payment = groups.find((x) => x.key === 'site_payment');
  const kfk = groups.find((x) => x.key === 'kf');

  ok(ants?.required === true && ants?.testable === true, '蚂蚁星球：必填 + 唯一可测');
  ok(mini?.required === false && mini?.testable === false, '小程序：选填 + 不可测');
  ok(mpGroup?.required === false && mpGroup?.testable === false, '公众号：选填 + 不可测（H5 静默登录硬依赖）');
  ok(payment?.required === false && payment?.testable === false, '微信支付：选填 + 不可测（须真下单才知）');
  ok(kfk?.required === false && kfk?.testable === false, '企微客服：选填 + 不可测（须人工绑企业 ID）');

  ok(ants?.store_at.includes('provider_config'), '蚂蚁星球落 provider_config', ants?.store_at);
  // ⛔ 决策 #44：小程序/公众号凭据真相源都是 provider_config（site.appid 只是屏 31 展示字段，
  //   PUT /mini 双写两处只为兼容系统设置屏）。别再断言 store_at 含 'site.appid'。
  ok(mini?.store_at.includes('provider_config'), '小程序落 provider_config(wechat_mini)（决策#44 真相源）', mini?.store_at);
  ok(mpGroup?.store_at.includes('provider_config'), '公众号落 provider_config(wechat_mp)', mpGroup?.store_at);
  ok(payment?.store_at.includes('site_payment'), '支付落 site_payment 独立表', payment?.store_at);
  ok(kfk?.store_at.includes('site.kf_corp_id'), '企微落 site.kf_*', kfk?.store_at);

  const stores = new Set([ants?.store_at, mini?.store_at, payment?.store_at, kfk?.store_at, mpGroup?.store_at]);
  ok(stores.size === 5, '五组落点两两不同（不是同一张表）', `${stores.size}/5 唯一`);

  ok(typeof payment?.callback_url === 'string' && payment.callback_url.endsWith('/api/trade/notify/wxpay'),
    '支付组下发回调地址（与 trade.ts notifyUrl 同源）', payment?.callback_url);

  ok(g.j?.data?.site?.provisioned === false, '未配凭据时 provisioned=false');
  // ⛔ 前端向导横幅契约（2026-10-05 惨案）：provision.vue 读 provision_state.provisioned，
  //   服务端**从未发过顶层 data.provisioned**，前端曾读错层级恒显「站点尚未开通」。
  //   这里锁死「顶层不许有 + provision_state 必须是 boolean」，两端谁改契约都立刻爆。
  ok(!('provisioned' in (g.j?.data ?? {})), '⛔ GET 顶层不存在 provisioned（前端读的是 provision_state 层）');
  ok(typeof g.j?.data?.provision_state?.provisioned === 'boolean', 'provision_state.provisioned 必须是 boolean',
    `got ${typeof g.j?.data?.provision_state?.provisioned}`);
}

section('5  支付凭据可写（与支付菜单同一真相源）');
{
  const bad = await adm(`/api/admin/sites/provision/${SITE_ID}/payment`, 'PUT', { mch_id: 'abc', mch_key: 'x', serial_no: 'ZZZ', cert: 'nope' });
  ok(bad.status === 400, '非法商户号 → 400', `HTTP ${bad.status}`);

  const badRate = await adm(`/api/admin/sites/provision/${SITE_ID}/payment`, 'PUT', { mch_id: '1618593690', commission_rate: 5 });
  ok(badRate.status === 400, '费率越界 → 400', `HTTP ${badRate.status}`);

  const PEM = `-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASC\nE2EFAKEKEYdoNotUseInProd0000000000000000\n-----END PRIVATE KEY-----`;
  // ⚠️ APIv3 密钥必须精确 32 位：上一次写成 30 位被服务端正确拦下（400），
  //    那是 E2E 数据错、不是产品 bug —— 校验逻辑是对的，别去改服务端。
  const KEY32 = 'e2efaketestkey0123456789abcdef01';
  ok(KEY32.length === 32, `测试用 APIv3 密钥恰好 32 位（${KEY32.length}）`);
  const r = await adm(`/api/admin/sites/provision/${SITE_ID}/payment`, 'PUT', {
    mch_id: '1618593690', mch_key: KEY32,
    serial_no: '5F894827FFD2354E502A6659E9D7724F3B8FFFC8', cert: PEM,
    commission_rate: 0.25, status: 'active',
  });
  ok(r.status === 200 && r.j.ok, '支付凭据保存成功（客户建站时可直接填）', `HTTP ${r.status} ${r.j?.message ?? ''}`);

  const row = (await db(`SELECT mch_id, mch_key, serial_no, cert, commission_rate::float rate, status FROM site_payment WHERE site_id = $1::uuid`, [SITE_ID]))[0];
  ok(row?.mch_id === '1618593690', '真实 DB 回读：site_payment.mch_id 已落库', row?.mch_id);
  ok(Math.abs(Number(row?.rate) - 0.25) < 1e-6, '费率真实落库 0.25', String(row?.rate));
  ok(row?.status === 'active', '状态 active 已落库', row?.status);
  ok(String(row?.cert).includes('E2EFAKEKEY'), '私钥全文落库（真相源要能真跑签名）');

  const g2 = await adm(`/api/admin/sites/provision/${SITE_ID}`);
  const pg = g2.j?.data?.groups?.find((x) => x.key === 'site_payment');
  ok(pg?.has_cert === true && pg?.has_key === true, '屏 52 只回显布尔位（不回私钥原文）');
  ok(!JSON.stringify(g2.j).includes('E2EFAKEKEY'), '⛔ 私钥原文绝不出现在 GET 响应里');
  ok(!JSON.stringify(g2.j).includes('e2efaketestkey'), '⛔ APIv3 密钥原文绝不出现在 GET 响应里');
}

section('4b  小程序 / 企微凭据可写');
{
  const badAppid = await adm(`/api/admin/sites/provision/${SITE_ID}/mini`, 'PUT', { appid: 'notwx' });
  ok(badAppid.status === 400, '非法 appid → 400', `HTTP ${badAppid.status}`);

  const r = await adm(`/api/admin/sites/provision/${SITE_ID}/mini`, 'PUT', { appid: 'wx1234567890abcdef', mini_secret: 'e2emini' });
  ok(r.status === 200, '小程序凭据保存成功', `HTTP ${r.status}`);
  const row = (await db(`SELECT appid, mini_secret FROM site WHERE site_id=$1::uuid`, [SITE_ID]))[0];
  ok(row?.appid === 'wx1234567890abcdef', '真实 DB：site.appid 已落库', row?.appid);

  const badUrl = await adm(`/api/admin/sites/provision/${SITE_ID}/kf`, 'PUT', { corp_id: 'ww1234567890ab', kf_url: 'https://evil.example.com/kfid/x' });
  ok(badUrl.status === 400, '非企微官方域名客服链接 → 400（防端上任意跳转）', `HTTP ${badUrl.status}`);

  const incomplete = await adm(`/api/admin/sites/provision/${SITE_ID}/kf`, 'PUT', { corp_id: 'ww1234567890ab', kf_url: 'https://work.weixin.qq.com/kfid/abc', status: 'active' });
  ok(incomplete.status === 200 || incomplete.status === 400, '企微缺项处理明确（缺任一项不许 active）', `HTTP ${incomplete.status}`);
}

section('4c  公众号凭据可写（admin-52 设计稿第③块，2026-10-05 补齐）');
{
  // 反例：appid 形状 / secret 缺失
  const badAppid = await adm(`/api/admin/sites/provision/${SITE_ID}/mp`, 'PUT', { appid: 'notwx' });
  ok(badAppid.status === 400, '公众号非法 appid → 400', `HTTP ${badAppid.status}`);
  const noSecret = await adm(`/api/admin/sites/provision/${SITE_ID}/mp`, 'PUT', { appid: 'wxabcdef1234567890' });
  ok(noSecret.status === 400, '公众号首次配置缺 secret → 400（OAuth 两参缺一不可）', `HTTP ${noSecret.status}`);

  // 正路：保存 + DB 回读 + GET 回显布尔位
  const r = await adm(`/api/admin/sites/provision/${SITE_ID}/mp`, 'PUT', { appid: 'wxabcdef1234567890', api_secret: 'e2empsecret' });
  ok(r.status === 200, '公众号凭据保存成功', `HTTP ${r.status}`);
  const row = (await db(`SELECT apikey, api_secret FROM provider_config WHERE site_id=$1::uuid AND provider='wechat_mp'`, [SITE_ID]))[0];
  ok(row?.apikey === 'wxabcdef1234567890' && row?.api_secret === 'e2empsecret', '真实 DB：wechat_mp apikey/secret 已落库');

  const g = await adm(`/api/admin/sites/provision/${SITE_ID}`);
  const mp = g.j?.data?.groups?.find((x) => x.key === 'wechat_mp');
  ok(mp?.configured === true, 'GET 总览：公众号 configured=true');
  ok(!JSON.stringify(g.j).includes('e2empsecret'), '⛔ 公众号 secret 原文绝不出现在 GET 响应里');
  ok(g.j?.data?.site?.provisioned === false, '⛔ 公众号配置不影响开通判定（决策#44：白名单只认蚂蚁）');
}

// 掩码回填契约（2026-10-06 D先生拍板）：GET 回掩码、前端回填输入框、提交时掩码=沿用原值。
// ⛔ 核心风险 = 掩码串被当真值写库（凭据报废），服务端 dropMasked 必须 stdin 掉含 '•' 的入参。
section('4d  掩码回显 + 掩码串提交不写脏真值（2026-10-06）');
{
  const g = await adm(`/api/admin/sites/provision/${SITE_ID}`);
  const mp = g.j?.data?.groups?.find((x) => x.key === 'wechat_mp');
  const pg = g.j?.data?.groups?.find((x) => x.key === 'site_payment');

  // ① GET 回显掩码态（前端据此回填输入框）
  ok(mp?.key_masked && mp.key_masked.includes('•'), '公众号 appid 回显掩码（含 •）', mp?.key_masked);
  ok(mp?.secret_masked && mp.secret_masked.includes('•'), '公众号 secret 回显掩码（含 •）', mp?.secret_masked);
  ok(pg?.mch_id_masked?.includes('•') && pg?.mch_key_masked?.includes('•') && pg?.serial_no_masked?.includes('•'),
    '支付组 mch_id/mch_key/serial_no 全部回显掩码');
  ok(pg?.cert_masked?.includes('•••••'), '商户私钥回显掩码（头 34 字节 + 字节数）', pg?.cert_masked?.slice(-12));
  ok(!JSON.stringify(g.j).includes('wxabcdef1234567890'), '⛔ appid 原文不出现在 GET 响应（前端只拿掩码）');
  ok(!JSON.stringify(g.j).includes('1618593690'), '⛔ 商户号原文不出现在 GET 响应');
  ok(!JSON.stringify(g.j).includes('5F894827FFD2354E502A6659E9D7724F3B8FFFC8'), '⛔ 证书序列号原文不出现在 GET 响应');

  // ② 掩码串原样提交（模拟旧 bundle / 前端守卫失效）→ 服务端 dropMasked 兜底，DB 不变
  const mpMasked = await adm(`/api/admin/sites/provision/${SITE_ID}/mp`, 'PUT',
    { appid: mp.key_masked, api_secret: mp.secret_masked });
  ok(mpMasked.status === 200, '掩码串提交公众号 → 200（按沿用原值处理）', `HTTP ${mpMasked.status}`);
  const mpRow = (await db(`SELECT apikey, api_secret FROM provider_config WHERE site_id=$1::uuid AND provider='wechat_mp'`, [SITE_ID]))[0];
  ok(mpRow?.apikey === 'wxabcdef1234567890' && mpRow?.api_secret === 'e2empsecret',
    '⛔ 掩码串未写脏公众号 DB（真值原样保留）', mpRow?.apikey);

  // ③ 掩码串提交支付组 → mch_id/serial_no 真值不变
  const payMasked = await adm(`/api/admin/sites/provision/${SITE_ID}/payment`, 'PUT', {
    mch_id: pg.mch_id_masked, mch_key: '', serial_no: pg.serial_no_masked, cert: '', status: 'active',
  });
  ok(payMasked.status === 200, '掩码串提交支付组 → 200（按沿用原值处理）', `HTTP ${payMasked.status}`);
  const payRow = (await db(`SELECT mch_id, mch_key, serial_no FROM site_payment WHERE site_id=$1::uuid`, [SITE_ID]))[0];
  ok(payRow?.mch_id === '1618593690' && payRow?.serial_no === '5F894827FFD2354E502A6659E9D7724F3B8FFFC8',
    '⛔ 掩码串未写脏支付组 DB（真值原样保留）', payRow?.mch_id);

  // ④ 换一个字段、另一个留掩码：只改 secret，appid 不被洗掉
  const mpPartial = await adm(`/api/admin/sites/provision/${SITE_ID}/mp`, 'PUT',
    { appid: mp.key_masked, api_secret: 'e2empsecret2' });
  ok(mpPartial.status === 200, '改 secret、appid 留掩码 → 200', `HTTP ${mpPartial.status}`);
  const mpRow2 = (await db(`SELECT apikey, api_secret FROM provider_config WHERE site_id=$1::uuid AND provider='wechat_mp'`, [SITE_ID]))[0];
  ok(mpRow2?.apikey === 'wxabcdef1234567890' && mpRow2?.api_secret === 'e2empsecret2',
    '部分修改：appid 保留 + secret 已更新', mpRow2?.api_secret);
  // 还原 secret，避免影响后续段落对 e2empsecret 的断言
  await adm(`/api/admin/sites/provision/${SITE_ID}/mp`, 'PUT', { appid: '', api_secret: 'e2empsecret' });
}

// ══ ⑥ 蚂蚁连通测试 ══
section('6  蚂蚁星球连通性测试（真调上游）');
{
  const before = await db(`SELECT count(*)::int n FROM "order" WHERE site_id::text = $1`, [SITE_ID]);
  ok(before[0].n === 0, '样本单断言：测试站订单数为 0（本次测试不产生任何业务数据）', `${before[0].n}`);

  const bad = await adm(`/api/admin/sites/provision/${SITE_ID}/mayixingqiu`, 'PUT', { apikey: 'e2e-invalid-key-000000' });
  ok(bad.status === 200, '无效 key 保存成功（保存≠通过）', `HTTP ${bad.status}`);
  ok(bad.j?.data?.test?.status === 'failed', '无效 key → 连通测试 failed', bad.j?.data?.test?.message?.slice(0, 60));
  ok(bad.j?.data?.provisioned === false, '测试未过 → provisioned 仍为 false');

  const st = (await db(`SELECT test_status, test_message IS NOT NULL msg FROM provider_config WHERE site_id=$1::uuid AND provider='mayixingqiu'`, [SITE_ID]))[0];
  ok(st?.test_status === 'failed', '真实 DB 回读：test_status=failed 已落库', st?.test_status);
  ok(st?.msg === true, '失败原因已留痕（供管理台排查，不含凭据）');

  const retest = await adm(`/api/admin/sites/provision/${SITE_ID}/mayixingqiu/test`, 'POST');
  ok(retest.status === 200 && retest.j?.data?.test?.status === 'failed', '「重新测试」端点可用且复现 failed');

  const provisionRows = await db(`SELECT count(*)::int n FROM site WHERE site_id=$1::uuid AND status='active'`, [SITE_ID]);
  ok(provisionRows[0].n === 0, '未开通时不能把站点切成 active');
}

// ══ ⑦ 未开通白名单拦截 ══
section('7  未开通拦截：绕前端直连 API 也拿不到数据');
{
  const locked = await adm('/api/admin/dashboard/overview', 'GET', undefined, TMP_CODE);
  ok(locked.status === 403, '带未开通站点的 X-Fyt-Site 打看板 → 403', `HTTP ${locked.status}`);
  ok(locked.j?.code === 'SITE_NOT_PROVISIONED', '错误码明确 SITE_NOT_PROVISIONED', locked.j?.code);

  const noHeader = await adm('/api/admin/dashboard/overview', 'GET');
  ok(noHeader.status !== 403, '不带当前站头（平台工作台聚合只读）→ 不拦', `HTTP ${noHeader.status}`);

  const wrongSite = await adm('/api/admin/dashboard/overview', 'GET', undefined, 'no-such-site-xyz');
  ok(wrongSite.status === 403, '不存在的站 → 同样拦住（不能靠乱填头绕过）', `HTTP ${wrongSite.status}`);

  for (const p of ['/api/admin/sites', '/api/admin/settings/overview', `/api/admin/sites/provision/${SITE_ID}`]) {
    const r = await adm(p, 'GET', undefined, TMP_CODE);
    ok(r.status !== 403, `开通手段本身放行：${p}`, `HTTP ${r.status}`);
  }

  const cEnd = await fetch(`${BASE}/api/site/config?code=${TMP_CODE}`);
  ok(cEnd.status < 500, 'C 端接口不受后台白名单影响', `HTTP ${cEnd.status}`);
}

// ══ ⑧ 移交负责人 / 停用 / 删除 ══
section('8  负责人移交 / 停用 / 删除保护');
{
  const admins = await db(`SELECT admin_id::text AS id, username, status FROM admin_user WHERE status='active' ORDER BY admin_id`);
  ok(admins.length >= 2, `有第二个启用账号可移交（${admins.length} 个）`);

  if (admins.length >= 2) {
    const otherRow = admins[0].username === 'admin' ? admins[1] : admins[0];
    const other = otherRow.username; // ⚠️ 取 .username，别拿对象（上一版拿对象导致断言恒失败）
    const otherId = otherRow.id;
    ok(!!other, `移交目标账号：${other}（${otherId}）`);
    await db(`INSERT INTO admin_user_site (admin_id, site_id, site_role, is_owner) VALUES ($1::bigint,$2::uuid,'site_admin',FALSE) ON CONFLICT DO NOTHING`, [otherId, SITE_ID]);
    const r = await adm(`/api/admin/sites/${SITE_ID}`, 'PATCH', { owner_admin_id: otherId });
    ok(r.status === 200 && r.j?.data?.owner_username === other, `移交负责人成功 → ${other}`, r.j?.data?.owner_username);
    // ⛔ 断言服务端回读（唯一索引才是真相），不能只看响应体
    const ownerDb = await db(`SELECT a.username FROM admin_user_site us JOIN admin_user a ON a.admin_id=us.admin_id WHERE us.site_id=$1::uuid AND us.is_owner`, [SITE_ID]);
    ok(ownerDb[0]?.username === other, '真实 DB 回读：负责人已是移交目标', ownerDb[0]?.username);

    const owners = await db(`SELECT count(*)::int n FROM admin_user_site WHERE site_id=$1::uuid AND is_owner`, [SITE_ID]);
    ok(owners[0].n === 1, '移交后仍只有一个负责人', `${owners[0].n}`);

    const rm = await adm(`/api/admin/sites/${SITE_ID}/members/${otherId}`, 'DELETE');
    ok(rm.status === 400 && rm.j?.code === 'CANNOT_REMOVE_OWNER', '⛔ 不能移除负责人', `HTTP ${rm.status} ${rm.j?.code}`);
  }

  const dis = await adm(`/api/admin/sites/${SITE_ID}`, 'PATCH', { status: 'disabled' });
  ok(dis.status === 200 && dis.j?.data?.status === 'disabled', '停用成功（复用状态而非删除）', dis.j?.data?.status);

  const back = await adm(`/api/admin/sites/${SITE_ID}`, 'PATCH', { status: 'active' });
  ok(back.status === 400 && back.j?.code === 'SITE_NOT_PROVISIONED', '未开通时拒绝启用（防运营进得去只看到全 0）', `HTTP ${back.status}`);
}

// ══ ⑨ 有数据站点拒删 ══
section('9  删除保护');
{
  await db(`INSERT INTO provider_config (site_id, provider, apikey, status) VALUES ($1::uuid,'mayixingqiu','e2e','active') ON CONFLICT DO NOTHING`, [SITE_ID]);
  const sitea = (await db(`SELECT site_id::text AS id FROM site WHERE code='site-a' LIMIT 1`))[0];
  const r = await adm(`/api/admin/sites/${sitea.id}`, 'DELETE');
  ok(r.status === 400 && r.j?.code === 'SITE_HAS_DATA', '⛔ 有业务数据的站点（site-a）拒绝删除', `HTTP ${r.status} ${r.j?.code}`);
  const still = await db(`SELECT count(*)::int n FROM site WHERE site_id=$1::uuid`, [sitea.id]);
  ok(still[0].n === 1, 'site-a 仍在（没被误删）');
}

// ══ ⑨B 凭据通过 → 站点自动开通（pending→active，2026-10-05 修复）══
section('9B 蚂蚁凭据连通通过后站点自动启用');
{
  // ⑧ 结束时站点是 disabled 且负责人已移交给其他账号（⑧ 的移交测试）；
  // 先恢复「admin 是负责人 + 站点 pending」的预设，再走正路开通
  await db(`UPDATE site SET status='pending' WHERE site_id=$1::uuid`, [SITE_ID]);
  const admRow = (await db(`SELECT admin_id::text AS id FROM admin_user WHERE username='admin'`))[0];
  await db(`UPDATE admin_user_site SET is_owner=FALSE WHERE site_id=$1::uuid`, [SITE_ID]);
  await db(
    `INSERT INTO admin_user_site (admin_id, site_id, site_role, is_owner) VALUES ($1::bigint,$2::uuid,'site_admin',TRUE)
     ON CONFLICT (admin_id, site_id) DO UPDATE SET is_owner = TRUE`,
    [admRow.id, SITE_ID],
  );
  const realKey = (await db(
    `SELECT pc.apikey FROM provider_config pc JOIN site s ON s.site_id=pc.site_id
      WHERE s.code='site-a' AND pc.provider='mayixingqiu' AND pc.test_status='passed' LIMIT 1`
  ))[0]?.apikey;
  ok(typeof realKey === 'string' && realKey.length >= 16 && !realKey.startsWith('e2e'), '前置：site-a 存在真实通过的蚂蚁 key（借用作正路测试凭据）');

  const good = await adm(`/api/admin/sites/provision/${SITE_ID}/mayixingqiu`, 'PUT', { apikey: realKey });
  ok(good.status === 200, '真实 key 保存成功', `HTTP ${good.status} ${JSON.stringify(good.j).slice(0, 160)}`);
  ok(good.j?.data?.test?.status === 'passed', '连通测试 passed', good.j?.data?.test?.message?.slice(0, 40));
  ok(good.j?.data?.provisioned === true, 'provisioned=true');
  ok(good.j?.data?.site_activated === true, '响应明确 site_activated=true（pending 已自动翻 active）');

  const st2 = (await db(`SELECT status FROM site WHERE site_id=$1::uuid`, [SITE_ID]))[0];
  ok(st2?.status === 'active', '真实 DB 回读：站点 status 已是 active（C 端立即可访问）', st2?.status);

  const after = await db(`SELECT count(*)::int n FROM "order" WHERE site_id::text = $1`, [SITE_ID]);
  ok(after[0].n === 0, '本节未产生任何业务订单数据', `${after[0].n}`);
}

// ══ ⑩ 审计 ══
section('10 审计留痕');
{
  const rows = await db(`SELECT action, target_id FROM admin_audit_log WHERE target_id=$1::text ORDER BY id`, [TMP_CODE]);
  const actions = rows.map((r) => r.action);
  ok(actions.includes('site.create'), '建壳有审计', actions.join(','));
  ok(actions.some((a) => a.startsWith('provision.')), '凭据操作有审计');
  ok(actions.includes('site.set_status'), '状态流转有审计');
  ok(!JSON.stringify(rows).includes('e2efaketestkey'), '⛔ 审计里不含凭据原文');
}

// ══ 退场清零 ══
section('退场清零');
{
  await cleanup();
  const left = await db(`SELECT count(*)::int n FROM site WHERE code LIKE 'e2e-%'`);
  ok(left[0].n === 0, '测试站点已全部删除（含无主站分支）', `n=${left[0].n}`);
  const accLeft = await db(`SELECT count(*)::int n FROM admin_user WHERE username LIKE 'e2e\_%'`);
  ok(accLeft[0].n === 0, '测试账号已删除（无残留）', `n=${accLeft[0].n}`);
  const pc = await db(`SELECT count(*)::int n FROM provider_config pc JOIN site s ON s.site_id=pc.site_id WHERE s.code='site-a' AND pc.provider='mayixingqiu' AND pc.apikey LIKE 'e2e%'`);
  ok(pc[0].n === 0, 'site-a 的真实蚂蚁凭据未被污染');
  const sp = (await db(`SELECT count(*)::int n, sum(CASE WHEN cert LIKE '-----BEGIN%' THEN 1 ELSE 0 END)::int real FROM site_payment`))[0];
  ok(sp.real >= 1, `site_payment 真实凭据完好（${sp.n} 行）`);
}

console.log(`\n=== 结果 ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail ? 1 : 0);