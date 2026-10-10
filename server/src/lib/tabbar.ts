/**
 * tabbar-v2 配置归一化（决策#30：毛玻璃 4+1 视觉定稿）。
 * site.tabbar jsonb 兼容两种形态：
 *   v1（历史）：TabbarItem[] 纯数组
 *   v2（当前）：{ v: 2, items: TabbarItem[], style: 'classic'|'glass', fab: { enabled, icon, action } }
 * 读侧统一归一为 v2 结构；style/fab 缺省兜底（定稿 glass + 一键查券 FAB）。
 */

export type TabbarItem = {
  key: string; name: string; icon: string; icon_active: string;
  emoji?: string; emoji_active?: string;
  target: { type: string; value: string }; fixed?: boolean;
};

export type TabbarStyle = 'classic' | 'glass';

export type TabbarFab = { enabled: boolean; icon: string; action: string };

export const TABBAR_STYLE_DEFAULT: TabbarStyle = 'glass';
/** fab.action = 站内页面标识：search=全站搜索 07b（默认）；其余为 builtin 页面值；page:page-xxx=活动装修页（决策#34） */
export const TABBAR_FAB_DEFAULT: TabbarFab = { enabled: true, icon: 'sparkle', action: 'search' };
export const TABBAR_FAB_ACTIONS = ['search', 'home', 'rights', 'life', 'orders', 'mine', 'chat'] as const;
const FAB_ACTION_LEGACY: Record<string, string> = { coupon: 'rights' }; // 旧「领券中心」→ 权益页
const FAB_PAGE_RE = /^page:[a-z0-9-]{2,20}$/;
export function normalizeFabAction(raw: unknown): string {
  const a = FAB_ACTION_LEGACY[String(raw ?? '')] ?? String(raw ?? '');
  if (FAB_PAGE_RE.test(a)) return a; // 活动装修页直通（决策#34）
  return (TABBAR_FAB_ACTIONS as readonly string[]).includes(a) ? a : TABBAR_FAB_DEFAULT.action;
}

/** 归一化任意历史形态 → v2；非法返回 null */
export function normalizeTabbarConfig(raw: unknown): { items: TabbarItem[]; style: TabbarStyle; fab: TabbarFab } | null {
  const v = typeof raw === 'string' ? safeParse(raw) : raw;
  if (Array.isArray(v)) {
    return { items: v as TabbarItem[], style: TABBAR_STYLE_DEFAULT, fab: { ...TABBAR_FAB_DEFAULT } };
  }
  if (v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items)) {
    const o = v as { items: TabbarItem[]; style?: string; fab?: Partial<TabbarFab> };
    return {
      items: o.items,
      style: o.style === 'classic' ? 'classic' : TABBAR_STYLE_DEFAULT,
      fab: {
        enabled: o.fab?.enabled ?? TABBAR_FAB_DEFAULT.enabled,
        icon: String(o.fab?.icon ?? TABBAR_FAB_DEFAULT.icon),
        action: normalizeFabAction(o.fab?.action),
      },
    };
  }
  return null;
}

/** admin PUT 校验：style/fab 合法性（缺省兜底定稿值；fab.action 白名单=站内页面集合） */
export function sanitizeTabbarMeta(style: unknown, fab: unknown): { style: TabbarStyle; fab: TabbarFab } {
  const s: TabbarStyle = style === 'classic' ? 'classic' : TABBAR_STYLE_DEFAULT;
  const f = (fab ?? {}) as Partial<TabbarFab>;
  return {
    style: s,
    fab: {
      enabled: f.enabled !== false, // 缺省开启（定稿 4+1）
      icon: String(f.icon ?? TABBAR_FAB_DEFAULT.icon),
      action: normalizeFabAction(f.action),
    },
  };
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
