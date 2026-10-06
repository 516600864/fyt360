// 自建智能体探活：list → (缺则)create → sendMessage
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const tcb = require('@cloudbase/node-sdk');
const app = tcb.init({ env: env.TCB_ENV, secretId: env.TCB_SECRET_ID, secretKey: env.TCB_SECRET_KEY });
const ai = app.ai();

// ① 列出现有 bot
let bots = [];
try {
  const lst = await ai.bot.list({ pageNumber: 1, pageSize: 20 });
  bots = lst?.bots ?? lst?.data ?? [];
  console.log('现有 bot:', bots.length, bots.map((b) => `${b.botId}:${b.name}`).join(' | '));
} catch (e) {
  console.error('list FAIL:', e.message?.slice(0, 200));
}

// ② 找装修助手，没有就建
let bot = bots.find((b) => b.name === 'FYT360装修助手');
if (!bot) {
  console.log('创建 FYT360装修助手 ...');
  try {
    const created = await ai.bot.create({
      botInfo: {
        botId: '',
        name: 'FYT360装修助手',
        introduction: 'FYT360 页面装修 Schema 生成器',
        agentSetting: '你是 FYT360 平台的页面装修助手，负责按用户描述输出页面装修 JSON（page-v1 合同）。只输出 JSON，不输出任何其他文字。',
        welcomeMessage: '',
        avatar: '',
        background: '',
        tags: ['装修'],
        isNeedRecommend: false,
        knowledgeBase: [],
        type: 'custom',
        initQuestions: [],
        enable: true,
      },
    });
    console.log('create 响应:', JSON.stringify(created).slice(0, 300));
    bot = created?.bot ?? created?.data ?? null;
  } catch (e) {
    console.error('create FAIL:', e.message?.slice(0, 300));
    process.exit(1);
  }
}
const botId = bot?.botId ?? bot?.id;
console.log('botId:', botId);

// ③ 发消息测试
const t0 = Date.now();
try {
  const res = ai.bot.sendMessage({ botId, msg: '回复两个字：在线', history: [] });
  let text = '';
  for await (const chunk of res.textStream) text += chunk;
  console.log(`sendMessage OK: ${text.slice(0, 150)} 耗时 ${Date.now() - t0}ms`);
} catch (e) {
  console.error('sendMessage FAIL:', e.message?.slice(0, 300));
  process.exit(1);
}
