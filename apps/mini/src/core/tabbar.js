import { loadSiteConfig } from './bootstrap';

/**
 * M4 底部菜单（决策#28）：custom-tab-bar + 5 壳页架构。
 * - Tab1 = pages/index/index（首页，固定）
 * - Tab2~5 = pages/shell/s2~s5（壳页，按站点 tabbar 配置渲染 builtin 组件或 Schema 页）
 * - 配置源：GET /api/site/config 的 tabbar 字段（tabbar-v1，后台屏 49 维护）
 * - 未配置时端上回退默认 4 项（与 server DEFAULT_TABBAR 同构）
 */

/** tabBar 注册的 5 个真实页面路径（pages.json 同步维护） */
export const TAB_PATHS = [
  'pages/index/index',
  'pages/shell/s2',
  'pages/shell/s3',
  'pages/shell/s4',
  'pages/shell/s5',
];

/** 端上兜底配置（server 未配置 tabbar 时使用；顺序 1:1 对齐 mini-01 设计稿：生活服务在会员权益前） */
const DEFAULT_TABBAR = [
  { key: 'tab1', name: '首页', icon: '', icon_active: '', target: { type: 'builtin', value: 'home' }, fixed: true },
  { key: 'tab2', name: '生活服务', icon: '', icon_active: '', target: { type: 'builtin', value: 'life' } },
  { key: 'tab3', name: '会员权益', icon: '', icon_active: '', target: { type: 'builtin', value: 'rights' } },
  { key: 'tab4', name: '我的', icon: '', icon_active: '', target: { type: 'builtin', value: 'mine' } },
];

let cached = null; // 模块级缓存，进程内复用（结构 {items, style, fab}）

/** 端上兜底 style/fab（决策#30 定稿：glass + 一键查券 FAB） */
const DEFAULT_META = { style: 'glass', fab: { enabled: true, icon: 'sparkle', action: 'search' } };

/** 拉取并缓存 tabbar 配置（取不到/非法 → 默认 4 项 + glass/FAB 兜底）；theme 随配置透传给 custom-tab-bar */
export async function getTabbarConfig() {
  if (cached) return cached;
  let meta = { ...DEFAULT_META, items: DEFAULT_TABBAR, theme: {} };
  try {
    const cfg = await loadSiteConfig();
    const items = cfg?.tabbar;
    const theme = cfg?.site?.theme && typeof cfg.site.theme === 'object' ? cfg.site.theme : {};
    if (Array.isArray(items) && items.length >= 2 && items[0]?.target?.value === 'home') {
      meta = {
        items,
        style: cfg?.tabbar_style === 'classic' ? 'classic' : 'glass',
        fab:
          cfg?.tabbar_fab && typeof cfg.tabbar_fab.enabled === 'boolean'
            ? cfg.tabbar_fab
            : { ...DEFAULT_META.fab },
        theme,
      };
    } else {
      meta.theme = theme;
    }
  } catch (e) {
    /* 网络失败 → 兜底配置 */
  }
  cached = meta;
  return cached;
}

/**
 * 壳页/首页 onShow 调用：把配置与当前选中序号同步给 custom-tab-bar（强制 setSelected，决策#28）。
 * 非微信端（H5）或 custom-tab-bar 不存在时静默跳过。
 * @param page 页面实例（this）
 * @param ordinal 当前页在 tabBar 中的序号 0~4
 * @param navTitle 可选：按配置名设置导航栏标题（壳页用）
 */
export async function syncTabBar(_page, ordinal, navTitle) {
  // #ifdef MP-WEIXIN
  const cfg = await getTabbarConfig();
  const items = cfg.items;
  const mine = items[ordinal];
  if (navTitle && mine?.name) uni.setNavigationBarTitle({ title: mine.name });
  // vue 组件实例（this）不暴露微信原生 getTabBar，须取 getCurrentPages 顶层页面实例
  const stack = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  const cur = stack[stack.length - 1];
  if (cur && typeof cur.getTabBar === 'function') {
    const bar = cur.getTabBar();
    if (bar && typeof bar.sync === 'function') bar.sync(items, ordinal, cfg.style, cfg.fab, cfg.theme);
  }
  // #endif
}
