<template>
  <view class="gd-page" :style="pageTheme">
    <!-- 主图轮播（画布 03：大图 + 页码胶囊） -->
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
      <view class="bb-icon" @tap="onFav">
        <text class="bb-i">{{ faved ? '♥' : '♡' }}</text>
        <text class="bb-t">收藏</text>
      </view>
      <button class="buy-btn" @tap="buy">领券购买</button>
    </view>
  </view>
</template>

<script>
/**
 * CPS 商品详情页（画布 mini-03，M2 遗留缺口补齐）：
 * - 数据：商详载荷优先取点击时缓存（core/link cacheGoods）；jd/pdd/vip 缓存缺失时回源
 *   GET /api/goods/:platform/detail（jd/pdd/vip 上游 goodsdetail 实测可用）；tb 上游无详情端点 → 仅缓存载荷
 * - 「领券购买」→ core/link goUnion（union 转链 → 官方小程序/淘口令页/复制兜底）
 * - 诚实口径：图文详情无上游长图，用 goods_desc + 主图呈现，不造假长图
 */
import { request } from '@/utils/request';
import { goUnion } from '@/core/link';
import { openCustomerService, prefetchKf } from '@/utils/kefu';
import { toggleFavorite, fetchFavoriteState, trackView } from '@/utils/track';

const PLAT_NAMES = { jd: '京东', tb: '淘宝', pdd: '拼多多', vip: '唯品会' };

export default {
  data() {
    return {
      platform: 'jd',
      g: { id: '', title: '', price: null, finalPrice: null, coupon: null, pic: '', sales: null, shop: '', raw: {} },
      galIdx: 0,
      loading: true,
      faved: false,      // 收藏态（实心 ♥ / 空心 ♡）
      favBusy: false,
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
    // 预取企微客服配置（迁移 040）：进页面就静默拉一次，点「客服」时零等待。
    // 失败无副作用（kefu.js 内部吞掉并降级为未开通），故不 await。
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
      if (d.title) uni.setNavigationBarTitle({ title: d.title.slice(0, 16) });
      // 标题拿到后再做：① 查收藏态（决定 ♥/♡）② 记足迹（title 冗余要准）
      if (d.title) {
        this.syncFavState();
        trackView('cps_goods', `${this.platform}_${this.g.id}`, this.g.title, '');
      }
    },
    /** 收藏态查询（进页面即查，商详页不需要拉整张列表） */
    async syncFavState() {
      if (!this.g.id) return;
      this.faved = await fetchFavoriteState('cps_goods', `${this.platform}_${this.g.id}`);
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
      goUnion(this.g);
    },
    /**
     * 收藏 / 取消收藏（决策 #41：原来这颗 ♡ 是死占位，点一下 toast「功能即将开放」）。
     * ⛔ 只存指针 + 冗余标题，**不存价格 / 库存 / 图片**（CPS 不入库铁律）。
     * ⛔ 商品标题回源后才准确，所以初始态等applyGoods 拿到 title 再查。
     */
    async onFav() {
      if (this.favBusy) return;
      if (!this.g.id) {
        uni.showToast({ title: '商品加载中', icon: 'none' });
        return;
      }
      this.favBusy = true;
      try {
        // ref_id 用「平台_商品ID」，不同平台同 ID 不同商品，必须带平台前缀
        this.faved = await toggleFavorite('cps_goods', `${this.platform}_${this.g.id}`, this.g.title ?? '');
      } catch (e) {
        uni.showToast({ title: e.message ?? '操作失败', icon: 'none' });
      }
      this.favBusy = false;
    },
    /** 企微客服（迁移 040）：小程序走原生会话，失败自动降级复制链接 */
    onKefu() {
      openCustomerService();
    },
    todo(what) {
      uni.showToast({ title: `${what}功能即将开放`, icon: 'none' });
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.gd-page { min-height: 100vh; background: $fyt-surface; padding-bottom: 140rpx; }

.gd-gallery { position: relative; padding: 24rpx 32rpx 0; }
.gd-swiper { height: 640rpx; border-radius: 24rpx; overflow: hidden; border: 3rpx solid var(--fyt-primary, #e8336d); }
.gd-img { width: 100%; height: 640rpx; background: #f3ede4; }
.gd-ph { display: flex; align-items: center; justify-content: center; }
.gd-ph-t { font-size: 120rpx; }
.gd-indicator {
  position: absolute; right: 56rpx; bottom: 36rpx;
  background: rgba(163, 18, 69, 0.85); border-radius: 999rpx; padding: 4rpx 20rpx;
}
.gd-ind-t { font-size: 22rpx; color: #fff; font-weight: 700; }

.price-card {
  margin: 24rpx 32rpx 0; background: #fff; border: 3rpx solid var(--fyt-primary, #e8336d); border-radius: 24rpx;
  padding: 28rpx; display: flex; flex-direction: column; gap: 16rpx;
}
.pc-row { display: flex; align-items: baseline; gap: 14rpx; flex-wrap: wrap; }
.pc-price { display: flex; align-items: baseline; }
.pc-y { font-size: 26rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.pc-num { font-size: 56rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); line-height: 1; }
.pc-tag {
  margin-left: 12rpx; font-size: 20rpx; font-weight: 800; color: #fff;
  background: var(--fyt-primary, #e8336d); border-radius: 8rpx; padding: 4rpx 12rpx;
}
.pc-market { font-size: 24rpx; color: #bbb; text-decoration: line-through; }
.pc-sold { margin-left: auto; font-size: 22rpx; color: #999; }
.pc-title { font-size: 30rpx; font-weight: 700; color: #333; line-height: 1.5; }
.pc-tags { display: flex; gap: 12rpx; flex-wrap: wrap; }
.pc-tag-i {
  font-size: 22rpx; font-weight: 800; color: var(--fyt-primary-dark, #a31245);
  background: #ffe3ec; border-radius: 8rpx; padding: 6rpx 16rpx;
}
.pc-tag-i.alt { background: var(--fyt-bg, #fff6e9); color: #a3690f; }

.coupon-strip {
  margin: 20rpx 32rpx 0; background: var(--fyt-primary, #e8336d); border-radius: 20rpx; padding: 22rpx 26rpx;
  display: flex; align-items: center; gap: 16rpx;
}
.cs-amount {
  font-size: 44rpx; font-weight: 900; color: var(--fyt-secondary, #ffaa1d); line-height: 1;
}
.cs-desc { flex: 1; font-size: 24rpx; color: #fff; font-weight: 600; }
.cs-btn { background: var(--fyt-secondary, #ffaa1d); border-radius: 999rpx; padding: 12rpx 30rpx; }
.cs-btn-t { font-size: 26rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }

.serve-card {
  margin: 20rpx 32rpx 0; background: #fff; border: 2rpx solid #f0b9cd; border-radius: 16rpx;
  padding: 20rpx 26rpx; display: flex; justify-content: space-between;
}
.serve-i { font-size: 24rpx; color: var(--fyt-primary-dark, #a31245); font-weight: 700; }

.detail-sec { margin: 28rpx 32rpx 0; display: flex; flex-direction: column; gap: 20rpx; }
.ds-title { text-align: center; font-size: 28rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }
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
.bb-t { font-size: 20rpx; color: var(--fyt-primary-dark, #a31245); }
.buy-btn {
  flex: 1; margin-left: auto; background: var(--fyt-primary, #e8336d); border-radius: 999rpx;
  box-shadow: 0 6rpx 0 0 var(--fyt-primary-dark, #a31245); border: none;
  font-size: 30rpx; font-weight: 900; color: #fff; padding: 10rpx 0;
}
</style>
