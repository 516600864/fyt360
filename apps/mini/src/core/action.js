import { request, API_BASE } from '../utils/request';

/**
 * 统一 Action 协议落地（§6.1 约定①）：首页与 M4 壳页共用。
 * popup 类型已由渲染器内置弹层处理，这里只落 jump/plugin-launch/activity。
 */
// tabBar 壳页（pages.json tabBar.list，与 admin DIY 页面注册表 tab:true 同步维护）：
// navigateTo 跳 tab 页必 fail，必须 switchTab（且不能携带参数）
const TAB_PAGES = new Set([
  'pages/index/index',
  'pages/shell/s2',
  'pages/shell/s3',
  'pages/shell/s4',
  'pages/shell/s5',
]);

/**
 * 分包路径兼容映射（2026-10-09 主包超 2MB 分包改造）：
 * DB 存量（DIY 楼层/菜单配置）与服务端下发（link.ts 卡片路径）仍存旧版主包路径
 * （旧客户端照常工作），新客户端在此统一翻译成分包路径。
 * 规则与 pages.json subPackages 严格同步；rights/index、rights/category 留主包不映射。
 */
const LEGACY_PAGE_MAP = {
  'pages/goods/': 'pkg-goods/pages/goods/',
  'pages/orders/': 'pkg-goods/pages/orders/',
  'pages/trade/': 'pkg-goods/pages/trade/',
  'pages/verify/': 'pkg-goods/pages/verify/',
  'pages/activity/': 'pkg-goods/pages/activity/',
  'pages/mine/': 'pkg-user/pages/mine/',
  'pages/profile/': 'pkg-user/pages/profile/',
  'pages/commission/': 'pkg-user/pages/commission/',
};
const RIGHTS_SUB = /^(pages\/rights\/(grade|records|levels|ingot|coupons))\b/;

/** 把可能来自存量配置的页面路径解析为当前分包路径；已是新路径/主包路径原样返回 */
export function resolvePage(url) {
  if (typeof url !== 'string' || !url.includes('/pages/')) return url;
  let bare = url.replace(/^\//, '');
  for (const [oldP, newP] of Object.entries(LEGACY_PAGE_MAP)) {
    if (bare.startsWith(oldP)) return url.replace(oldP, newP);
  }
  const m = bare.match(RIGHTS_SUB);
  if (m) return url.replace(m[1], 'pkg-rights/' + m[1]);
  return url;
}

export function handleAction(a) {
  const act = a ?? {};
  if (act.type === 'jump' && act.target === 'page' && act.value) {
    const value = resolvePage(act.value);
    const bare = value.split('?')[0].replace(/^\//, '');
    if (TAB_PAGES.has(bare)) {
      uni.switchTab({ url: '/' + bare, fail: () => uni.showToast({ title: '页面建设中', icon: 'none' }) });
      return;
    }
    uni.navigateTo({ url: value, fail: () => uni.showToast({ title: '页面建设中', icon: 'none' }) });
    return;
  }
  if (act.type === 'jump' && act.target === 'h5' && act.value) {
    uni.navigateTo({ url: '/pages/webview/index?src=' + encodeURIComponent(act.value), fail: () => uni.showToast({ title: '页面建设中', icon: 'none' }) });
    return;
  }
  if (act.type === 'jump' && act.target === 'weapp' && act.value) {
    // value=目标小程序 appId，params.path=内页路径
    uni.navigateToMiniProgram({
      appId: act.value,
      path: act.params?.path ?? '',
      fail: () => uni.showToast({ title: '小程序跳转失败', icon: 'none' }),
    });
    return;
  }
  if (act.type === 'plugin-launch' && act.value) {
    // 品牌呼起：读 brand_action_cfg.miniapp_cfg（未录入 → 诚实提示，不造假映射）
    // mode=halfscreen（蚂蚁星球半屏，009）→ wx.openEmbeddedMiniProgram；mode=plugin（010）→ 插件路径；h5url（016）→ 复制链接
    request(`/api/site/brand-launch?code=${encodeURIComponent(act.value)}`)
      .then((d) => {
        if (d.mode === 'plugin' && d.path) {
          // 插件分包化（2026-10-09 主包瘦身）：ordering/tg 声明在 pkg-mayi，
          // 分包外页面不能直接跳分包内插件页 → 统一经 pkg-mayi 中转页（官方允许路径）
          uni.navigateTo({
            url: '/pkg-mayi/pages/plugin-jump?path=' + encodeURIComponent(d.path),
            fail: () => uni.showToast({ title: '插件页打开失败，请更新小程序版本', icon: 'none' }),
          });
          return;
        }
        if (d.mode === 'h5url' && (d.url || d.tkl)) {
          // tb 活动转链带真淘口令（2026-09-30 D先生 指令：淘宝类跳转一律中转口令页展示口令，
          // 与商详 goUnion tb 分支同款协议，画布 mini-04 / 决策#14）；无 tkl 才降级复制链接
          if (d.tkl) {
            const tklQs =
              'tkl=' + encodeURIComponent(d.tkl) +
              '&title=' + encodeURIComponent(d.name || 'FYT360 淘宝特惠');
            uni.navigateTo({
              url: '/pages/tkl/index?url=' + encodeURIComponent(API_BASE + '/tkl.html?' + tklQs),
              fail: () =>
                uni.setClipboardData({
                  data: d.tkl,
                  success: () => uni.showToast({ title: '淘口令已复制，打开淘宝粘贴', icon: 'none' }),
                }),
            });
            return;
          }
          uni.setClipboardData({
            data: d.url,
            success: () => uni.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' }),
          });
          return;
        }
        // #ifdef MP-WEIXIN
        if (d.mode === 'halfscreen' && typeof wx !== 'undefined' && wx.openEmbeddedMiniProgram) {
          wx.openEmbeddedMiniProgram({
            appId: d.appid,
            path: d.path ?? '',
            envVersion: 'release',
            fail: () => uni.showToast({ title: '呼起失败，需在小程序后台添加该半屏小程序', icon: 'none' }),
          });
          return;
        }
        // #endif
        uni.navigateToMiniProgram({
          appId: d.appid,
          path: d.path ?? '',
          fail: () => uni.showToast({ title: '小程序跳转失败', icon: 'none' }),
        });
      })
      .catch((e) => uni.showToast({ title: e.message ?? '呼起配置未录入', icon: 'none' }));
    return;
  }
  if (act.type === 'activity') {
    // 活动页（决策#33）：value = 装修页 key（page-xxxx）→ 活动壳页渲染该页 published Schema
    if (/^page-[a-z0-9]{2,10}$/.test(String(act.value ?? ''))) {
      uni.navigateTo({
        url: '/pkg-goods/pages/activity/index?page=' + encodeURIComponent(act.value) + (act.title ? '&title=' + encodeURIComponent(act.title) : ''),
        fail: () => uni.showToast({ title: '活动页打开失败', icon: 'none' }),
      });
    } else {
      uni.showToast({ title: '活动页未配置', icon: 'none' });
    }
    return;
  }
  uni.showToast({ title: '功能建设中', icon: 'none' });
}
