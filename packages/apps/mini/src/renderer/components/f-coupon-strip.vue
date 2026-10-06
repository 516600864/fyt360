<template>
  <view class="f-coupon" @click="tap(action)">
    <view class="coupon-left">
      <text class="coupon-amount">{{ amount }}</text>
      <view class="coupon-note">
        <text>{{ note_top }}</text>
        <text>{{ note_bottom }}</text>
      </view>
    </view>
    <view class="coupon-btn">
      <text>{{ action_text }}</text>
    </view>
  </view>
</template>

<script>
/** f-coupon-strip 优惠券横条（画布 mini-01 ④）：玫红券条 + 大额数字 + 鎏金「立即领取」 */
export default {
  name: 'FCouponStrip',
  props: {
    amount: { type: String, default: '' },
    note_top: { type: String, default: '' },
    note_bottom: { type: String, default: '' },
    action_text: { type: String, default: '立即领取' },
    action: { type: Object, default: null },
  },
  methods: {
    tap(action) {
      if (action && action.type !== 'none') this.$emit('action', action);
    },
  },
};
</script>

<style scoped>
.f-coupon {
  background: var(--fyt-primary);
  border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-lg);
  box-shadow: var(--fyt-shadow-pop);
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--fyt-space-3) var(--fyt-space-4);
  /* 券齿装饰 */
  position: relative; overflow: hidden;
}
.f-coupon::before,
.f-coupon::after {
  content: ''; position: absolute; width: 28rpx; height: 28rpx;
  background: var(--fyt-bg); border-radius: 50%;
  top: 50%; transform: translateY(-50%);
}
.f-coupon::before { left: -14rpx; }
.f-coupon::after { right: -14rpx; }
.coupon-left { display: flex; align-items: center; gap: 18rpx; }
.coupon-amount { color: var(--fyt-on-primary); font-size: 72rpx; font-weight: 900; font-style: italic; }
.coupon-note { display: flex; flex-direction: column; gap: 4rpx; }
.coupon-note text { color: rgba(255, 255, 255, 0.92); font-size: 24rpx; font-weight: 700; }
.coupon-btn {
  background: var(--fyt-secondary);
  border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-full);
  padding: 14rpx 30rpx;
  color: var(--fyt-primary-dark); font-size: 28rpx; font-weight: 900;
  box-shadow: var(--fyt-shadow-btn);
  z-index: 1;
}
</style>
