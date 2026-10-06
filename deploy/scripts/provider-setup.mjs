// 站点微信凭据录入（provider_config upsert，走 admin API，写后自动失效缓存）
// 用法（凭据经环境变量传入，仓库不落 secret）：
//   PROVIDER_TARGETS='[{"provider":"wechat_mini","apikey":"wx...","api_secret":"..."}]' \
//   node deploy/scripts/provider-setup.mjs
// 可选：PROVIDER_SITE（默认 site-a）
import { loadDotEnv, repoRoot } from './lib/common.mjs';

loadDotEnv();
const API = process.env.ORDERSYNC_URL ? new URL(process.env.ORDERSYNC_URL).origin : 'https://mk.fyt360.cn';
const ADMIN_USER = process.env.ADMIN_INIT_USER ?? 'admin';
const ADMIN_PASS = process.env.ADMIN_INIT_PASSWORD;
if (!ADMIN_PASS) {
  console.error('[provider] .env 缺少 ADMIN_INIT_PASSWORD');
  process.exit(1);
}
const targets = JSON.parse(process.env.PROVIDER_TARGETS ?? 'null');
if (!Array.isArray(targets) || !targets.length) {
  console.error('[provider] 缺少 PROVIDER_TARGETS（JSON 数组：provider/apikey/api_secret）。示例：');
  console.error(`  PROVIDER_TARGETS='[{"provider":"wechat_mini","apikey":"wx...","api_secret":"..."}]' node deploy/scripts/provider-setup.mjs`);
  process.exit(1);
}
const site = process.env.PROVIDER_SITE ?? 'site-a';

const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
});
const login = await loginRes.json();
if (!login.ok) {
  console.error(`[provider] admin 登录失败（${loginRes.status}）：${login.message}${login.data?.must_change_password ? '（密码已被修改，请更新 .env 或改走控制台录入）' : ''}`);
  process.exit(1);
}
const token = login.data.token;
console.log('[provider] admin 登录 OK');

for (const t of targets) {
  const r = await fetch(`${API}/api/site/provider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code: site, provider: t.provider, apikey: t.apikey, api_secret: t.api_secret }),
  });
  const j = await r.json().catch(() => ({}));
  console.log(`[provider] ${t.provider} → HTTP ${r.status} ${j.ok ? 'OK' : JSON.stringify(j.message ?? j)}`);
}

// 验证：
//   wechat_mp  → GET /api/auth/mpconfig 应返回 appid（脱敏打印）
//   wechat_mini→ 用假 code 调 clogin，错误应从 503 未配置 变为 401 微信 code 无效
{
  const r = await fetch(`${API}/api/auth/mpconfig?site=${site}`);
  const j = await r.json().catch(() => ({}));
  const masked = j.data?.appid ? j.data.appid.slice(0, 4) + '****' : JSON.stringify(j.message ?? j);
  console.log(`[verify] wechat_mp appid: HTTP ${r.status} ${masked}`);
}
{
  const r = await fetch(`${API}/api/auth/clogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site, code: 'fake-code-for-verify' }),
  });
  const j = await r.json().catch(() => ({}));
  const verdict = j.code === 'WX_CODE_INVALID' ? 'OK 凭据已生效（微信侧返回 code 无效属预期）' : j.code === 'PROVIDER_NOT_CONFIGURED' ? 'FAIL 仍提示未配置' : '?';
  console.log(`[verify] wechat_mini clogin(fake): HTTP ${r.status} ${j.code} ${verdict}`);
}
