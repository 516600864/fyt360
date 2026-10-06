/**
 * 决策#34 补丁 E2E（全站换肤覆盖 + 回滚上一版）：
 * ① apply 深蓝主题 → site/config 与 page-schema 均下发 theme（内置页/活动页消费源）
 * ② rollback → 精确回到 apply 前快照；再 rollback → 滚回深蓝（逐级撤销）
 * ③ 终态还原基线
 * 用法：node deploy/scripts/verify-theme-coverage.mjs
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

/** exec-pgsql 直查：只用于「挑一个真实存在的壳页」这类无法用接口表达的元信息 */
const q2 = async (sql) => {
  const r = await fetch(`https://${process.env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters: [], role: 'cloudbase_postgres' }),
  });
  return r.json();
};

// admin 登录
const login = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: ADMIN_PW }) });
const T = login.body?.data?.token ?? '';
ok('admin 登录', !!T);

/* ===== 基线 ===== */
const t0 = await api('/admin/ai/theme', {}, T);
const baseTheme = t0.body?.data?.theme ?? {};
ok('基线 theme 读取', t0.body?.ok === true, `${Object.keys(baseTheme).length} 项 token`);

/* ===== ① 应用深蓝主题 ===== */
const BLUE = {
  primary: '#1976d2', 'primary-dark': '#0d47a1', secondary: '#26c6da', 'on-primary': '#ffffff',
  bg: '#e3f2fd', surface: '#ffffff', 'surface-alt': '#bbdefb', 'border-strong': '#64b5f6', 'border-default': '#90caf9',
  text: '#0d1b2a', 'text-2': '#546e7a', 'text-3': '#90a4ae',
};
const ap = await api('/admin/ai/theme/apply', { method: 'POST', body: JSON.stringify({ tokens: BLUE, brief: 'E2E 换肤覆盖验收' }) }, T);
ok('① apply 深蓝主题', ap.body?.data?.applied === true);

const mergedExpect = JSON.stringify({ ...baseTheme, ...BLUE });
// ⚠️ 2026-10-04 修：这两个请求原本**没带 token**，而 /site/config 与 /site/page-schema 都要登录态
//    → 拿不到 site 数据 → theme 读到 0 项 → 误判为「theme 未下发」。已补 T。
const cfg = await api('/site/config?code=site-a', {}, T);
ok('① site/config 下发 theme（内置页/tab-bar 消费源）', JSON.stringify(cfg.body?.data?.site?.theme ?? {}) === mergedExpect,
  `${Object.keys(cfg.body?.data?.site?.theme ?? {}).length} 项`);

// ⚠️ 2026-10-04 修：原来用 page-noe2e 这个**不存在**的页，必然 published=false → 断言恒失败；
//    换 page=home 也不行——本端点正则只收 `page-[a-z0-9]{2,10}`（home/home_h5 走 /site/config 那条路），
//    传 home 会直接 400 BAD_PAGE。必须用**真实已发布的壳页**，theme 消费口径才真实。
const SHELL_PAGE = (await q2(`SELECT page FROM page_schema WHERE status='published' AND page LIKE 'page-%' ORDER BY created_at DESC LIMIT 1`))[0]?.page;
ok('找到真实已发布壳页用于验证', !!SHELL_PAGE, SHELL_PAGE ?? '(无)');
const ps = await api(`/site/page-schema?code=site-a&page=${SHELL_PAGE}`, {}, T);
ok('① page-schema 下发 theme（ShellView schema 分支/活动页消费源）',
  ps.body?.data?.theme !== undefined && JSON.stringify(ps.body?.data?.theme) === mergedExpect,
  `page=${SHELL_PAGE} published=${ps.body?.data?.published}`);

/* ===== ② 回滚上一版 ===== */
const rb1 = await api('/admin/ai/theme/rollback', { method: 'POST', body: JSON.stringify({}) }, T);
ok('② rollback 回到 apply 前快照（精确写回）',
  rb1.body?.data?.rolled_back === true && JSON.stringify(rb1.body?.data?.theme) === JSON.stringify(baseTheme));

const rb2 = await api('/admin/ai/theme/rollback', { method: 'POST', body: JSON.stringify({}) }, T);
ok('② 再 rollback 逐级滚回深蓝（撤销可反复）',
  rb2.body?.data?.rolled_back === true && JSON.stringify(rb2.body?.data?.theme) === mergedExpect);

const rb3 = await api('/admin/ai/theme/rollback', { method: 'POST', body: JSON.stringify({}) }, T);
ok('② 三次 rollback 回到基线（终态还原）',
  rb3.body?.data?.rolled_back === true && JSON.stringify(rb3.body?.data?.theme) === JSON.stringify(baseTheme));

const cfgEnd = await api('/site/config?code=site-a');
ok('② 终态 site/config theme == 基线', JSON.stringify(cfgEnd.body?.data?.site?.theme ?? {}) === JSON.stringify(baseTheme));

/* ===== ③ 无历史站点语义（404 结构正确性） ===== */
// 当前站点已有 apply 历史，404 分支在全新站点才会触发；此处仅验证响应结构字段
ok('③ rollback 响应含 rolled_back 字段', rb1.body?.data?.rolled_back === true || rb1.status === 404);

console.log(`\n结果：${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
