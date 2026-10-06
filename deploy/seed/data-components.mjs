// 23 组件模板库（§6.1，v0.6.9：基础 9 + 增补 14）
// schema_tpl 为渲染器消费的最小属性模板；主题一律走 theme.json，组件内禁止写死色值
export const components = [
  { code: 'swiper', name: '轮播', category: 'basic', schema_tpl: { items: [], autoplay: true, interval: 4000 } },
  { code: 'nav', name: '金刚区', category: 'basic', schema_tpl: { items: [], columns: 5 } },
  { code: 'floor', name: '楼层卡片', category: 'basic', schema_tpl: { title: '', items: [] } },
  // source='haojingke'：四平台货盘统一经蚂蚁星球（haojingke）聚合网关供给，无 jd 直连口径；
  // tabSwitch 的 jd/tb/pdd/vip 对应蚂蚁星球「电商聚合」四平台，self=自营
  { code: 'goods-feed', name: '商品流', category: 'basic', schema_tpl: { source: 'haojingke', tabSwitch: ['jd', 'tb', 'pdd', 'vip', 'self'] } },
  { code: 'coupon-strip', name: '优惠券横条', category: 'marketing', schema_tpl: { items: [] } },
  { code: 'seckill', name: '限时秒杀', category: 'marketing', schema_tpl: { activityId: null } },
  { code: 'notice', name: '公告滚动条', category: 'basic', schema_tpl: { items: [] } },
  { code: 'rich-text', name: '富文本楼层', category: 'basic', schema_tpl: { html: '' } },
  { code: 'float-btn', name: '悬浮按钮', category: 'basic', schema_tpl: { action: { type: 'none' } } },
  { code: 'search-bar', name: '搜索框', category: 'basic', schema_tpl: { sticky: false, placeholder: '搜索商品' } },
  { code: 'category-nav', name: '分类导航', category: 'basic', schema_tpl: { categories: [] } },
  { code: 'member-card', name: '会员卡楼层', category: 'member', schema_tpl: { showIngot: true, showLevel: true } },
  { code: 'coupon-wall', name: '领券中心', category: 'marketing', schema_tpl: { groupBy: 'category' } },
  { code: 'group-buy-floor', name: '团购楼层', category: 'marketing', schema_tpl: { items: [] } },
  { code: 'brand-matrix', name: '品牌矩阵', category: 'marketing', schema_tpl: { tracks: ['plugin', 'halfscreen', 'h5'] } },
  { code: 'activity-floor', name: '活动楼层', category: 'marketing', schema_tpl: { activityId: null } },
  { code: 'ingot-entry', name: '元宝入口卡', category: 'member', schema_tpl: { showExchange: true } },
  { code: 'image-hotzone', name: '图片热区', category: 'marketing', schema_tpl: { img: '', zones: [] } },
  { code: 'video-floor', name: '视频楼层', category: 'marketing', schema_tpl: { src: '', poster: '' } },
  { code: 'countdown', name: '倒计时', category: 'marketing', schema_tpl: { endAt: null } },
  { code: 'invite-floor', name: '邀请裂变楼层', category: 'marketing', schema_tpl: { rewardText: '' } },
  { code: 'popup-modal', name: '弹窗/半屏公告', category: 'marketing', schema_tpl: { mode: 'popup', content: '' } },
  { code: 'divider-blank', name: '分隔线/留白', category: 'layout', schema_tpl: { type: 'divider', size: 16 } },
];

if (components.length !== 23) {
  throw new Error(`[seed] 组件数=${components.length}，与 23 口径不符，禁止落库`);
}
