<template>
  <view class="cf-page" :style="pageTheme">
    <!-- 到店核销说明卡（核销单） -->
    <view class="verify-card">
      <view class="vc-icon"><text class="vc-icon-t">🏪</text></view>
      <view class="vc-main">
        <text class="vc-title">到店核销</text>
        <text class="vc-desc">无需收货地址 · 支付成功后生成核销券码，到店出示由店员核销使用</text>
      </view>
    </view>

    <!-- 商品摘要 -->
    <view class="goods-card">
      <image v-if="goods.pic" class="gc-img" :src="goods.pic" mode="aspectFill" />
      <view v-else class="gc-img gc-ph"><text>🎁</text></view>
      <view class="gc-main">
        <text class="gc-title">{{ goods.title }}</text>
        <text class="gc-spec">{{ goods.spec }} × {{ num }}</text>
      </view>
      <view class="gc-right">
        <text class="gc-price">¥{{ fmt(goods.price) }}</text>
        <text class="gc-num">×{{ num }}</text>
      </view>
    </view>

    <!-- 元宝返利提示条（画布 17） -->
    <view class="rebate-strip">
      <text class="rs-t">🪙 本单实付 ¥{{ fmt(payPrice) }}，结算后返 {{ fmt(rebateIngot) }} 元宝</text>
    </view>

    <!-- 优惠券选择（档 C：营销券抵扣） -->
    <view class="coupon-card" @click="openCouponPicker">
      <view class="cp-w">
        <text class="cp-label">优惠券</text>
        <text v-if="pickedCoupon" class="cp-picked">{{ pickedCoupon.name }} · 减 ¥{{ fmt(couponDiscount) }}</text>
        <text v-else-if="couponLoading" class="cp-picked">加载中…</text>
        <text v-else-if="coupons.length" class="cp-picked cp-hint">{{ coupons.length }} 张可用</text>
        <text v-else class="cp-picked cp-none">暂无可用券</text>
      </view>
      <text class="cp-arrow">{{ couponPickerOpen ? '收起' : '选择' }} ›</text>
    </view>
    <view v-if="couponPickerOpen" class="coupon-list">
      <view class="cl-empty" v-if="!coupons.length"><text>当前订单金额暂无可用券</text></view>
      <view
        v-for="c in coupons"
        :key="c.user_coupon_id"
        class="cl-item"
        :class="{ on: pickedCoupon?.user_coupon_id === c.user_coupon_id }"
        @click="pickCoupon(c)"
      >
        <view class="cl-left">
          <text class="cl-amt">{{ c.type === 'cash_off' ? `¥${c.amount}` : c.type === 'discount' ? `${c.amount}折` : '免费' }}</text>
          <text class="cl-cond">{{ c.threshold > 0 ? `满 ¥${c.threshold} 可用` : '无门槛' }}</text>
        </view>
        <view class="cl-right">
          <text class="cl-name">{{ c.name }}</text>
          <text class="cl-pick">{{ pickedCoupon?.user_coupon_id === c.user_coupon_id ? '✓ 已选' : '选择' }}</text>
        </view>
      </view>
    </view>

    <!-- 价格明细 -->
    <view class="detail-card">
      <view class="d-row"><text class="d-label">商品金额</text><text class="d-val">¥{{ fmt(goodsTotal) }}</text></view>
      <view v-if="couponDiscount > 0" class="d-row">
        <text class="d-label">优惠券抵扣</text>
        <text class="d-val d-cut">-¥{{ fmt(couponDiscount) }}</text>
      </view>
      <view class="d-row"><text class="d-label">履约方式</text><text class="d-val">到店核销</text></view>
      <view class="d-row total">
        <text class="d-label-strong">应付合计</text>
        <text class="d-price">¥{{ fmt(payPrice) }}</text>
      </view>
    </view>

    <!-- 支付方式（画布 17：微信支付勾选） -->
    <view class="pay-card">
      <view class="pay-w"><text class="pay-w-i">W</text><text class="pay-w-t">微信支付</text></view>
      <view class="pay-check"><text class="pay-check-t">✓</text></view>
    </view>

    <!-- 底部提交条 -->
    <view class="bottom-bar">
      <view class="pb-left">
        <text class="pb-label">应付</text>
        <text class="pb-price">¥{{ fmt(payPrice) }}</text>
      </view>
      <button class="submit-btn" :disabled="busy" @click="onSubmit">{{ busy ? '提交中…' : '提交订单' }}</button>
    </view>
  </view>
</template>

<script>
/**
 * 画布 17 确认订单页（团购交易链）：
 * POST /api/trade/orders（下单+原子扣库存+券抵扣锁券，团购恒到店团购）→ 有支付凭据：拉 /pay 呼起 requestPayment → 成功跳 result；
 * 无凭据（联调期）：mock-pay 直接结算 → result。
 * 券抵扣（档 C 2026-10-02）：GET /api/me/member/coupons/available?amount= 拉自营可用券 → 选一张
 * 传 user_coupon_id，服务端二次校验并在下单时锁券（防超发）。
 */
import { request } from '@/utils/request';

export default {
  data() {
    return {
      goodsId: 0, skuId: '', num: 1,
      goods: { title: '', pic: '', spec: '', price: 0 },
      busy: false,
      coupons: [], // 仅含已领取且未用的（user_coupon_id 非空）
      couponLoading: false,
      couponPickerOpen: false,
      pickedCoupon: null,
    };
  },
  computed: {
    goodsTotal() {
      return Math.round(this.goods.price * this.num * 100) / 100;
    },
    couponDiscount() {
      if (!this.pickedCoupon) return 0;
      const c = this.pickedCoupon;
      let d = c.type === 'cash_off' ? Number(c.amount)
        : c.type === 'discount' ? Math.round(this.goodsTotal * (1 - Number(c.amount) / 10) * 100) / 100
        : this.goodsTotal;
      return Math.max(0, Math.min(d, this.goodsTotal));
    },
    payPrice() {
      // 与服务端一致：微信不接受 0 元单，抵扣后至少 0.01（2026-10-02）
      return Math.max(0.01, Math.round((this.goodsTotal - this.couponDiscount) * 100) / 100);
    },
    rebateIngot() {
      return Math.floor(this.payPrice * 100);
    },
  },
  onLoad(q) {
    this.goodsId = Number(q.goods_id ?? 0);
    this.skuId = String(q.sku_id ?? '');
    this.num = Math.max(1, Math.min(5, Number(q.num ?? 1)));
    this.loadGoods();
  },
  methods: {
    fmt(n) {
      return Number(n ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    },
    async loadGoods() {
      try {
        const d = await request(`/api/trade/goods/${this.goodsId}`);
        const sku = (d.skus ?? []).find((s) => s.sku_id === this.skuId) ?? d.skus?.[0];
        this.goods = {
          title: d.title ?? '',
          pic: (d.main_imgs ?? [])[0] ?? '',
          spec: sku?.spec ?? '',
          price: sku?.price ?? 0,
        };
        this.loadCoupons();
      } catch (e) {
        uni.showToast({ title: e.message ?? '商品加载失败', icon: 'none' });
      }
    },
    async loadCoupons() {
      this.couponLoading = true;
      try {
        const d = await request(`/api/me/member/coupons/available?amount=${this.goodsTotal}`);
        // 只保留已领取可用的（user_coupon_id 有值），未领的引导去券条领
        this.coupons = (d.items ?? []).filter((c) => c.usable);
      } catch (e) {
        this.coupons = [];
      }
      this.couponLoading = false;
    },
    openCouponPicker() {
      this.couponPickerOpen = !this.couponPickerOpen;
      if (this.couponPickerOpen && !this.coupons.length) this.loadCoupons();
    },
    pickCoupon(c) {
      this.pickedCoupon = this.pickedCoupon?.user_coupon_id === c.user_coupon_id ? null : c;
    },
    async onSubmit() {
      if (this.busy) return;
      this.busy = true;
      try {
        // 1. 下单（团购恒到店团购，无地址；带 user_coupon_id 时服务端校验并锁券）
        const payload = {
          goods_id: this.goodsId, sku_id: this.skuId, num: this.num,
          user_coupon_id: this.pickedCoupon?.user_coupon_id ?? 0,
        };
        const d = await request('/api/trade/orders', { method: 'POST', data: payload });
        const orderId = d.order_id;
        // 2. 支付：先试真实 JSAPI，未配置凭据（503 WXPAY_NOT_CONFIGURED）→ mock 直结
        try {
          const pay = await request(`/api/trade/orders/${orderId}/pay`, { method: 'POST' });
          await uni.requestPayment({
            provider: 'wxpay',
            timeStamp: pay.timeStamp,
            nonceStr: pay.nonceStr,
            package: pay.package,
            signType: pay.signType,
            paySign: pay.paySign,
          });
          uni.redirectTo({ url: `/pkg-goods/pages/trade/result?order_id=${orderId}&paid=1` });
        } catch (pe) {
          const code = pe?.data?.code ?? pe?.code ?? '';
          if (code === 'WXPAY_NOT_CONFIGURED') {
            // 联调通道：mock 结算
            await request(`/api/trade/orders/${orderId}/mock-pay`, { method: 'POST' });
            uni.redirectTo({ url: `/pkg-goods/pages/trade/result?order_id=${orderId}&paid=1&mock=1` });
          } else if (code === 'requestPayment:fail cancel' || pe?.errMsg?.includes('cancel')) {
            // 用户取消 → 留在确认页可重试（券仍锁在本单上，重试同单；换单需先取消）
            uni.showToast({ title: '已取消支付', icon: 'none' });
          } else {
            throw pe;
          }
        }
      } catch (e) {
        uni.showToast({ title: e?.message ?? '下单失败', icon: 'none' });
      }
      this.busy = false;
    },
  },
};
</script>

<style scoped>
.cf-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding: 24rpx 32rpx 180rpx;
}
.verify-card {
  background: #fffdf7;
  border: 3rpx solid var(--fyt-secondary, #ffaa1d);
  border-radius: 20rpx;
  padding: 28rpx;
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 24rpx;
}
.vc-icon {
  width: 88rpx; height: 88rpx; border-radius: 50%;
  background: #fff3d6; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.vc-icon-t { font-size: 40rpx; }
.vc-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6rpx; }
.vc-title { font-size: 32rpx; font-weight: 900; color: #2b2b2b; }
.vc-desc { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); line-height: 1.5; }

.goods-card {
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  padding: 24rpx;
  display: flex;
  gap: 20rpx;
  align-items: center;
}
.gc-img { width: 140rpx; height: 140rpx; border-radius: 16rpx; background: #fdeef4; flex-shrink: 0; }
.gc-ph { display: flex; align-items: center; justify-content: center; font-size: 60rpx; }
.gc-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10rpx; }
.gc-title { font-size: 30rpx; font-weight: 800; color: #2b2b2b; }
.gc-spec { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); }
.gc-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8rpx; }
.gc-price { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.gc-num { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); }

.rebate-strip {
  background: #fdeef4;
  border-radius: 14rpx;
  padding: 20rpx 24rpx;
  margin-top: 24rpx;
}
.rs-t { font-size: 24rpx; font-weight: 700; color: var(--fyt-primary-dark, #a31245); }

.detail-card {
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  padding: 10rpx 28rpx;
  margin-top: 24rpx;
}
.d-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 24rpx 0;
  border-bottom: 2rpx solid #fdeef4;
}
.d-row.total { border-bottom: none; }
.d-label { font-size: 28rpx; color: #6b5a4e; }
.d-val { font-size: 28rpx; color: #2b2b2b; font-weight: 600; }
.d-label-strong { font-size: 30rpx; font-weight: 900; color: #2b2b2b; }
.d-price { font-size: 40rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }

.coupon-card {
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  padding: 24rpx 28rpx;
  margin-top: 24rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cp-w { display: flex; flex-direction: column; gap: 6rpx; min-width: 0; }
.cp-label { font-size: 28rpx; color: #6b5a4e; }
.cp-picked { font-size: 26rpx; font-weight: 800; color: var(--fyt-primary, #e8336d); }
.cp-hint { color: var(--fyt-primary, #e8336d); }
.cp-none { color: var(--fyt-text-2, #8c8577); font-weight: 600; }
.cp-arrow { font-size: 24rpx; font-weight: 800; color: var(--fyt-text-2, #8c8577); flex-shrink: 0; }

.coupon-list {
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  margin-top: 12rpx;
  padding: 8rpx 28rpx;
}
.cl-empty { padding: 32rpx 0; text-align: center; font-size: 24rpx; color: var(--fyt-text-2, #8c8577); }
.cl-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 22rpx 0;
  border-bottom: 2rpx solid #fdeef4;
}
.cl-item:last-child { border-bottom: none; }
.cl-item.on { background: linear-gradient(90deg, rgba(232, 51, 109, 0.06), transparent); }
.cl-left { display: flex; flex-direction: column; gap: 4rpx; }
.cl-amt { font-size: 34rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.cl-cond { font-size: 20rpx; color: var(--fyt-text-2, #8c8577); }
.cl-right { display: flex; align-items: center; gap: 16rpx; }
.cl-name { font-size: 24rpx; font-weight: 700; color: #2b2b2b; }
.cl-pick {
  font-size: 22rpx; font-weight: 800;
  color: var(--fyt-primary, #e8336d);
  border: 2rpx solid var(--fyt-primary, #e8336d);
  border-radius: 999rpx;
  padding: 6rpx 20rpx;
}

.d-cut { color: var(--fyt-primary, #e8336d); font-weight: 800; }

.pay-card {
  background: #fffdf7;
  border: 3rpx solid var(--fyt-primary, #e8336d);
  border-radius: 20rpx;
  padding: 28rpx;
  margin-top: 24rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pay-w { display: flex; align-items: center; gap: 16rpx; }
.pay-w-i {
  width: 56rpx; height: 56rpx; border-radius: 50%;
  background: #2aae67; color: #ffffff;
  font-size: 30rpx; font-weight: 900;
  display: flex; align-items: center; justify-content: center;
}
.pay-w-t { font-size: 30rpx; font-weight: 800; color: #2b2b2b; }
.pay-check {
  width: 40rpx; height: 40rpx; border-radius: 50%;
  background: var(--fyt-primary, #e8336d);
  display: flex; align-items: center; justify-content: center;
}
.pay-check-t { font-size: 24rpx; font-weight: 900; color: #ffffff; }

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
.pb-left { display: flex; align-items: baseline; gap: 8rpx; }
.pb-label { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); }
.pb-price { font-size: 44rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.submit-btn {
  background: linear-gradient(160deg, #f0568b, var(--fyt-primary, #e8336d));
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 900;
  border-radius: 999rpx;
  padding: 22rpx 64rpx;
  border: none;
}
.submit-btn[disabled] { opacity: 0.5; }
</style>
