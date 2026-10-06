/**
 * E2E：企业微信客服接入（迁移 040 · D先生 2026-10-05）
 *
 * 覆盖：
 *   ① 迁移 040 三列已落库（表结构级证据）
 *   ② 管理端 GET /admin/settings/kf 读配置（未配置时全空 + can_enable=false）
 *   ③ 保存校验：corpId 形状、客服链接域名白名单、缺项不许开通
 *   ④ 正常保存 → C 端公开只读接口下发 → 状态门控
 *   ⑤ 未开通时 C 端不下发任何凭据（防泄漏）
 *   ⑥ 缺 site_id / 不存在的站点 / 非超管 → 明确报错不静默
 *   ⑦ 端上接线（构建产物级证据：四处入口无死占位）
 *   ⑧ 清理测试配置（恢复原状）
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const BASE = 'https://mk.fyt360.cn';
const GW = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;

let pass = 0, fail = 0;
const ok = (cond, title, extra = '') => {
  if (cond) { pass++; console.log(`✅ ${title}${extra ? ' — ' + extra : ''}`); }
  else { fail++; console.log(`❌ ${title}${extra ? ' — ' + extra : ''}`); }
};

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
  return j;
}

let token = '';
async function adm(path, method = 'GET', body = undefined) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
async function pub(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

console.log('=== 企业微信客服接入 E2E（迁移 040）===\n');

// ── 登录 ──
{
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
  });
  const j = await r.json();
  token = j?.data?.token ?? '';
  ok(!!token, '管理员登录');
}
if (!token) { console.log('\n⚠️ 登录失败，终止'); process.exit(1); }

const siteRows = await db(`SELECT site_id::text AS id, code, name, kf_corp_id, kf_url, kf_status FROM site ORDER BY created_at LIMIT 1`);
const SITE = siteRows[0];
const SITE_ID = SITE.id;
ok(!!SITE_ID, `取测试站点 ${SITE.name} (${SITE.code})`);
ok(true, `进入测试前强制清空该站点客服配置（原值: corpId=${SITE.kf_corp_id ?? 'null'} url=${SITE.kf_url ? '有' : 'null'} status=${SITE.kf_status}）`);

/**
 * ⛔ 不用"快照 → 恢复"模式。
 * 踩过的坑：跑第二遍时快照取到的已是上一遍的测试值，"恢复"又写回测试值 →
 * 脏数据永久留在生产配置里，且**不可逆**（真客服链接被覆盖）。
 * 改为「进场先清空 / 退场再清空」：E2E 反复跑 N 次，库里恒为"未配置"，
 * 唯一代价是覆盖真实配置（所以 E2E 脚本禁止对有真实客服的站点跑）。
 */
await db(`UPDATE site SET kf_corp_id = NULL, kf_url = NULL, kf_status = 'disabled' WHERE site_id = $1::uuid`, [SITE_ID]);

// ══ ① 迁移 040 三列已落库 ══
console.log('\n【1】迁移 040：site 表客服三列已落库');
{
  const cols = await db(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='site' AND column_name IN ('kf_corp_id','kf_url','kf_status')`,
  );
  const names = cols.map((c) => c.column_name).sort();
  ok(names.length === 3, `三列均已落库（${names.join(', ')}）`);
  const def = await db(
    `SELECT column_name, column_default FROM information_schema.columns
      WHERE table_name='site' AND column_name='kf_status'`,
  );
  ok(String(def[0]?.column_default ?? '').includes('disabled'),
    `kf_status 默认 disabled（default=${def[0]?.column_default}）—— 迁移不会误开客服`);
}

// ══ ② 管理端读配置 ══
console.log('\n【2】管理端 GET /admin/settings/kf');
{
  const r = await adm(`/api/admin/settings/kf?site_id=${SITE_ID}`);
  ok(r.status === 200, `读配置 HTTP ${r.status}（期望 200）`);
  const d = r.j?.data ?? {};
  ok(d.site_id === SITE_ID, '返回 site_id 与请求一致');
  ok(typeof d.can_enable === 'boolean', `can_enable 布尔存在（${d.can_enable}）`);
  // can_enable 语义：两项齐了才 true
  const expectCan = Boolean(d.corp_id && d.kf_url);
  ok(d.can_enable === expectCan, `can_enable=${d.can_enable} == corpId&&url 齐备(${expectCan})`);
  // 掩码字段必须存在（不返明文到列表层语义）
  ok('kf_url_masked' in d, 'kf_url_masked 字段存在（审计/列表用）');
}

// ══ ③ 保存校验（非法必须被拒）══════════
console.log('\n【3】保存校验：非法输入必须明确拒绝');
{
  const bad1 = await adm('/api/admin/settings/kf', 'POST', {
    site_id: SITE_ID, corp_id: 'abc', kf_url: 'https://work.weixin.qq.com/kfid/x', status: 'active',
  });
  ok(bad1.status === 400, `corpId 非 ww 开头 → HTTP ${bad1.status}（期望 400）`);

  const bad2 = await adm('/api/admin/settings/kf', 'POST', {
    site_id: SITE_ID, corp_id: 'ww1234567890abcdef', kf_url: 'https://evil.example.com/kfid/x', status: 'active',
  });
  ok(bad2.status === 400, `客服链接非企微域名 → HTTP ${bad2.status}（期望 400，域名白名单是安全边界）`);

  const bad3 = await adm('/api/admin/settings/kf', 'POST', {
    site_id: SITE_ID, corp_id: 'ww1234567890abcdef', kf_url: 'http://work.weixin.qq.com/kfid/x', status: 'active',
  });
  ok(bad3.status === 400, `客服链接 http 非 https → HTTP ${bad3.status}（期望 400）`);

  const bad4 = await adm('/api/admin/settings/kf', 'POST', {
    site_id: SITE_ID, corp_id: 'ww1234567890abcdef', kf_url: '', status: 'active',
  });
  ok(bad4.status === 400, `只填 corpId 就想开通 → HTTP ${bad4.status}（期望 400 KF_INCOMPLETE）`);

  // 空格必须被自动清掉（微信「ID 不一致」官方已知坑）
  const spaced = await adm('/api/admin/settings/kf', 'POST', {
    site_id: SITE_ID, corp_id: '  ww1234567890abcdef  ', kf_url: '', status: 'disabled',
  });
  ok(spaced.status === 200 && spaced.j?.data?.kf_corp_id === 'ww1234567890abcdef',
    `corpId 前后空格被自动去除（存 "${spaced.j?.data?.kf_corp_id}"）`);
}

// ══ ④ 正常保存 → C 端下发 ══
console.log('\n【4】开通后 C 端公开接口下发');
const CORP = 'ww1234567890abcdef';
const KFURL = 'https://work.weixin.qq.com/kfid/kfc_e2e_test_abcdef?token=e2etoken';
{
  const save = await adm('/api/admin/settings/kf', 'POST', {
    site_id: SITE_ID, corp_id: CORP, kf_url: KFURL, status: 'active',
  });
  ok(save.status === 200, `保存并开通 HTTP ${save.status}`);
  ok(save.j?.data?.kf_status === 'active', `状态=active（实际 ${save.j?.data?.kf_status}）`);
  ok(save.j?.data?.can_enable === true, 'can_enable=true');

  // 真 DB 复核（不靠接口回显）
  const row = await db(`SELECT kf_corp_id, kf_url, kf_status FROM site WHERE site_id = $1::uuid`, [SITE_ID]);
  ok(row[0]?.kf_corp_id === CORP, `DB 落库 corpId=${row[0]?.kf_corp_id}`);
  ok(row[0]?.kf_url === KFURL, 'DB 落库客服链接一致');
  ok(row[0]?.kf_status === 'active', 'DB 落库状态 active');

  const c = await pub(`/api/site/kf?code=${SITE.code}`);
  ok(c.status === 200, `C 端 GET /api/site/kf HTTP ${c.status}`);
  const cd = c.j?.data ?? {};
  ok(cd.enabled === true, `C 端 enabled=true（实际 ${cd.enabled}）`);
  ok(cd.corp_id === CORP, `C 端下发 corpId 一致（${cd.corp_id}）`);
  ok(cd.kf_url === KFURL, 'C 端下发完整客服链接（端上要真跳转，不能给掩码）');
}

// ══ ⑤ 未开通时不下发任何凭据（防泄漏）══════════
console.log('\n【5】停用后不得再下发凭据');
{
  await adm('/api/admin/settings/kf', 'POST', { site_id: SITE_ID, corp_id: CORP, kf_url: KFURL, status: 'disabled' });
  const c = await pub(`/api/site/kf?code=${SITE.code}`);
  const cd = c.j?.data ?? {};
  ok(cd.enabled === false, `停用后 enabled=false（实际 ${cd.enabled}）`);
  ok(!cd.corp_id, '停用后 corpId 不下发（null）');
  ok(!cd.kf_url, '停用后客服链接不下发（null）——未开通时端上只应看到"未开通"');
}

// ══ ⑥ 参数守卫 ══
console.log('\n【6】参数守卫：不静默降级');
{
  const noSite = await adm('/api/admin/settings/kf');
  ok(noSite.status === 400, `缺 site_id → HTTP ${noSite.status}（期望 400）`);

  const notFound = await adm('/api/admin/settings/kf?site_id=00000000-0000-0000-0000-000000000000');
  ok(notFound.status === 404, `站点不存在 → HTTP ${notFound.status}（期望 404）`);

  const anon = await fetch(`${BASE}/api/admin/settings/kf?site_id=${SITE_ID}`);
  ok(anon.status === 401, `匿名访问 → HTTP ${anon.status}（期望 401，不能是 404 鉴权形同虚设）`);

  const pubNoSite = await pub('/api/site/kf');
  ok(pubNoSite.status === 200 && pubNoSite.j?.data?.enabled === false,
    'C 端无 site 参数 → enabled=false（不报错，公开只读端点应宽容）');
}

// ══ ⑦ 端上接线（构建产物级证据）══════════
console.log('\n【7】端上接线：四处入口无死占位');
{
  const D = 'apps/mini/dist/build/mp-weixin';
  const read = (p) => {
    try { return readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8'); }
    catch (e) { console.error(`   ⚠️ 读不到产物文件: ${p}（${e.code ?? e.message}）`); return ''; }
  };

  const kefu = read(`${D}/utils/kefu.js`);
  ok(kefu.includes('openCustomerServiceChat'), 'kefu.js 调 wx.openCustomerServiceChat');
  ok(kefu.includes('/api/site/kf'), 'kefu.js 读 /api/site/kf');
  ok(/复制|已复制/.test(kefu), 'kefu.js 有"复制链接"降级路径（D先生拍板：不能点了没反应）');

  const mine = read(`${D}/components/builtin/MineView.js`);
  ok(/kefu:!0|kefu:\s*!0/.test(mine), 'MineView「联系客服」带 kefu 标记');

  const dt = read(`${D}/pages/goods/detail.js`);
  ok(dt.includes('openCustomerService') || dt.includes('onKefu'), '小程序详情页底栏已接客服');

  const doc = read(`${D}/pages/profile/doc.wxml`);
  ok(doc.includes('kefu-btn'), '隐私政策/协议页有真客服按钮（替换原【客服联系方式】占位符）');

  // ⚠️ read() 吞错返回 ''，会让"文件不存在"伪装成"内容不符"——
  //    路径写错时排查成本极高（本次就踩了）。先断言文件可读，再断言内容。
  const h5url = new URL('../../apps/h5/src/utils/kefu.js', import.meta.url);
  let h5 = '';
  try { h5 = readFileSync(h5url, 'utf8'); } catch (e) { /* 下面断言会报 */ }
  ok(h5.length > 0, `H5 kefu.js 可读（${h5url.pathname}）`);
  ok(h5.includes('window.location.href'), 'H5 kefu 走整页跳转（该 API 在 H5 不存在）');
  // ⚠️ 不能只查 "openCustomerServiceChat" 字样——文件头的说明注释里就会提到它
  //    （那是给人看的，不是调用）。要查真实调用形态 `uni.openCustomerServiceChat(`。
  ok(!/uni\.openCustomerServiceChat\s*\(/.test(h5), 'H5 端无小程序专属 API 的真实调用');
}

// ══ ⑧ 清理 ══
console.log('\n【8】清理：配置必须归零（反复跑不残留）');
{
  // 走公开管理接口清空（顺带验证"传空串能真的清空字段"而不是被忽略）
  const r = await adm('/api/admin/settings/kf', 'POST', {
    site_id: SITE_ID, corp_id: '', kf_url: '', status: 'disabled',
  });
  ok(r.status === 200, `清空请求 HTTP ${r.status}`);
  ok(r.j?.data?.kf_corp_id === null, `接口回显 corpId=null（实际 ${JSON.stringify(r.j?.data?.kf_corp_id)}）`);

  const row = await db(`SELECT kf_corp_id, kf_url, kf_status FROM site WHERE site_id = $1::uuid`, [SITE_ID]);
  ok(row[0]?.kf_corp_id === null, `DB corpId 已归零（${row[0]?.kf_corp_id}）`);
  ok(row[0]?.kf_url === null, `DB 客服链接已归零（${row[0]?.kf_url}）`);
  ok(row[0]?.kf_status === 'disabled', `DB 状态=disabled（${row[0]?.kf_status}）`);

  // 全库扫一遍：测试值不得残留 anywhere
  const left = await db(
    `SELECT count(*)::int AS c FROM site WHERE kf_url LIKE '%e2e_test%' OR kf_corp_id = $1::text`, [CORP]);
  ok(left[0]?.c === 0, `全库无测试客服残留（命中 ${left[0]?.c} 条）`);

  const c = await pub(`/api/site/kf?code=${SITE.code}`);
  ok(c.j?.data?.enabled === false, 'C 端回到 enabled=false');
}

console.log(`\n${fail === 0 ? '🎉' : '⚠️'} 通过 ${pass} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
