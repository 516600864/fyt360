<template>
  <view class="sd-page" :style="pageTheme">
    <!-- 轮播（画布 16：主图 + 页码） -->
    <swiper class="sd-swiper" circular indicator-dots indicator-color="rgba(255,255,255,0.5)" indicator-active-color="#ffffff">
      <swiper-item v-for="(img, i) in goods.main_imgs" :key="i">
        <image :src="img" mode="aspectFill" class="sd-img" @click="preview(i)" />
      </swiper-item>
      <swiper-item v-if="!goods.main_imgs.length">
        <view class="sd-img sd-ph"><text class="sd-ph-t">🎁</text></view>
      </swiper-item>
    </swiper>

    <!-- 价格卡（团购徽标 + 元宝提示） -->
    <view class="price-card">
      <view class="pc-row">
        <text class="pc-cur">¥</text>
        <text class="pc-num">{{ fmt(goods.min_price) }}</text>
        <text class="pc-tag">到店团购</text>
        <text class="pc-sold">已售 {{ fmt(goods.sold) }}</text>
      </view>
      <text class="pc-title">{{ goods.title }}</text>
      <view class="pc-rebate">
        <text class="pc-rebate-t">🪙 支付成功后返 {{ fmt(rebateIngot) }} 元宝（1元=100元宝）</text>
      </view>
    </view>

    <!-- 选择规格 -->
    <view class="sku-card">
      <text class="sc-title">选择规格</text>
      <view class="sku-flow">
        <text v-for="s in goods.skus" :key="s.sku_id" class="sku" :class="{ on: picked === s.sku_id, off: s.stock <= 0 }" @click="s.stock > 0 && (picked = s.sku_id)">
          {{ s.spec }} ×{{ s.stock > 99 ? '99+' : s.stock }}
        </text>
      </view>
      <view class="num-row">
        <text class="nr-label">购买数量</text>
        <view class="stepper">
          <text class="step-btn" @click="num > 1 && num--">−</text>
          <text class="step-num">{{ num }}</text>
          <text class="step-btn plus" @click="num < 5 && num++">＋</text>
        </view>
      </view>
    </view>

    <!-- 服务条 -->
    <view class="serve-card">
      <text class="serve-i">✓ 官方直发</text>
      <text class="serve-i">✓ 过期自动退</text>
      <text class="serve-i">✓ 7×24 客服</text>
    </view>

    <!-- 购买须知 -->
    <view class="notice-card">
      <text class="nc-title">购买须知</text>
      <text class="nc-line">· 支付成功生成核销券码，到店出示由店员核销使用</text>
      <text class="nc-line">· 自购返元宝，支付结算后到账（1元=100元宝）</text>
      <text class="nc-line">· 佣金按受益人等级三跳分配，L1 无佣金</text>
    </view>

    <!-- 底部购买条 -->
    <view class="bottom-bar">
      <view class="fav-btn" @click="onFav">
        <text class="fb-i">{{ faved ? '♥' : '♡' }}</text>
      </view>
      <view class="price-mini">
        <text class="pm-label">合计</text>
        <text class="pm-num">¥{{ fmt(unitPrice * num) }}</text>
      </view>
      <button class="buy-btn" :disabled="!picked || num < 1" @click="onBuy">立即购买</button>
    </view>
  </view>
</template>

<script>
/**
 * 画布 16 团购 SKU 详情页（团购交易链）：
 * GET /api/trade/goods/:id → SKU 选择/数量 → confirm 页（地址+支付）。
 * 元宝提示 = floor(单价×num×100)（与 CPS 同规，拍板 2026-09-28）。
 */
import { request } from '../../utils/request';
import { toggleFavorite, fetchFavoriteState, trackView } from '../../utils/track';

export default {
  data() {
    return {
      goods: { goods_id: 0, title: '', main_imgs: [], skus: [], min_price: 0, sold: 0 },
      picked: '',
      num: 1,
      loading: true,
      faved: false,
      favBusy: false,
    };
  },
  computed: {
    pickedSku() {
      return this.goods.skus.find((s) => s.sku_id === this.picked) ?? null;
    },
    unitPrice() {
      return this.pickedSku ? this.pickedSku.price : 0;
    },
    rebateIngot() {
      return Math.floor(this.unitPrice * this.num * 100);
    },
  },
  onLoad(q) {
    this.load(Number(q.id));
  },
  methods: {
    fmt(n) {
      return Number(n ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    },
    preview(i) {
      uni.previewImage({ urls: this.goods.main_imgs, current: i });
    },
    async load(id) {
      this.loading = true;
      try {
        const d = await request(`/api/trade/goods/${id}`);
        this.goods = d;
        const first = (d.skus ?? []).find((s) => s.stock > 0);
        this.picked = first?.sku_id ?? '';
        // 标题拿到后再做：查收藏态 + 记足迹（决策 #41，标题冗余要准）
        if (d.title) {
          this.faved = await fetchFavoriteState('self_goods', id);
          trackView('self_goods', id, d.title, String(d.title ?? '').trim().charAt(0));
        }
      } catch (e) {
        uni.showToast({ title: e.message ?? '商品加载失败', icon: 'none' });
      }
      this.loading = false;
    },
    /** 收藏 / 取消收藏（kind=self_goods → 对应 06B「到店服务」筛选档） */
    async onFav() {
      if (this.favBusy) return;
      this.favBusy = true;
      try {
        this.faved = await toggleFavorite('self_goods', this.goods.goods_id, this.goods.title, String(this.goods.title ?? '').trim().charAt(0));
      } catch (e) {
        uni.showToast({ title: e.message ?? '操作失败', icon: 'none' });
      }
      this.favBusy = false;
    },
    onBuy() {
      if (!this.picked) return;
      uni.navigateTo({
        url: `/pages/trade/confirm?goods_id=${this.goods.goods_id}&sku_id=${this.picked}&num=${this.num}`,
      });
    },
  },
};
</script>

<style scoped>
.sd-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding-bottom: 160rpx;
}
.sd-swiper { width: 100%; height: 640rpx; background: #fdeef4; }
.sd-img { width: 100%; height: 100%; }
.sd-ph { display: flex; align-items: center; justify-content: center; }
.sd-ph-t { font-size: 120rpx; }
.price-card {
  margin: 24rpx 32rpx 0;
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  padding: 28rpx;
}
.pc-row { display: flex; align-items: baseline; gap: 10rpx; }
.pc-cur { font-size: 30rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.pc-num { font-size: 56rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.pc-tag {
  font-size: 20rpx; font-weight: 800; color: #ffffff;
  background: var(--fyt-primary, #e8336d); border-radius: 6rpx; padding: 4rpx 12rpx;
}
.pc-sold { margin-left: auto; font-size: 22rpx; color: var(--fyt-text-2, #8c8577); }
.pc-title { display: block; font-size: 32rpx; font-weight: 800; color: #2b2b2b; line-height: 1.5; margin-top: 12rpx; }
.pc-rebate { background: #fdeef4; border-radius: 12rpx; padding: 14rpx 20rpx; margin-top: 18rpx; }
.pc-rebate-t { font-size: 24rpx; font-weight: 700; color: var(--fyt-primary-dark, #a31245); }
.sku-card {
  margin: 24rpx 32rpx 0;
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  padding: 28rpx;
}
.sc-title { display: block; font-size: 30rpx; font-weight: 900; color: #2b2b2b; margin-bottom: 20rpx; }
.sku-flow { display: flex; flex-wrap: wrap; gap: 16rpx; }
.sku {
  font-size: 26rpx; font-weight: 600; color: #6b5a4e;
  background: #fdeef4; border: 2rpx solid #f7c2d6;
  border-radius: 999rpx; padding: 12rpx 32rpx;
}
.sku.on { background: var(--fyt-primary, #e8336d); color: #ffffff; border-color: var(--fyt-primary, #e8336d); font-weight: 800; }
.sku.off { opacity: 0.4; }
.num-row { display: flex; align-items: center; justify-content: space-between; margin-top: 28rpx; }
.nr-label { font-size: 28rpx; font-weight: 700; color: #2b2b2b; }
.stepper { display: flex; align-items: center; gap: 24rpx; }
.step-btn {
  width: 52rpx; height: 52rpx; line-height: 48rpx; text-align: center;
  border: 2rpx solid #f7c2d6; border-radius: 50%;
  font-size: 34rpx; color: #6b5a4e; background: #fffdf7;
}
.step-btn.plus { background: var(--fyt-primary, #e8336d); color: #ffffff; border-color: var(--fyt-primary, #e8336d); }
.step-num { font-size: 30rpx; font-weight: 800; color: #2b2b2b; min-width: 48rpx; text-align: center; }
.serve-card {
  margin: 24rpx 32rpx 0;
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 16rpx;
  padding: 22rpx 28rpx;
  display: flex;
  justify-content: space-between;
}
.serve-i { font-size: 24rpx; color: #6b5a4e; font-weight: 600; }
.notice-card {
  margin: 24rpx 32rpx 0;
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  padding: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 10rpx;
}
.nc-title { font-size: 28rpx; font-weight: 900; color: #2b2b2b; }
.nc-line { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); line-height: 1.6; }
/* 收藏按钮（决策 #41）：与 ♡/♥ 同一矢量字符，避免 emoji 在 flex 里并排裂成两块 */
.fav-btn {
  width: 84rpx; height: 84rpx;
  border-radius: 50%;
  border: 2rpx solid var(--fyt-primary, #e8336d);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.fb-i { font-size: 40rpx; color: var(--fyt-primary, #e8336d); }
.bottom-bar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  background: #ffffff;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid #f7c2d6;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.price-mini { display: flex; align-items: baseline; gap: 8rpx; }
.pm-label { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); }
.pm-num { font-size: 40rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.buy-btn {
  background: linear-gradient(160deg, #f0568b, var(--fyt-primary, #e8336d));
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 900;
  border-radius: 999rpx;
  padding: 20rpx 72rpx;
  border: none;
}
.buy-btn[disabled] { opacity: 0.5; }
</style>
