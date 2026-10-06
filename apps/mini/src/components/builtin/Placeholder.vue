<template>
  <view class="placeholder">
    <view class="badge"><text class="badge-emoji">{{ emoji }}</text></view>
    <text class="title">{{ title }}</text>
    <text class="desc">{{ desc }}</text>
    <view class="sticker"><text>🚧</text></view>
  </view>
</template>

<script>
/** M4 内置页占位组件：tabBar builtin 目标（rights/orders/mine）与独立页面共用，M5/M6 真页面就绪后替换 */
export default {
  props: {
    emoji: { type: String, default: '🚧' },
    title: { type: String, default: '' },
    desc: { type: String, default: '' },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.placeholder {
  min-height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: $fyt-space-4;
}
.badge {
  width: 160rpx; height: 160rpx; border-radius: $fyt-radius-lg;
  background: $fyt-surface; border: $fyt-border-thick solid $fyt-border-strong;
  box-shadow: $fyt-shadow-btn; display: flex; align-items: center; justify-content: center;
}
.badge-emoji { font-size: 80rpx; }
.title { font-size: 36rpx; font-weight: 900; color: $fyt-primary; }
.desc { font-size: 26rpx; color: $fyt-text-secondary; }
.sticker { font-size: 44rpx; }
</style>
