/**
 * 决策#34 三修线上 E2E：
 * ③ 换肤两步制：preview(不落库) → apply(生效+存档) → reset(默认波普)；旧 /generate mode=theme → 400
 * ② 装修页删除：DELETE page-* ✅ / home 禁删 / 重复删 404
 * ① FAB 活动页：PUT tabbar fab.action='page:page-xxx' → GET 回读 → 还原
 * 用法：node deploy/scripts/verify-ux-34.mjs
 */
import { loadDotEnv } from './lib/common.mjs';

loadDotEnv();

const BASE = 'https://mk.fyt360.cn';
const ADMIN_PW = process.env.ADMIN_INIT_PASSWORD;
if (!ADMIN_PW) { console.error('缺 ADMIN_INIT_PASSWORD'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};
const api = async (path, opt = {}, token = '') => {
  const res = await fetch(BASE + '/api' + path, {
    ...opt,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opt.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};

// admin 登录
const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: ADMIN_PW }) });
const T = login.body?.data?.token ?? '';
ok('admin 登录', !!T);

/* ===== ③ 换肤两步制 ===== */
const theme0 = await api('/admin/ai/theme', {}, T);
const baseTheme = theme0.body?.data?.theme ?? {};
ok('③ GET theme 基线', theme0.body?.ok === true, `${Object.keys(baseTheme).length} 项 token`);

const pv = await api('/admin/ai/theme/preview', { method: 'POST', body: JSON.stringify({ brief: 'E2E 验收：深海蓝主色，青绿辅助，清爽夏天' }) }, T);
const pvTokens = pv.body?.data?.tokens ?? {};
ok('③ preview 产色板（不落库）', pv.body?.ok === true && Object.keys(pvTokens).length >= 8, `${Object.keys(pvTokens).length} 项`);

const ap = await api('/admin/ai/theme/apply', { method: 'POST', body: JSON.stringify({ tokens: pvTokens, brief: 'E2E 验收' }) }, T);
ok('③ apply 生效', ap.body?.data?.applied === true);

const theme1 = await api('/admin/ai/theme', {}, T);
ok('③ apply 后 theme 已变', JSON.stringify(theme1.body?.data?.theme) === JSON.stringify({ ...baseTheme, ...pvTokens }));

const rs = await api('/admin/ai/theme/reset', { method: 'POST', body: JSON.stringify({}) }, T);
ok('③ reset 恢复默认波普', rs.body?.data?.reset === true && rs.body?.data?.theme?.primary === '#e8336d');

const old = await api('/admin/ai/generate', { method: 'POST', body: JSON.stringify({ mode: 'theme', brief: '测试旧入口' }) }, T);
ok('③ 旧 /generate theme 已封（400）', old.status === 400 && old.body?.code === 'THEME_TWO_STEP');

/* ===== ② 装修页删除 ===== */
const KEY = 'page-e2edel';
await api(`/admin/schema/draft`, { method: 'PUT', body: JSON.stringify({ page: KEY, floors: [] }) }, T);
const del = await api(`/admin/schema/page?page=${KEY}`, { method: 'DELETE' }, T);
ok('② 删除装修页', del.body?.data?.deleted === true, `${del.body?.data?.versions_deleted ?? 0} 版本`);

const delHome = await api('/admin/schema/page?page=home', { method: 'DELETE' }, T);
ok('② home 禁删（400）', delHome.status === 400 && delHome.body?.code === 'BAD_PAGE_PROTECTED');

const delAgain = await api(`/admin/schema/page?page=${KEY}`, { method: 'DELETE' }, T);
ok('② 重复删 404', delAgain.status === 404);

/* ===== ① FAB 活动页 ===== */
const tb0 = await api('/admin/tabbar', {}, T);
const tbItems = tb0.body?.data?.items ?? [];
const baseFab = tb0.body?.data?.fab ?? {};
const baseStyle = tb0.body?.data?.style ?? 'glass';
ok('① 读 tabbar 基线', tbItems.length > 0, `style=${baseStyle}`);

const FAB_KEY = 'page:page-e2efab';
await api('/admin/tabbar', { method: 'PUT', body: JSON.stringify({ items: tbItems, style: baseStyle, fab: { ...baseFab, action: FAB_KEY } }) }, T);
const tb1 = await api('/admin/tabbar', {}, T);
ok('① FAB page: 前缀可保存回读', tb1.body?.data?.fab?.action === FAB_KEY, tb1.body?.data?.fab?.action);

const tbBad = await api('/admin/tabbar', { method: 'PUT', body: JSON.stringify({ items: tbItems, style: baseStyle, fab: { ...baseFab, action: 'page:BAD PAGE!' } }) }, T);
ok('① 非法 page: 值归一回默认', tbBad.body?.data?.fab?.action === 'search', tbBad.body?.data?.fab?.action);

// 还原基线 FAB
await api('/admin/tabbar', { method: 'PUT', body: JSON.stringify({ items: tbItems, style: baseStyle, fab: baseFab }) }, T);
const tb2 = await api('/admin/tabbar', {}, T);
ok('① FAB 基线还原', tb2.body?.data?.fab?.action === baseFab.action, tb2.body?.data?.fab?.action);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
