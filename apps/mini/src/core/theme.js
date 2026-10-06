import { request } from '../utils/request';
import { SITE_CODE } from './bootstrap';

/**
 * 全站换肤消费端（决策#34 补丁）：
 * 此前 site.theme 只在 SchemaPage 根节点内联生效（首页/H5 首页两处喂了 theme），
 * 内置页（生活服务/会员权益/我的/订单）与 custom-tab-bar 全部吃默认波普色。
 *
 * 本模块一次性拉站点配置缓存 theme，提供：
 * - loadTheme()   拉取并缓存（模块级内存缓存，冷启动刷新；并发去重）
 * - themeStyle()  根节点 :style 字符串（--fyt-xxx 同名覆盖，与渲染器 index.vue 同构）
 * - themeTokens() 原始 token 对象（custom-tab-bar 等非模板场景用）
 * - applyNavBar() 原生导航栏背景跟随 --fyt-bg（微信 frontColor 仅 #ffffff/#000000，按亮度取）
 */
let cached = null; /* { tokens: Record<string,string> } */
let pending = null;

export function loadTheme(force = false) {
  if (!force && cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = request(`/api/site/config?code=${SITE_CODE}`)
    .then((cfg) => {
      const t = cfg?.site?.theme;
      cached = { tokens: (t && typeof t === 'object' && !Array.isArray(t)) ? t : {} };
      return cached;
    })
    .catch(() => {
      cached = cached || { tokens: {} };
      return cached;
    })
    .finally(() => { pending = null; });
  return pending;
}

/** token 键（theme-v1）→ CSS 变量名：'primary-dark' → --fyt-primary-dark */
export function styleFromTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return '';
  return Object.entries(tokens).map(([k, v]) => `--fyt-${k}:${v}`).join(';');
}

/** token 键（theme-v1）→ CSS 变量名：'primary-dark' → --fyt-primary-dark */
export function themeStyle() {
  return styleFromTokens(cached?.tokens ?? {});
}

export function themeTokens() {
  return cached?.tokens ?? {};
}

/**
 * 页面/组件绑定助手：确保 theme 已拉取后把 :style 字符串写到 ctx.pageTheme，
 * 并让原生导航栏跟随 --fyt-bg。配合 main.js 全局 mixin（onLoad 自动调用）
 * 与 ShellView 等 builtin 组件的 created 钩子（组件不触发 onLoad）。
 */
export function ensureTheme(ctx) {
  return loadTheme().then(() => {
    ctx.pageTheme = themeStyle();
    applyNavBar();
  });
}

export function applyNavBar() {
  const bg = cached?.tokens?.bg;
  if (!bg || typeof bg !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(bg)) return;
  try {
    const hex = bg.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    uni.setNavigationBarColor({ frontColor: lum > 0.6 ? '#000000' : '#ffffff', backgroundColor: bg, fail: () => {} });
  } catch (e) { /* 忽略：导航栏保持 pages.json 静态默认 */ }
}
