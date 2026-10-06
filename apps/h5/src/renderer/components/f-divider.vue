<template>
  <view class="f-divider">
    <view class="dv-line" />
    <view class="dv-mid">
      <text class="dv-title">{{ title }}</text>
      <text v-if="subtitle" class="dv-sub">{{ subtitle }}</text>
    </view>
    <view class="dv-line" />
  </view>
</template>

<script>
export default {
  name: 'FDivider',
  props: {
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
  },
};
</script>

<style scoped>
.f-divider { display: flex; align-items: center; gap: 16rpx; padding: 6rpx 0; }
.dv-line { flex: 1; height: 3rpx; background: var(--fyt-border-strong); border-radius: 3rpx; }
.dv-mid { display: flex; align-items: baseline; gap: 10rpx; }
.dv-title {
  font-size: 30rpx; font-weight: 900; color: var(--fyt-text-1);
  text-shadow: 2rpx 2rpx 0 var(--fyt-secondary);
}
.dv-sub { font-size: 20rpx; color: var(--fyt-text-3); font-weight: 600; }
</style>
