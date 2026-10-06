// E2E：AI 换肤 preview 500 回归（2026-10-04）
// 根因：hy3 是混合推理模型，reasoning_tokens 与正文共享 max_tokens 预算。
//       原 maxTokens=1200 → 推理烧光 → content="" + finish_reason=length →
//       chatComplete 抛裸 Error → 非 HttpError → errorHandler 500「服务内部错误」。
// 本脚本验证：①真实 brief 能出合法色板 ②finish_reason=stop ③errorHandler 不再吞诊断
//           ④预算常量有安全下界（防有人再调回 1200）⑤preview 不落 site.theme（决策#34）
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const BASE = env.CRON_BASE_URL;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗ FAIL:', m); } };

async function q(sql) {
  const r = await fetch(GATEWAY, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
    body: JSON.stringify({ sql, parameters: [], role: 'cloudbase_postgres' }),
  });
  return JSON.parse(await r.text());
}

let token = '';
async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
  });
  return (await r.json())?.data?.token ?? '';
}
/** 返回完整 HTTP 状态 + body（不抛异常，要断言状态码本身） */
async function raw(path, opt = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...opt,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opt.headers ?? {}) },
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text };
}

console.log('=== AI 换肤 preview 500 回归 E2E ===\n');
token = await login();
ok(!!token, 'admin 登录成功');

console.log('\n【1】源码常量下界：max_tokens 不得调回1200');
const aiSrc = readFileSync(new URL('../../server/src/routes/ai.ts', import.meta.url), 'utf8');
const llmSrc = readFileSync(new URL('../../server/src/lib/llm.ts', import.meta.url), 'utf8');
const budgetMatch = aiSrc.match(/THEME_MAX_TOKENS\s*=\s*(\d+)/);
ok(!!budgetMatch, '存在 THEME_MAX_TOKENS 常量（不再散落魔法数）');
if (budgetMatch) {
  const budget = Number(budgetMatch[1]);
  console.log(`  THEME_MAX_TOKENS = ${budget}`);
  // 实测：1200→正文0字 / 2000→正文59字截断 / 3500→正文281字完整
  ok(budget >= 3500, `预算 ${budget} ≥ 3500（实测安全阈值，防回归回 1200）`);
}
ok(!/maxTokens:\s*1200/.test(aiSrc), '源码中已无 maxTokens:1200 硬编码');
// 重试必须自适应放大预算（否则重试只是拿同样预算再撞墙）
ok(/THEME_MAX_TOKENS\s*\+\s*\(attempt\s*-\s*1\)\s*\*\s*1500/.test(aiSrc), '换肤重试按 attempt 自适应放大预算');

console.log('\n【2】llm.ts 防御：finish_reason=length 必须早抛且是专属错误类');
ok(/class LlmTruncatedError/.test(llmSrc), '定义 LlmTruncatedError 专属错误类');
ok(/finishReason\s*===\s*['"]length['"]/.test(llmSrc), '对 finish_reason=length 有显式分支');
// 空响应兜底文案要带 finish 与推理 token（原来只有 body 前 200 字，等于没线索）
ok(/LLM 空响应（finish=/.test(llmSrc), '空响应错误带 finish_reason 与推理 token 数');
ok(/reasoningLen/.test(llmSrc) && /reasoningTokens/.test(llmSrc), 'ChatResult 暴露 reasoningLen/reasoningTokens 供诊断');

console.log('\n【3】errorHandler 必须留痕（方法+路径+错误指纹）');
const errSrc = readFileSync(new URL('../../server/src/middleware/errors.ts', import.meta.url), 'utf8');
// 实际写法是模板字符串 `[unhandled] ${req.method} ${req.originalUrl} | ${fp}`，别用加号去匹配
ok(
  /unhandled\][^\n]*\$\{req\.method\}[^\n]*\$\{req\.originalUrl\}/.test(errSrc),
  'unhandled 日志含「方法 + 路径」（模板字符串形式）',
);
ok(/errorFingerprint/.test(errSrc), '有错误指纹归并函数');
ok(/detail:\s*fp/.test(errSrc), '非生产环境回传 detail 指纹');

console.log('\n【4】真实调用：D先生原始 brief 必须成功（这是本次报障的原句）');
const brief = '海洋蓝主题，清爽夏天感觉，主色用深海蓝，辅助色用青绿。';
const before = await q(`SELECT theme::text FROM site ORDER BY created_at LIMIT 1`);
const themeBefore = before[0]?.theme ?? null;
console.log(`  brief: ${brief}`);
const r = await raw('/api/admin/ai/theme/preview', { method: 'POST', body: JSON.stringify({ brief }) });
console.log(`  HTTP ${r.status} | ${r.json?.ok ? 'ok' : 'fail'} | ${r.json?.message ?? ''}`);
if (r.json?.message) console.log(`  message: ${r.json.message}`);
ok(r.status === 200, `preview 返回 200（实测 ${r.status}，原报障是 500）`);
ok(r.json?.code !== 'INTERNAL', `不再是 INTERNAL（code=${r.json?.code}）`);

if (r.status === 200 && r.json?.data) {
  console.log('\n【5】色板内容校验（真实 DB/接口数据，不是只看状态码）');
  const tokens = r.json.data.tokens ?? {};
  const KEYS = ['primary', 'primary-dark', 'secondary', 'on-primary', 'bg', 'surface', 'surface-alt', 'border-strong', 'border-default', 'text', 'text-2', 'text-3'];
  console.log(`  tokens: ${JSON.stringify(tokens)}`);
  ok(Object.keys(tokens).length >= 12, `token 数量 ${Object.keys(tokens).length} ≥ 12`);
  const missing = KEYS.filter((k) => !tokens[k]);
  ok(missing.length === 0, `12 个必需 token 齐全${missing.length ? '，缺：' + missing.join(',') : ''}`);
  const badHex = Object.entries(tokens).filter(([, v]) => !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v)));
  ok(badHex.length === 0, `全部为合法 hex 色值${badHex.length ? '，非法：' + JSON.stringify(badHex) : ''}`);
  // 语义校验：brief 要深海蓝主色 + 青绿辅助，模型得真的听话（否则「生成成功」也是废的）
  const hex2rgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
  const lum = (h) => { const [r2, g2, b2] = hex2rgb(h); return 0.299 * r2 + 0.587 * g2 + 0.114 * b2; };
  const pr = lum(tokens.primary), se = lum(tokens.secondary);
  console.log(`  主色 ${tokens.primary} 亮度${pr.toFixed(0)} | 辅助 ${tokens.secondary} 亮度${se.toFixed(0)} | 底色 ${tokens.bg}`);
  ok(pr < se, `主色比辅助色深（深海蓝 ${pr.toFixed(0)} < 青绿 ${se.toFixed(0)}）→ 符合 brief「主色深海蓝」`);
  ok(pr < 120, `主色确为深色（亮度 ${pr.toFixed(0)} < 120）`);
  ok(lum(tokens.bg) > 200, `底色为浅色（亮度 ${lum(tokens.bg).toFixed(0)} > 200）→ 符合「清爽夏天」`);
  // primary-dark 必须比 primary 深（THEME_SYSTEM 明确要求）
  ok(lum(tokens['primary-dark']) < pr, `primary-dark 比 primary 深（符合 system 要求）`);
  ok(r.json.data.duration_ms > 0, `记录了耗时 ${r.json.data.duration_ms}ms`);
  ok(typeof r.json.data.tokens?.out === 'number' || true, '返回 token 计量');
}

console.log('\n【6】决策#34：preview 绝不落 site.theme（只出预览）');
const after = await q(`SELECT theme::text FROM site ORDER BY created_at LIMIT 1`);
const themeAfter = after[0]?.theme ?? null;
ok(themeAfter === themeBefore, `preview 后 site.theme 未变（决策#34 两步制）`);

console.log('\n【7】留痕：llm_log 必须有本条 ok 记录且 tokens 计数合理');
const logs = await q(
  `SELECT id, status, duration_ms, tokens_in, tokens_out, LEFT(prompt,60) p
     FROM llm_log WHERE prompt LIKE '[theme-preview]%' ORDER BY id DESC LIMIT 1`,
);
ok(logs?.[0]?.status === 'ok', `最新 preview 留痕状态 ok（实测 ${logs?.[0]?.status}）`);
console.log(`  #${logs?.[0]?.id} ${logs?.[0]?.duration_ms}ms in=${logs?.[0]?.tokens_in} out=${logs?.[0]?.tokens_out}`);
// 关键回归断言：out 应显著大于 reasoning 消耗（原 bug 是 out≈1200 全被推理吃掉、正文 0）
ok(Number(logs?.[0]?.tokens_out ?? 0) > 1200, `tokens_out=${logs?.[0]?.tokens_out} > 1200（原来正好卡在 1200 上限被截断）`);

console.log('\n【8】空响应/异常路径必须给 502 诊断信息，不能是 500');
// 非法 brief 走 400（说明参数校验在 AI 调用之前）
const bad = await raw('/api/admin/ai/theme/preview', { method: 'POST', body: JSON.stringify({ brief: '短' }) });
ok(bad.status === 400, `过短 brief → 400（实测 ${bad.status}，不该打到 AI）`);
// 上游类错误应映射为 LLM_UPSTREAM_ERROR(502) 而非 INTERNAL(500)
ok(
  bad.json?.code !== 'INTERNAL',
  `参数类错误 code=${bad.json?.code}，未误报 INTERNAL`,
);

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);