<template>
  <view class="f-ingot" @tap="go">
    <view class="ig-left">
      <text class="ig-coin">🧡</text>
      <view class="ig-txt">
        <text class="ig-title">{{ title }}</text>
        <text class="ig-sub">{{ subtitle }}</text>
      </view>
    </view>
    <view class="ig-btn">
      <text class="ig-btn-txt">{{ action_text }}</text>
      <text class="ig-arrow">›</text>
    </view>
  </view>
</template>

<script>
export default {
  name: 'FIngotEntry',
  props: {
    title: { type: String, default: '我的元宝' },
    subtitle: { type: String, default: '下单返元宝 · 元宝当钱花' },
    action_text: { type: String, default: '去查看' },
    action: { type: Object, default: null },
  },
  emits: ['action'],
  methods: {
    go() {
      if (this.action && this.action.type !== 'none') this.$emit('action', this.action);
    },
  },
};
</script>

<style scoped>
.f-ingot {
  display: flex; align-items: center; justify-content: space-between;
  background: linear-gradient(100deg, var(--fyt-bg, #fff6e9) 0%, #fdeef4 100%);
  border: var(--fyt-border-thick) solid var(--fyt-secondary);
  border-radius: var(--fyt-radius-lg); padding: 20rpx 24rpx; box-shadow: var(--fyt-shadow-pop);
}
.ig-left { display: flex; align-items: center; gap: 16rpx; min-width: 0; }
.ig-coin { font-size: 44rpx; }
.ig-txt { display: flex; flex-direction: column; min-width: 0; }
.ig-title { font-size: 30rpx; font-weight: 900; color: var(--fyt-text-1); }
.ig-sub { font-size: 22rpx; color: var(--fyt-text-3); margin-top: 4rpx; }
.ig-btn {
  display: flex; align-items: center; gap: 4rpx;
  background: var(--fyt-primary); border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: 999rpx; padding: 8rpx 22rpx; box-shadow: 0 4rpx 0 var(--fyt-primary-dark);
}
.ig-btn-txt { color: var(--fyt-on-primary); font-size: 24rpx; font-weight: 800; }
.ig-arrow { color: var(--fyt-on-primary); font-size: 28rpx; font-weight: 900; }
</style>
