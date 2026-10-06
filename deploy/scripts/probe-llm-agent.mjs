// LLM agent（智能体）通道探活：ai.bot.sendMessage + LLM_AGENT_ID
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const AGENT_ID = env.LLM_AGENT_ID;
console.log('LLM_AGENT_ID:', AGENT_ID ? `${AGENT_ID.slice(0, 6)}***` : '(空)');

const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: env.TCB_ENV, secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY });
const ai = app.ai();
const t0 = Date.now();
try {
  const res = ai.bot.sendMessage({
    botId: AGENT_ID,
    msg: '回复两个字：在线',
    history: [],
  });
  let text = '';
  for await (const chunk of res.textStream) text += chunk;
  console.log(`agent 探活 OK: ${text.slice(0, 120)} 耗时 ${Date.now() - t0}ms`);
} catch (e) {
  console.error('agent 探活 FAIL:', e.message?.slice(0, 300));
  process.exit(1);
}
