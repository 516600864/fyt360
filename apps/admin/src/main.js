import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import App from './App.vue';
import router from './router';
import './styles/tokens.css';

// 全局 fetch 包装：/api 请求自动带 token + 活动站点上下文（决策#27 会话单站）
// ⛔ 2026-10-05：站点头**唯一写入点**。lib/api.js 曾在这里之外再写一次大写 'X-Fyt-Site'，
//   两个大小写变体共存 → fetch Headers 合并成 "code, code" → 服务端查库 403（真实故障）。
// ⛔ 显式传入则尊重（pay/index.vue 在平台工作台跨站操作时自己带 x-fyt-site），
//   不能无条件覆盖——那会把跨站意图悄悄换成当前会话站点。
const rawFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url ?? '';
  if (url.startsWith('/api')) {
    const headers = { ...init.headers };
    const token = localStorage.getItem('fyt_admin_token');
    if (token && !headers.Authorization) headers.Authorization = 'Bearer ' + token;
    if (!headers['x-fyt-site'] && !headers['X-Fyt-Site']) {
      let site = null;
      try { site = JSON.parse(localStorage.getItem('fyt_admin_site') ?? 'null'); } catch { /* ignore */ }
      if (site?.scope === 'site' && site.code) headers['x-fyt-site'] = site.code;
    }
    init = { ...init, headers };
  }
  return rawFetch(input, init);
};

createApp(App).use(router).use(ElementPlus).mount('#app');
