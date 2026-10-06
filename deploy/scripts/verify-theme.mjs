/**
 * A4 L1 换肤端到端验证（真实 LLM）→ site.theme 回读 → /config 下发 → 原样恢复。
 *
 * ⚠️ 2026-10-04 修复：原脚本调的是 /api/admin/ai/generate?mode=theme，
 *    该入口决策#34 已废弃（恒返回 400 THEME_TWO_STEP），脚本**从决策落地那天起就一直是失败的**，
 *    只是没人跑。改为走两步制：POST /ai/theme/preview → POST /ai/theme/apply。
 */
import { readFileSync } from 'node:fs';

const BASE = 'https://mk.fyt360.cn';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const j = (r) => r.json();
const gw = (sql, parameters) => fetch(`https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
  body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
}).then(async (r) => [r.status, r.ok ? JSON.parse(await r.text()) : await r.text()]);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

(async () => {
  const [, sidRows] = await gw(`SELECT site_id::text AS id FROM site WHERE code = 'site-a' LIMIT 1`);
  if (!sidRows?.[0]) { console.error('取 site_id 失败'); process.exit(1); }
  const siteId = sidRows[0].id;

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
  }).then(j);
  const auth = { Authorization: `Bearer ${login.data.token}`, 'Content-Type': 'application/json' };

  const [, themeRows] = await gw(`SELECT theme::text AS t FROM site WHERE site_id = $1::uuid`, [siteId]);
  const origTheme = themeRows[0].t;
  console.log(`[0] 原 theme 已备份（${origTheme.slice(0, 60)} …）\n`);

  try {
    console.log('[1] theme 预览（决策#34 两步制第一步：只生成不落库）');
    const t0 = Date.now();
    const pv = await fetch(`${BASE}/api/admin/ai/theme/preview`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ brief: '海洋蓝主题：清爽夏天，主色深海蓝，辅助色青绿' }),
    }).then(j);
    console.log(`    HTTP 结果 ok=${pv.ok} | ${(Date.now() - t0)}ms | ${pv.message ?? ''}`);
    ok(pv.ok, `preview 成功（原来这一环直接 500：code=${pv.code ?? '-'}）`);
    if (!pv.ok) { console.log('\n失败即中止'); process.exit(1); }
    const tokens = pv.data.tokens ?? {};
    console.log(`    主色=${tokens.primary} 辅助=${tokens.secondary} 底色=${tokens.bg} token数=${Object.keys(tokens).length}`);
    ok(Object.keys(tokens).length >= 12, '色板 ≥12 个 token');

    // 预览阶段绝不能落库（决策#34 的核心约束）
    const [, midRows] = await gw(`SELECT theme::text AS t FROM site WHERE site_id = $1::uuid`, [siteId]);
    ok(midRows[0].t === origTheme, 'preview 后 site.theme 未变（两步制铁律）');

    console.log('\n[2] apply（第二步：确认后才生效）');
    const ap = await fetch(`${BASE}/api/admin/ai/theme/apply`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ tokens, brief: 'E2E 换肤落库' }),
    }).then(j);
    ok(ap.ok && ap.data?.applied === true, `apply 成功（merged_keys=${ap.data?.merged_keys ?? '-'}）`);
    if (!ap.ok) process.exit(1);

    console.log('\n[3] site.theme 回读一致');
    const [, afterRows] = await gw(`SELECT theme::text AS t FROM site WHERE site_id = $1::uuid`, [siteId]);
    const saved = JSON.parse(afterRows[0].t);
    const miss = Object.entries(tokens).filter(([k, v]) => saved[k] !== v);
    ok(miss.length === 0, `生成的 ${Object.keys(tokens).length} 个键全部一致落库${miss.length ? '，缺：' + JSON.stringify(miss) : ''}`);

    console.log('\n[4] /site/config 下发给端上（⚠️ 须带登录态，且路径是 data.site.theme）');
    const cfg = await fetch(`${BASE}/api/site/config?code=site-a`, { headers: { Authorization: auth.Authorization } }).then(j);
    const cfgTheme = typeof cfg.data?.site?.theme === 'string' ? JSON.parse(cfg.data.site.theme) : cfg.data?.site?.theme;
    ok(cfgTheme?.primary === tokens.primary, `主色下发一致 primary=${cfgTheme?.primary}`);

    console.log('\n[5] rollback 可逐级撤销');
    const rb = await fetch(`${BASE}/api/admin/ai/theme/rollback`, { method: 'POST', headers: auth, body: '{}' }).then(j);
    ok(rb.ok && rb.data?.rolled_back === true, `rollback 成功（回到 ${rb.data?.theme?.primary ?? '-'}）`);
  } finally {
    const [st] = await gw(`UPDATE site SET theme = $2::jsonb, updated_at = now() WHERE site_id = $1::uuid`, [siteId, origTheme]);
    console.log(`\n[6] 原 theme 恢复 = ${st === 200 ? 'OK' : 'FAIL'}`);
  }
  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });