<template>
  <view class="f-invite">
    <view class="iv-body">
      <text class="iv-title">{{ title }}</text>
      <text class="iv-desc">{{ desc }}</text>
      <view class="iv-reward">
        <text class="iv-reward-t">🎁 {{ reward_text }}</text>
      </view>
    </view>
    <view class="iv-btn" @click="onTap"><text class="iv-btn-t">{{ btn_text }}</text></view>
  </view>
</template>

<script>
/**
 * f-invite-floor 邀请有礼（画布 06 组件库·营销卡）：渐变横幅 + 奖励徽章 + 邀请钮。
 * 点击默认跳邀请推广页（/pages/invite/index，mini-25）；action 配置覆盖。
 * props：title/desc/reward_text/btn_text/action
 */
export default {
  name: 'FInviteFloor',
  props: {
    title: { type: String, default: '邀请有礼' },
    desc: { type: String, default: '好友下单，双方都得元宝' },
    reward_text: { type: String, default: '每邀 1 人最高得 500 元宝' },
    btn_text: { type: String, default: '立即邀请' },
    action: { type: Object, default: null },
  },
  methods: {
    onTap() {
      if (this.action && this.action.type && this.action.type !== 'none') {
        this.$emit('action', this.action);
        return;
      }
      uni.navigateTo({ url: '/pages/invite/index', fail: () => uni.showToast({ title: '邀请页建设中', icon: 'none' }) });
    },
  },
};
</script>

<style scoped>
.f-invite {
  display: flex; align-items: center; gap: 18rpx;
  background: linear-gradient(90deg, var(--fyt-primary), var(--fyt-primary-dark));
  border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-lg); padding: var(--fyt-space-4);
  box-shadow: var(--fyt-shadow-pop);
}
.iv-body { flex: 1; display: flex; flex-direction: column; gap: 8rpx; }
.iv-title { font-size: 32rpx; font-weight: 900; color: var(--fyt-on-primary); }
.iv-desc { font-size: 22rpx; color: rgba(255, 255, 255, 0.85); }
.iv-reward {
  align-self: flex-start; margin-top: 4rpx;
  background: var(--fyt-secondary); border-radius: var(--fyt-radius-full); padding: 4rpx 18rpx;
}
.iv-reward-t { font-size: 20rpx; font-weight: 900; color: #fff; }
.iv-btn {
  background: var(--fyt-surface); border-radius: var(--fyt-radius-full);
  padding: 16rpx 34rpx; box-shadow: var(--fyt-shadow-btn);
}
.iv-btn-t { font-size: 26rpx; font-weight: 900; color: var(--fyt-primary); }
</style>
