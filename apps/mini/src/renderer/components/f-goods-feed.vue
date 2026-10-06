<template>
  <view class="f-feed">
    <view class="feed-head">
      <text class="feed-title">{{ title }}</text>
      <text class="feed-more-link">{{ more_text }}</text>
    </view>
    <view class="feed-tabs">
      <text
        v-for="t in tabs"
        :key="t.key"
        class="feed-tab"
        :class="{ active: t.key === activeTab }"
        @click="switchTab(t.key)"
      >{{ t.label }}</text>
    </view>
    <view v-if="error" class="feed-state"><text>{{ error }}</text></view>
    <view v-else-if="loading" class="feed-state"><text>商品加载中…</text></view>
    <view v-else-if="!fytFetcher" class="feed-state"><text>数据通道未接通（fetcher 缺失）</text></view>
    <view v-else-if="!items.length" class="feed-state"><text>{{ activeTab === 'self' ? '到店团购商品暂未上架' : '该平台暂无商品' }}</text></view>
    <view v-else class="feed-grid" :class="{ big: isBigLayout }">
      <view v-for="g in items" :key="g.id" class="goods-card" @click="onTap(g)">
        <image class="goods-pic" :src="g.pic" mode="aspectFill" lazy-load />
        <view v-if="showBadge" class="goods-badge"><text>到店团购</text></view>
        <view class="goods-body">
          <text class="goods-title">{{ g.title }}</text>
          <view class="goods-price-row">
            <text class="goods-final">¥{{ g.finalPrice }}</text>
            <text v-if="g.coupon" class="goods-coupon">券 {{ g.coupon }}</text>
          </view>
          <view class="goods-sub-row">
            <text v-if="g.price" class="goods-origin">¥{{ g.price }}</text>
            <text v-if="g.sales" class="goods-sales">已售 {{ g.sales }}</text>
          </view>
        </view>
      </view>
    </view>
    <view v-if="canLoadMore" class="feed-more" @click="load(true)">
      <text>加载更多</text>
    </view>
  </view>
</template>

<script>
/**
 * f-goods-feed 商品流（画布 mini-01 ⑥，CPS 实时透传不入库）：
 * - 平台 Tab 切换（约定② platform_tab），tab 键由楼层 data_source.params.tabs 驱动（prop 名 dataSource，规避 uni-app 双端 kebab-case prop 断链）
 * - 数据经宿主注入的 fytFetcher(path) 拉取（GET /api/goods/{platform}/list?page=&size=）
 * - 返X角标：决策#21 元宝口径 = floor(券后价 × 100) 元宝
 * - 点击卡片 emit goods-tap({item, platform})，转链由宿主接 core/link
 */
const TAB_LABELS = { jd: '京东', tb: '淘宝', pdd: '拼多多', vip: '唯品会', self: '到店团购' };

export default {
  name: 'FGoodsFeed',
  props: {
    title: { type: String, default: '精选好物' },
    more_text: { type: String, default: '更多 >' },
    page_size: { type: Number, default: 10 },
    /** 布局样式（仅 self 数据源生效）：grid=两列 / big=大图单列 */
    layout: { type: String, default: 'grid' },
    /** 到店团购挂标（仅 self 数据源生效）：卡片左上角「到店团购」标识 */
    badge: { type: Boolean, default: false },
    dataSource: { type: Object, default: null },
    /** 兼容旧字段：props.tabSwitch 直接传平台键数组 */
    tabSwitch: { type: Array, default: null },
  },
  inject: { fytFetcher: { default: null } },
  data() {
    return {
      tabs: [],
      activeTab: 'jd',
      items: [],
      page: 1,
      hasMore: false,
      loading: false,
      error: '',
    };
  },
  computed: {
    canLoadMore() {
      return this.hasMore && this.activeTab !== 'tb';
    },
    isBigLayout() {
      return (this.dataSource?.mode ?? '') === 'self' && this.layout === 'big';
    },
    showBadge() {
      return (this.dataSource?.mode ?? '') === 'self' && this.badge;
    },
  },
  created() {
    const keys =
      this.dataSource?.params?.tabs ??
      this.tabSwitch ?? ['jd', 'tb', 'pdd', 'vip'];
    this.tabs = keys.map((k) => ({ key: k, label: TAB_LABELS[k] ?? k }));
    // 数据源模式：self=团购选品（无平台 Tab），platform_tab=CPS 实时透传
    if ((this.dataSource?.mode ?? '') === 'self') {
      this.tabs = [];
      this.activeTab = 'self';
    } else {
      this.activeTab = this.tabs[0]?.key ?? 'jd';
    }
    this.load();
  },
  methods: {
    switchTab(key) {
      if (key === this.activeTab) return;
      this.activeTab = key;
      this.load();
    },
    async load(append = false) {
      if (!this.fytFetcher) return;
      const tab = this.activeTab;
      // self：团购商品库（站内闭环，唯一落库商品），契约与 CPS 对齐
      const path = tab === 'self'
        ? `/api/goods/self/list?page=${append ? this.page + 1 : 1}&size=${this.page_size}`
        : `/api/goods/${tab}/list?page=${append ? this.page + 1 : 1}&size=${this.page_size}`;
      this.loading = !append;
      this.error = '';
      try {
        const page = append ? this.page + 1 : 1;
        const d = await this.fytFetcher(path);
        this.page = page;
        this.items = append ? this.items.concat(d.items ?? []) : (d.items ?? []);
        this.hasMore = !!d.hasMore;
      } catch (e) {
        this.error = e.message || '商品加载失败';
      } finally {
        this.loading = false;
      }
    },
    onTap(g) {
      this.$emit('goods-tap', { item: g, platform: this.activeTab });
    },
  },
};
</script>

<style scoped>
.f-feed {
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  padding: var(--fyt-space-3);
  box-shadow: var(--fyt-shadow-pop);
}
.feed-head { display: flex; align-items: center; justify-content: space-between; }
.feed-title { font-size: 30rpx; font-weight: 900; color: var(--fyt-text); }
.feed-more-link { font-size: 24rpx; color: var(--fyt-text-2); }
.feed-tabs { display: flex; gap: 16rpx; margin: var(--fyt-space-2) 0; flex-wrap: wrap; }
.feed-tab {
  font-size: 24rpx; color: var(--fyt-text-2); font-weight: 700;
  border: var(--fyt-border-thick) solid transparent;
  border-radius: var(--fyt-radius-full); padding: 6rpx 22rpx;
}
.feed-tab.active {
  color: var(--fyt-primary); font-weight: 900;
  border-color: var(--fyt-primary);
  background: var(--fyt-surface-alt);
}
.feed-state {
  background: var(--fyt-surface-alt); border: var(--fyt-border-thick) dashed var(--fyt-border-default);
  border-radius: var(--fyt-radius-lg); padding: var(--fyt-space-6); margin-top: var(--fyt-space-2);
  text-align: center; color: var(--fyt-text-3); font-size: 26rpx;
}
.feed-grid { display: flex; flex-wrap: wrap; gap: 16rpx; margin-top: var(--fyt-space-2); }
.goods-card {
  width: calc(50% - 8rpx);
  box-sizing: border-box; /* 粗描边计入宽度，否则两卡超宽折成单列 */
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  overflow: hidden;
  box-shadow: var(--fyt-shadow-btn);
  position: relative;
}
/* self+big：大图单列布局 */
.feed-grid.big .goods-card { width: 100%; }
.feed-grid.big .goods-pic { height: 420rpx; }
.goods-badge {
  position: absolute; top: 12rpx; left: 12rpx; z-index: 1;
  background: var(--fyt-secondary); color: #fff;
  font-size: 20rpx; font-weight: 800; line-height: 1;
  padding: 6rpx 14rpx; border-radius: var(--fyt-radius-sm);
  border: 2rpx solid rgba(255, 255, 255, 0.55);
}
.goods-pic { width: 100%; height: 320rpx; display: block; background: var(--fyt-surface-alt); }
.goods-body { padding: 16rpx; display: flex; flex-direction: column; gap: 8rpx; }
.goods-title {
  font-size: 26rpx; color: var(--fyt-text); font-weight: 700;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.goods-price-row { display: flex; align-items: baseline; gap: 10rpx; flex-wrap: wrap; }
.goods-final { color: var(--fyt-primary); font-size: 34rpx; font-weight: 900; }
.goods-coupon {
  font-size: 20rpx; color: var(--fyt-on-primary); background: var(--fyt-primary);
  border-radius: var(--fyt-radius-sm); padding: 2rpx 10rpx; font-weight: 700;
}
.goods-sub-row { display: flex; align-items: baseline; gap: 12rpx; }
.goods-origin { color: var(--fyt-text-3); font-size: 22rpx; text-decoration: line-through; }
.goods-sales { color: var(--fyt-text-3); font-size: 22rpx; margin-left: auto; }
.feed-more {
  margin: var(--fyt-space-2) auto 0; width: fit-content;
  padding: 12rpx 48rpx; text-align: center;
  background: var(--fyt-surface-alt); border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-full);
  font-size: 26rpx; color: var(--fyt-primary); font-weight: 700;
}
</style>
