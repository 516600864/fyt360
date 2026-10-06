/**
 * 自定义 tabBar（决策#28 + mini-01 设计稿 1:1 复刻）。
 * - 布局：粗描边奶油胶囊（4 tab）+ 独立 FAB 圆钮（一键查券），FAB 不占胶囊槽位
 * - 图标：后台 icon/icon_active 字段优先；未配置时按 target.value 用内置图标（icons/*.png）
 * - 激活态：玫红圆角方块 tile + 白色填充图标 + 加粗标签（设计稿同款）
 * - glass=胶囊奶油白90%+毛玻璃增强；classic=同布局实底
 * 本目录为原生源码（custom-tab-bar-src），构建后由 scripts/patch-tabbar.mjs 拷入 dist 根。
 */
Component({
  data: {
    selected: 0,
    items: [],
    style: 'glass',
    fab: { enabled: true, icon: 'sparkle', action: 'search' },
    paths: ['pages/index/index', 'pages/shell/s2', 'pages/shell/s3', 'pages/shell/s4', 'pages/shell/s5'],
    themeStyle: '',
  },
  methods: {
    sync(items, selected, style, fab, theme) {
      if (!items || !items.length) return;
      this.setData({
        items: items.map(function (it) {
          var d = DEF_ICONS[it.target && it.target.value];
          var out = {};
          for (var k in it) out[k] = it[k];
          out._ic = it.icon || (d ? d[0] : '');
          out._icA = it.icon_active || (d ? d[1] : '');
          return out;
        }),
        selected: selected,
        style: style === 'classic' ? 'classic' : 'glass',
        fab: fab && typeof fab.enabled === 'boolean' ? fab : { enabled: true, icon: 'sparkle', action: 'search' },
        themeStyle: toThemeStyle(theme),
      });
    },
    onTap(e) {
      var idx = Number(e.currentTarget.dataset.idx);
      var item = this.data.items[idx];
      if (!item || idx === this.data.selected) return;
      wx.switchTab({ url: '/' + this.data.paths[idx] });
    },
    onTapFab() {
      // FAB 动作（屏 49 可配，action=站内页面标识）：search=全站搜索 07b（默认）；page:page-xxx=活动装修页（决策#34）
      var FAB_URLS = {
        search: '/pages/goods/search-result',
        rights: '/pages/rights/index',
        life: '/pages/rights/category',
        orders: '/pages/orders/index',
        mine: '/pages/mine/index',
      };
      var action = this.data.fab && this.data.fab.action ? this.data.fab.action : 'search';
      if (action === 'home') {
        wx.switchTab({ url: '/pages/index/index', fail: function () {} });
        return;
      }
      if (action.indexOf('page:') === 0) {
        var pageKey = action.slice(5);
        if (/^page-[a-z0-9-]{2,20}$/.test(pageKey)) {
          wx.navigateTo({ url: '/pages/activity/index?page=' + encodeURIComponent(pageKey), fail: function () {} });
          return;
        }
      }
      wx.navigateTo({ url: FAB_URLS[action] || FAB_URLS.search, fail: function () {} });
    },
  },
});

/** 内置默认图标（icons/ 与 custom-tab-bar 同级，绝对路径引用） */
var DEF_ICONS = {
  home: ['/custom-tab-bar/icons/home.png', '/custom-tab-bar/icons/home-active.png'],
  life: ['/custom-tab-bar/icons/life.png', '/custom-tab-bar/icons/life-active.png'],
  rights: ['/custom-tab-bar/icons/rights.png', '/custom-tab-bar/icons/rights-active.png'],
  mine: ['/custom-tab-bar/icons/mine.png', '/custom-tab-bar/icons/mine-active.png'],
};

/** site.theme（12 token）→ CSS 变量内联字符串（--fyt-xxx 同名覆盖，与渲染器/端内 theme.js 同构）。
 *  另派生 --fyt-bg-glass（bg hex → rgba 0.9），供毛玻璃胶囊保持半透明跟色。 */
function toThemeStyle(theme) {
  if (!theme || typeof theme !== 'object') return '';
  var out = [];
  for (var k in theme) {
    if (Object.prototype.hasOwnProperty.call(theme, k)) out.push('--fyt-' + k + ':' + theme[k]);
  }
  var bg = theme['bg'];
  if (typeof bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(bg)) {
    var hex = bg.slice(1);
    out.push('--fyt-bg-glass:rgba(' + parseInt(hex.slice(0, 2), 16) + ',' + parseInt(hex.slice(2, 4), 16) + ',' + parseInt(hex.slice(4, 6), 16) + ',0.9)');
  }
  return out.join(';');
}
