<template>
  <view class="glist" :style="pageTheme">
    <!-- 搜索框（回显关键词） -->
    <view class="search-bar">
      <view class="s-icon"><text>‹</text></view>
      <view class="s-box">
        <text class="s-glass">🔍</text>
        <input v-model="kw" class="s-input" :maxlength="30" placeholder="搜索商品" placeholder-class="s-ph" confirm-type="search" @confirm="research" />
        <view class="s-btn" @tap="research"><text class="s-btn-t">搜索</text></view>
      </view>
    </view>

    <!-- 平台 tabs -->
    <scroll-view scroll-x class="plats">
      <view class="plats-row">
        <text
          v-for="p in plats"
          :key="p.key"
          class="plat"
          :class="{ on: platform === p.key }"
          @tap="switchPlat(p.key)"
        >{{ p.name }}</text>
      </view>
    </scroll-view>

    <!-- 排序条 -->
    <view class="sorts">
      <text class="sort" :class="{ on: sort === '' }" @tap="switchSort('')">综合▾</text>
      <text class="sort" :class="{ on: sort === 'sale' }" @tap="switchSort('sale')">销量</text>
      <text class="sort" :class="{ on: sort.startsWith('price') }" @tap="switchSort(sort === 'price_up' ? 'price_down' : 'price_up')">价格↕</text>
      <text class="sort" :class="{ on: couponOnly }" @tap="toggleCoupon">券额</text>
    </view>

    <!-- 双列商品瀑布 -->
    <view v-if="!loading && !items.length" class="tip">
      <text class="tip-emoji">🔍</text>
      <text class="tip-title">没有找到相关商品</text>
      <text class="tip-desc">换个关键词或切换平台试试</text>
    </view>
    <view v-else class="cols">
      <view class="col">
        <view v-for="g in colA" :key="g.key" class="g-card" @tap="onTap(g)">
          <image class="g-pic" :src="g.pic" mode="aspectFill" />
          <view class="g-body">
            <text class="g-title">{{ g.title }}</text>
            <view v-if="g.coupon > 0" class="g-coupon"><text class="g-coupon-t">¥{{ fmtInt(g.coupon) }} 券</text></view>
            <view class="g-price-row">
              <text class="g-price"><text class="g-y">¥</text>{{ fmt(g.finalPrice ?? g.price) }}</text>
              <text v-if="g.finalPrice != null && g.price > g.finalPrice" class="g-market">¥{{ fmt(g.price) }}</text>
            </view>
            <text v-if="g.sales" class="g-sales">已售 {{ fmtSales(g.sales) }}</text>
          </view>
        </view>
      </view>
      <view class="col">
        <view v-for="g in colB" :key="g.key" class="g-card" @tap="onTap(g)">
          <image class="g-pic" :src="g.pic" mode="aspectFill" />
          <view class="g-body">
            <text class="g-title">{{ g.title }}</text>
            <view v-if="g.coupon > 0" class="g-coupon"><text class="g-coupon-t">¥{{ fmtInt(g.coupon) }} 券</text></view>
            <view class="g-price-row">
              <text class="g-price"><text class="g-y">¥</text>{{ fmt(g.finalPrice ?? g.price) }}</text>
              <text v-if="g.finalPrice != null && g.price > g.finalPrice" class="g-market">¥{{ fmt(g.price) }}</text>
            </view>
            <text v-if="g.sales" class="g-sales">已售 {{ fmtSales(g.sales) }}</text>
          </view>
        </view>
      </view>
    </view>

    <view v-if="loading" class="foot"><text>加载中…</text></view>
    <view v-else-if="!hasMore && items.length" class="foot"><text>— 已经到底啦 —</text></view>
  </view>
</template>

<script>
/**
 * 商品列表（M7，画布 mini-08 对齐）：平台 tabs + 排序条 + 双列瀑布 + 上拉加载 + 点击转链。
 * 数据：GET /api/goods/:platform/list（CPS 实时透传不落库；self=团购库）。
 * 排序能力（上游实测 2026-09-28）：jd=sortname(sale/price)+sort；pdd=sort_type(2=销量)；
 * tb/vip/self 上游无已验证排序枚举 → 排序点击回落综合（诚实降级，不猜接口）。
 * tb 游标分页：翻页回传服务端下发的 cursor（min_id）。
 */
import { request } from '../../utils/request';
import { onGoodsTap } from '../../core/link';

const PLATS = [
  { key: 'jd', name: '京东' },
  { key: 'tb', name: '淘宝' },
  { key: 'pdd', name: '拼多多' },
  { key: 'vip', name: '唯品会' },
  { key: 'self', name: '到店团购' },
];
const PAGE_SIZE = 10;

/** 排序 → 各平台透传参数（仅映射已验证项；其余平台返回 {} 即综合） */
function sortParams(platform, sort, couponOnly) {
  const p = {};
  if (couponOnly && platform === 'jd') p.iscoupon = '1';
  if (couponOnly && platform === 'pdd') p.with_coupon = '1';
  if (platform === 'jd') {
    if (sort === 'sale') { p.sortname = 'sale'; p.sort = '1'; }
    if (sort === 'price_up') { p.sortname = 'price'; p.sort = '0'; }
    if (sort === 'price_down') { p.sortname = 'price'; p.sort = '1'; }
  } else if (platform === 'pdd') {
    if (sort === 'sale') p.sort_type = '2';
  }
  return p;
}

export default {
  data() {
    return {
      kw: '',
      platform: 'jd',
      sort: '',
      couponOnly: false,
      items: [],
      page: 1,
      cursor: null, // tb 游标
      hasMore: false,
      loading: false,
      plats: PLATS,
    };
  },
  computed: {
    colA() {
      return this.items.filter((_, i) => i % 2 === 0);
    },
    colB() {
      return this.items.filter((_, i) => i % 2 === 1);
    },
  },
  onLoad(q) {
    const plat = String(q?.platform ?? 'jd');
    if (PLATS.some((p) => p.key === plat)) this.platform = plat;
    this.kw = String(q?.kw ?? '');
    this.reload();
  },
  onReachBottom() {
    if (this.hasMore && !this.loading) this.load(true);
  },
  methods: {
    fmt(n) {
      const v = Number(n ?? 0);
      return v % 1 === 0 ? String(v) : v.toFixed(2).replace(/0$/, '');
    },
    fmtInt(n) {
      return Number(n ?? 0).toLocaleString('zh-CN');
    },
    fmtSales(n) {
      const v = Number(n ?? 0);
      if (v >= 10000) return `${(v / 10000).toFixed(1)}万+`;
      return v.toLocaleString('zh-CN');
    },
    switchPlat(k) {
      if (this.platform === k) return;
      this.platform = k;
      this.sort = '';
      this.couponOnly = false;
      this.reload();
    },
    switchSort(s) {
      if (this.sort === s) return;
      this.sort = s;
      this.reload();
    },
    toggleCoupon() {
      this.couponOnly = !this.couponOnly;
      this.reload();
    },
    research() {
      this.reload();
    },
    async reload() {
      this.page = 1;
      this.cursor = null;
      this.items = [];
      await this.load(false);
    },
    async load(append) {
      this.loading = true;
      try {
        const q = [`page=${this.page}`, `size=${PAGE_SIZE}`];
        if (this.kw.trim()) q.push(`keyword=${encodeURIComponent(this.kw.trim())}`);
        // tb 游标翻页
        if (this.platform === 'tb' && append && this.cursor) q.push(`min_id=${encodeURIComponent(this.cursor)}`);
        Object.entries(sortParams(this.platform, this.sort, this.couponOnly)).forEach(([k, v]) => q.push(`${k}=${v}`));
        const d = await request(`/api/goods/${this.platform}/list?${q.join('&')}`);
        const fresh = (d.items ?? []).map((g) => ({ ...g, key: `${this.platform}-${g.id}-${Math.random().toString(36).slice(2, 6)}` }));
        this.items = append ? [...this.items, ...fresh] : fresh;
        this.hasMore = !!d.hasMore;
        this.cursor = d.cursor ?? null;
        if (append) this.page += 1;
      } catch (e) {
        if (!append) this.items = [];
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      } finally {
        this.loading = false;
      }
    },
    onTap(g) {
      // 团购商品 → 团购详情（交易链）；CPS → 转链跳转（core/link 统一协议）
      if (this.platform === 'self' && g.raw?.goods_id) {
        uni.navigateTo({ url: `/pages/goods/self-detail?id=${g.raw.goods_id}` });
        return;
      }
      onGoodsTap({ ...g, platform: this.platform });
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.glist { min-height: 100vh; background: $fyt-surface; padding-bottom: 40rpx; }

.search-bar { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 32rpx; }
.s-icon {
  width: 60rpx; height: 60rpx; border-radius: 50%; background: #fff;
  border: 3rpx solid var(--fyt-primary, #e8336d); display: flex; align-items: center; justify-content: center;
  font-size: 32rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); flex-shrink: 0;
}
.s-box {
  flex: 1; display: flex; align-items: center; gap: 12rpx;
  background: #fff; border-radius: 999rpx; height: 72rpx; padding: 0 10rpx 0 24rpx;
}
.s-glass { font-size: 26rpx; }
.s-input { flex: 1; font-size: 26rpx; color: #333; }
.s-ph { color: #c9a7b3; }
.s-btn {
  background: var(--fyt-secondary, #ffaa1d); border-radius: 999rpx; padding: 10rpx 28rpx; flex-shrink: 0;
}
.s-btn-t { font-size: 24rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }

.plats { white-space: nowrap; background: var(--fyt-primary, #e8336d); }
.plats-row { display: inline-flex; gap: 56rpx; padding: 0 32rpx; }
.plat { font-size: 30rpx; color: rgba(255, 255, 255, 0.75); font-weight: 700; padding: 20rpx 0; position: relative; }
.plat.on { color: #fff; font-weight: 900; }
.plat.on::after {
  content: ''; position: absolute; left: 50%; transform: translateX(-50%); bottom: 8rpx;
  width: 40rpx; height: 6rpx; border-radius: 999rpx; background: var(--fyt-secondary, #ffaa1d);
}

.sorts { display: flex; align-items: center; gap: 44rpx; padding: 20rpx 32rpx; }
.sort { font-size: 26rpx; color: var(--fyt-primary-dark, #a31245); font-weight: 600; }
.sort.on { font-weight: 900; text-decoration: underline; text-underline-offset: 8rpx; }

.tip { display: flex; flex-direction: column; align-items: center; gap: 16rpx; padding: 140rpx 40rpx; }
.tip-emoji { font-size: 96rpx; }
.tip-title { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }
.tip-desc { font-size: 24rpx; color: #999; }

.cols { display: flex; gap: 20rpx; padding: 8rpx 32rpx 0; }
.col { flex: 1; display: flex; flex-direction: column; gap: 20rpx; }
.g-card {
  background: #fff; border: 3rpx solid var(--fyt-primary, #e8336d); border-radius: 20rpx; overflow: hidden;
  display: flex; flex-direction: column;
}
.g-pic { width: 100%; height: 320rpx; background: #f3ede4; }
.g-body { padding: 16rpx 18rpx 20rpx; display: flex; flex-direction: column; gap: 10rpx; }
.g-title {
  font-size: 25rpx; color: #333; font-weight: 700; line-height: 1.45;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.g-coupon { align-self: flex-start; background: var(--fyt-primary, #e8336d); border-radius: 8rpx; padding: 2rpx 12rpx; }
.g-coupon-t { font-size: 20rpx; font-weight: 800; color: #fff; }
.g-price-row { display: flex; align-items: baseline; gap: 10rpx; }
.g-price { font-size: 34rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.g-y { font-size: 22rpx; }
.g-market { font-size: 20rpx; color: #bbb; text-decoration: line-through; }
.g-sales { font-size: 20rpx; color: #999; }

.foot { padding: 28rpx 0 12rpx; text-align: center; font-size: 24rpx; color: #c9a7b3; }
</style>
