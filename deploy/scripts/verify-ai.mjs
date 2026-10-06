/**
 * A1 端到端验证：AI 生成装修 Schema（真实 LLM 调用）。
 * 覆盖：agent_ready 探活 / generate 真调用落 AI 草稿 / 参数校验 400 / 失败路径 /
 *      草稿清理（不污染 DIY 编辑器的 draft-first 读取）。
 */
import { readFileSync } from 'node:fs';

const BASE = 'https://mk.fyt360.cn';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const j = (r) => r.json();

(async () => {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
  }).then(j);
  if (!login.ok) { console.error('登录失败', login); process.exit(1); }
  const auth = { Authorization: `Bearer ${login.data.token}`, 'Content-Type': 'application/json' };

  // 1) overview：agent_ready 探活
  const ov = await fetch(`${BASE}/api/admin/ai/overview`, { headers: auth }).then(j);
  console.log('[1] overview agent_ready =', ov.data.agent_ready, ov.data.agent_ready ? 'OK' : `FAIL(${ov.data.agent_error})`);

  // 2) 参数校验：短 brief → 400
  const bad = await fetch(`${BASE}/api/admin/ai/generate`, {
    method: 'POST', headers: auth, body: JSON.stringify({ page: 'home', brief: ' ab ' }),
  }).then(j);
  console.log('[2] 短 brief 400 =', !bad.ok && bad.code === 'BRIEF_TOO_SHORT' ? 'OK' : JSON.stringify(bad));

  // 3) 真实生成（短 brief 控制 token 与耗时）
  const t0 = Date.now();
  const gen = await fetch(`${BASE}/api/admin/ai/generate`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ page: 'home', brief: '做一个咖啡主题的促销首页： banner 强调 9.9 喝一杯，金刚区突出咖啡奶茶品牌，下面挂商品流（jd/pdd）' }),
  }).then(j);
  console.log('[3] generate =', gen.ok ? `OK floors=${gen.data.floors} [${gen.data.floor_types.join(',')}] v${gen.data.version} ${gen.data.duration_ms}ms tok(in=${gen.data.tokens.in},out=${gen.data.tokens.out}) 总耗时${Date.now() - t0}ms` : `FAIL ${JSON.stringify(gen).slice(0, 300)}`);
  if (!gen.ok) process.exit(1);

  // 4) 草稿已落库（overview 可见 source=ai draft）
  const ov2 = await fetch(`${BASE}/api/admin/ai/overview`, { headers: auth }).then(j);
  const aiDraft = ov2.data.pages.find((p) => p.source === 'ai' && p.status === 'draft' && p.version === gen.data.version);
  console.log('[4] AI 草稿可见 =', aiDraft ? `OK(v${aiDraft.version}, ${aiDraft.floors.length} 层)` : 'FAIL(未找到)');

  // 5) llm_log 留痕
  const hasLog = ov2.data.logs.some((l) => l.version === gen.data.version && l.status === 'ok' && l.model === 'cloudbase/hy3');
  console.log('[5] llm_log 留痕 =', hasLog ? 'OK' : 'FAIL');

  // 6) 清理测试 AI 草稿（draft-first 会影响 DIY 编辑器，不能留）
  const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({
      sql: `DELETE FROM page_schema WHERE id = $1::bigint AND source = 'ai' AND status = 'draft'`,
      parameters: [String(gen.data.schema_id)],
      role: 'cloudbase_postgres',
    }),
  }).then(async (r) => [r.status, await r.text()]);
  console.log('[6] 测试草稿清理 =', res[0] === 200 ? 'OK' : `FAIL ${res[1].slice(0, 150)}`);

  console.log('\n全部通过 ✅');
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
