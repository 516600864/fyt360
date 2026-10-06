<template>
  <view class="f-couponwall">
    <view class="cw-head">
      <text class="cw-title">{{ title }}</text>
      <text class="cw-sub">{{ subtitle }}</text>
    </view>
    <view class="cw-grid">
      <view v-for="(c, i) in coupons" :key="i" class="cw-card" @click="onTap(c)">
        <view class="cw-left">
          <view class="cw-amount-row">
            <text class="cw-y">¥</text>
            <text class="cw-amount">{{ c.amount }}</text>
          </view>
          <text class="cw-cond">{{ c.condition ?? '无门槛' }}</text>
        </view>
        <view class="cw-right">
          <text class="cw-name">{{ c.name }}</text>
          <view class="cw-btn"><text class="cw-btn-t">{{ c.btn_text ?? '立即领取' }}</text></view>
        </view>
      </view>
    </view>
    <view v-if="!coupons.length" class="cw-empty"><text>优惠券配置中</text></view>
  </view>
</template>

<script>
/**
 * f-coupon-wall 券墙中心（画布 06 组件库·营销卡）：票券样式券卡墙（金额+门槛+领取钮）。
 * 档 C（2026-10-02）：item 带 coupon_id 时点击 = 真实领券（receive 端点）；否则走 Action 协议。
 * props：title/subtitle/coupons[{name,amount,condition,btn_text,coupon_id,action}]
 */
import { request } from '@/utils/request';

export default {
  name: 'FCouponWall',
  props: {
    title: { type: String, default: '券墙中心' },
    subtitle: { type: String, default: '天天领 · 月月省' },
    coupons: { type: Array, default: () => [] },
  },
  methods: {
    onTap(c) {
      const cid = Number(c?.coupon_id ?? 0);
      if (cid > 0) {
        this.receive(cid);
        return;
      }
      if (c.action && c.action.type && c.action.type !== 'none') {
        this.$emit('action', c.action);
        return;
      }
      uni.showToast({ title: '领券活动配置中', icon: 'none' });
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
.f-couponwall {
  background: var(--fyt-surface); border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg); padding: var(--fyt-space-3); box-shadow: var(--fyt-shadow-pop);
}
.cw-head { display: flex; align-items: baseline; gap: 14rpx; }
.cw-title { font-size: 30rpx; font-weight: 900; color: var(--fyt-text); }
.cw-sub { font-size: 20rpx; color: var(--fyt-text-3); }
.cw-grid { display: flex; flex-direction: column; gap: 14rpx; margin-top: var(--fyt-space-2); }
.cw-card {
  display: flex; align-items: center;
  background: var(--fyt-surface-alt); border: var(--fyt-border-thick) solid var(--fyt-border-default);
  border-radius: var(--fyt-radius-md); overflow: hidden;
}
.cw-left {
  width: 200rpx; padding: 24rpx 0; text-align: center; flex-shrink: 0;
  border-right: var(--fyt-border-thick) dashed var(--fyt-border-default);
}
.cw-amount-row { display: flex; align-items: baseline; justify-content: center; color: var(--fyt-primary); }
.cw-y { font-size: 24rpx; font-weight: 900; }
.cw-amount { font-size: 52rpx; font-weight: 900; line-height: 1; }
.cw-cond { display: block; margin-top: 6rpx; font-size: 20rpx; color: var(--fyt-text-3); }
.cw-right { flex: 1; padding: 16rpx 20rpx; display: flex; align-items: center; gap: 16rpx; }
.cw-name {
  flex: 1; font-size: 24rpx; color: var(--fyt-text); font-weight: 700;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.cw-btn {
  background: var(--fyt-primary); border-radius: var(--fyt-radius-full); padding: 10rpx 26rpx;
  box-shadow: var(--fyt-shadow-btn);
}
.cw-btn-t { font-size: 22rpx; font-weight: 900; color: var(--fyt-on-primary); }
.cw-empty {
  margin-top: var(--fyt-space-2); border: var(--fyt-border-thick) dashed var(--fyt-border-default);
  border-radius: var(--fyt-radius-md); padding: var(--fyt-space-5); text-align: center;
  color: var(--fyt-text-3); font-size: 24rpx;
}
</style>
