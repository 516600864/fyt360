// LLM 通道探活：验证 @cloudbase/node-sdk AI（generateText）凭据与权限（本地读 .env；容器内同库同模式）
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({
  env: env.TCB_ENV,
  secretId: env.TCB_SECRET_ID,
  secretKey: env.TCB_SECRET_KEY,
});
const ai = app.ai();
const CANDIDATES = [
  ['hunyuan-exp', 'hunyuan-turbos-latest'],
  ['deepseek', 'deepseek-v3.2'],
];
const t0 = Date.now();
let ok = false;
for (const [provider, model] of CANDIDATES) {
  try {
    const m = ai.createModel(provider);
    const res = await m.generateText({ model, messages: [{ role: 'user', content: '回复两个字：在线' }] });
    console.log(`探活 OK [${provider}/${model}]:`, JSON.stringify(res.text), `耗时 ${Date.now() - t0}ms`, 'usage:', JSON.stringify(res.usage));
    ok = true;
    break;
  } catch (e) {
    console.error(`FAIL [${provider}/${model}]:`, e.message?.slice(0, 200));
    const detail = e.response?.data ?? e.rawResponse?.data ?? e.body ?? null;
    if (detail) console.error('  detail:', JSON.stringify(detail).slice(0, 400));
    console.error('  code:', e.code, 'status:', e.response?.status ?? e.statusCode);
  }
}
if (!ok) process.exit(1);
