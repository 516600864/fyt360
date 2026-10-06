<template>
  <view class="gd-page">
    <!-- 主图轮播（画布 mini-03 同稿：H5 端商详，2026-09-28 补齐） -->
    <view class="gd-gallery">
      <swiper class="gd-swiper" circular @change="(e) => (galIdx = e.detail.current)">
        <swiper-item v-for="(img, i) in gallery" :key="i">
          <image :src="img" mode="aspectFill" class="gd-img" @click="preview(i)" />
        </swiper-item>
        <swiper-item v-if="!gallery.length">
          <view class="gd-img gd-ph"><text class="gd-ph-t">🎁</text></view>
        </swiper-item>
      </swiper>
      <view v-if="gallery.length > 1" class="gd-indicator"><text class="gd-ind-t">{{ galIdx + 1 }}/{{ gallery.length }}</text></view>
    </view>

    <!-- 价格卡（券后价 + 划线价 + 已售 + 标题 + 标签） -->
    <view class="price-card">
      <view class="pc-row">
        <view class="pc-price">
          <text class="pc-y">¥ </text>
          <text class="pc-num">{{ fmt(g.finalPrice ?? g.price) }}</text>
          <text v-if="g.finalPrice != null" class="pc-tag">券后价</text>
        </view>
        <text v-if="g.finalPrice != null && g.price > g.finalPrice" class="pc-market">¥{{ fmt(g.price) }}</text>
        <text v-if="g.sales" class="pc-sold">已售 {{ fmtSales(g.sales) }}件</text>
      </view>
      <text class="pc-title">{{ g.title }}</text>
      <view class="pc-tags">
        <text v-if="g.coupon > 0" class="pc-tag-i">领券立减{{ fmtInt(g.coupon) }}元</text>
        <text class="pc-tag-i alt">{{ platName }}</text>
        <text v-if="g.shop" class="pc-tag-i alt">{{ g.shop }}</text>
      </view>
    </view>

    <!-- 平台专享券条（立即领取 → 转链） -->
    <view v-if="g.coupon > 0" class="coupon-strip">
      <text class="cs-amount">¥{{ fmtInt(g.coupon) }}</text>
      <text class="cs-desc">平台专享券{{ quotaText }} · 领券购买更划算</text>
      <view class="cs-btn" @tap="buy"><text class="cs-btn-t">立即领取</text></view>
    </view>

    <!-- 服务保障条 -->
    <view class="serve-card">
      <text class="serve-i">✓ 官方平台下单</text>
      <text class="serve-i">✓ 正品保障</text>
      <text class="serve-i">✓ 售后无忧</text>
    </view>

    <!-- 图文详情（上游无详情长图：简介 + 主图，诚实呈现） -->
    <view class="detail-sec">
      <text class="ds-title">— 商品详情 —</text>
      <view class="ds-body">
        <text v-if="desc" class="ds-desc">{{ desc }}</text>
        <text v-else class="ds-desc dim">商品规格与详情以平台商品页为准</text>
        <image v-if="g.pic" :src="g.pic" mode="widthFix" class="ds-pic" />
      </view>
    </view>

    <!-- 底部操作条 -->
    <view class="bottom-bar">
      <view class="bb-icon" @tap="onKefu">
        <text class="bb-i">🎧</text>
        <text class="bb-t">客服</text>
      </view>
      <view class="bb-icon" @tap="todo('收藏')">
        <text class="bb-i">♡</text>
        <text class="bb-t">收藏</text>
      </view>
      <button class="buy-btn" @tap="buy">领券购买</button>
    </view>
  </view>
</template>

<script>
/**
 * CPS 商品详情页（H5 端，画布 mini-03 同稿，2026-09-28 补齐）：
 * - 数据：商详载荷优先取点击时缓存（core/link cacheGoods）；jd/pdd/vip 缓存缺失时回源
 *   GET /api/goods/:platform/detail（jd/pdd/vip 上游 goodsdetail 实测可用）；tb 上游无详情端点 → 仅缓存载荷
 * - 「领券购买」→ core/link convertJump（union 转链 → location.href 直跳 / 淘口令页）
 * - 诚实口径：图文详情无上游长图，用 goods_desc + 主图呈现，不造假长图
 */
import { request } from '../../utils/request';
import { convertJump } from '../../core/link';
import { openCustomerService, prefetchKf } from '../../utils/kefu';

const PLAT_NAMES = { jd: '京东', tb: '淘宝', pdd: '拼多多', vip: '唯品会' };

export default {
  data() {
    return {
      platform: 'jd',
      g: { id: '', title: '', price: null, finalPrice: null, coupon: null, pic: '', sales: null, shop: '', raw: {} },
      galIdx: 0,
      loading: true,
    };
  },
  computed: {
    platName() {
      return PLAT_NAMES[this.platform] ?? this.platform;
    },
    gallery() {
      const urls = this.g.raw?.picurls ?? this.g.raw?.pic_urls ?? [];
      const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
      if (this.g.pic && !list.includes(this.g.pic)) list.unshift(this.g.pic);
      return list.slice(0, 5);
    },
    quotaText() {
      const q = Number(this.g.raw?.quota);
      return Number.isFinite(q) && q > 0 ? `· 满${q % 1 === 0 ? q : q.toFixed(2)}可用` : '';
    },
    desc() {
      return String(this.g.raw?.goods_desc ?? this.g.raw?.goodsShortDescription ?? '').trim();
    },
  },
  onLoad(q) {
    // 预取企微客服配置（迁移 040）：进页面静默拉一次，点「客服」零等待
    prefetchKf();
    this.platform = String(q?.platform ?? 'jd');
    const id = String(q?.id ?? '');
    this.g.id = id;
    // ① 缓存载荷即时渲染（点击时写入）
    try {
      const cached = JSON.parse(uni.getStorageSync(`fyt_gd_${this.platform}_${id}`) || 'null');
      if (cached) this.applyGoods(cached);
    } catch (e) { /* 无缓存走回源 */ }
    // ② jd/pdd/vip 回源刷新（取画廊/简介等富字段）；tb 上游无详情端点不回源
    if (this.platform !== 'tb') this.refresh();
    else this.loading = false;
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
    applyGoods(d) {
      this.g = {
        id: d.id ?? this.g.id,
        title: d.title ?? this.g.title,
        price: d.price ?? this.g.price,
        finalPrice: d.finalPrice ?? this.g.finalPrice,
        coupon: d.coupon ?? this.g.coupon,
        pic: d.pic ?? this.g.pic,
        sales: d.sales ?? this.g.sales,
        shop: d.shop ?? this.g.shop,
        raw: { ...(this.g.raw ?? {}), ...(d.raw ?? {}), goods_sign: d.sign ?? d.raw?.goods_sign ?? this.g.raw?.goods_sign ?? '' },
      };
      if (d.title) document.title = d.title.slice(0, 16);
    },
    async refresh() {
      try {
        const qs = [`goods_id=${encodeURIComponent(this.g.id)}`];
        if (this.g.raw?.goods_sign) qs.push(`goods_sign=${encodeURIComponent(this.g.raw.goods_sign)}`);
        const d = await request(`/api/goods/${this.platform}/detail?${qs.join('&')}`);
        if (d?.goods?.id) this.applyGoods({ ...d.goods, raw: d.goods.raw });
      } catch (e) {
        // 回源失败不阻塞：缓存载荷已可渲染（tb 无端点本就不回源）
      } finally {
        this.loading = false;
      }
    },
    preview(i) {
      if (!this.gallery.length) return;
      uni.previewImage({ urls: this.gallery, current: i });
    },
    buy() {
      this.g.platform = this.platform;
      convertJump(this.g, this.platform);
    },
    /** 企微客服（迁移 040）：H5 无 openCustomerServiceChat，只能整页跳转客服链接 */
    onKefu() {
      openCustomerService();
    },
    todo(what) {
      uni.showToast({ title: `${what}功能即将开放`, icon: 'none' });
    },
  },
};
</script>

<style scoped>
.gd-page { min-height: 100vh; background: #fff6e9; padding-bottom: 140rpx; }

.gd-gallery { position: relative; padding: 24rpx 32rpx 0; }
.gd-swiper { height: 640rpx; border-radius: 24rpx; overflow: hidden; border: 3rpx solid #e8336d; }
.gd-img { width: 100%; height: 640rpx; background: #f3ede4; }
.gd-ph { display: flex; align-items: center; justify-content: center; }
.gd-ph-t { font-size: 120rpx; }
.gd-indicator {
  position: absolute; right: 56rpx; bottom: 36rpx;
  background: rgba(163, 18, 69, 0.85); border-radius: 999rpx; padding: 4rpx 20rpx;
}
.gd-ind-t { font-size: 22rpx; color: #fff; font-weight: 700; }

.price-card {
  margin: 24rpx 32rpx 0; background: #fff; border: 3rpx solid #e8336d; border-radius: 24rpx;
  padding: 28rpx; display: flex; flex-direction: column; gap: 16rpx;
}
.pc-row { display: flex; align-items: baseline; gap: 14rpx; flex-wrap: wrap; }
.pc-price { display: flex; align-items: baseline; }
.pc-y { font-size: 26rpx; font-weight: 900; color: #e8336d; }
.pc-num { font-size: 56rpx; font-weight: 900; color: #e8336d; line-height: 1; }
.pc-tag {
  margin-left: 12rpx; font-size: 20rpx; font-weight: 800; color: #fff;
  background: #e8336d; border-radius: 8rpx; padding: 4rpx 12rpx;
}
.pc-market { font-size: 24rpx; color: #bbb; text-decoration: line-through; }
.pc-sold { margin-left: auto; font-size: 22rpx; color: #999; }
.pc-title { font-size: 30rpx; font-weight: 700; color: #333; line-height: 1.5; }
.pc-tags { display: flex; gap: 12rpx; flex-wrap: wrap; }
.pc-tag-i {
  font-size: 22rpx; font-weight: 800; color: #a31245;
  background: #ffe3ec; border-radius: 8rpx; padding: 6rpx 16rpx;
}
.pc-tag-i.alt { background: #fff6e9; color: #a3690f; }

.coupon-strip {
  margin: 20rpx 32rpx 0; background: #e8336d; border-radius: 20rpx; padding: 22rpx 26rpx;
  display: flex; align-items: center; gap: 16rpx;
}
.cs-amount {
  font-size: 44rpx; font-weight: 900; color: #ffaa1d; line-height: 1;
}
.cs-desc { flex: 1; font-size: 24rpx; color: #fff; font-weight: 600; }
.cs-btn { background: #ffaa1d; border-radius: 999rpx; padding: 12rpx 30rpx; }
.cs-btn-t { font-size: 26rpx; font-weight: 900; color: #a31245; }

.serve-card {
  margin: 20rpx 32rpx 0; background: #fff; border: 2rpx solid #f0b9cd; border-radius: 16rpx;
  padding: 20rpx 26rpx; display: flex; justify-content: space-between;
}
.serve-i { font-size: 24rpx; color: #a31245; font-weight: 700; }

.detail-sec { margin: 28rpx 32rpx 0; display: flex; flex-direction: column; gap: 20rpx; }
.ds-title { text-align: center; font-size: 28rpx; font-weight: 900; color: #a31245; }
.ds-body { background: #fff; border: 2rpx solid #f0d9c5; border-radius: 20rpx; padding: 24rpx; display: flex; flex-direction: column; gap: 16rpx; }
.ds-desc { font-size: 26rpx; color: #333; line-height: 1.7; }
.ds-desc.dim { color: #b9a8b0; }
.ds-pic { width: 100%; border-radius: 12rpx; }

.bottom-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
  background: #fff; border-top: 2rpx solid #f0d9c5;
  display: flex; align-items: center; gap: 28rpx; padding: 16rpx 32rpx calc(16rpx + env(safe-area-inset-bottom));
}
.bb-icon { display: flex; flex-direction: column; align-items: center; gap: 2rpx; }
.bb-i { font-size: 34rpx; line-height: 1.2; }
.bb-t { font-size: 20rpx; color: #a31245; }
.buy-btn {
  flex: 1; margin-left: auto; background: #e8336d; border-radius: 999rpx;
  box-shadow: 0 6rpx 0 0 #a31245; border: none;
  font-size: 30rpx; font-weight: 900; color: #fff; padding: 10rpx 0;
}
</style>
