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
/**
 * f-coupon-strip 优惠券横条（画布 mini-01 ④）：玫红券条 + 大额数字 + 鎏金「立即领取」
 * 档 C（2026-10-02）：props.coupon_id 存在时点击 = 真实领券（POST /api/me/member/coupons/:id/receive），
 * 领取成功/已领过都跳我的券包；无 coupon_id（纯文案条）仍走 Action 协议。
 */
import { request } from '@/utils/request';

export default {
  name: 'FCouponStrip',
  props: {
    amount: { type: String, default: '' },
    note_top: { type: String, default: '' },
    note_bottom: { type: String, default: '' },
    action_text: { type: String, default: '立即领取' },
    coupon_id: { type: [Number, String], default: 0 },
    action: { type: Object, default: null },
  },
  methods: {
    tap(action) {
      const cid = Number(this.coupon_id ?? 0);
      if (cid > 0) {
        this.receive(cid);
        return;
      }
      if (action && action.type !== 'none') this.$emit('action', action);
    },
    async receive(cid) {
      uni.showLoading({ title: '领取中…', mask: true });
      try {
        const d = await request(`/api/me/member/coupons/${cid}/receive`, { method: 'POST' });
        uni.hideLoading();
        uni.showToast({ title: d.already ? '已在券包中' : '领取成功', icon: 'success' });
        setTimeout(() => {
          uni.navigateTo({
            url: '/pages/rights/coupons',
            fail: () => uni.showToast({ title: '打开券包失败', icon: 'none' }),
          });
        }, 700);
      } catch (e) {
        uni.hideLoading();
        uni.showToast({ title: e?.message ?? '领取失败', icon: 'none' });
      }
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
