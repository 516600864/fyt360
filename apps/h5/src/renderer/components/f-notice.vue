<template>
  <view class="f-notice">
    <text class="notice-ic">📢</text>
    <view class="notice-body">
      <view v-for="(t, i) in texts" :key="i" class="notice-line">
        <text class="notice-txt">{{ t }}</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  name: 'FNotice',
  props: {
    texts: { type: Array, default: () => [] },
  },
};
</script>

<style scoped>
.f-notice {
  display: flex; align-items: center; gap: 12rpx;
  background: var(--fyt-surface); border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg); padding: 14rpx 20rpx;
}
.notice-ic { font-size: 28rpx; }
.notice-body { flex: 1; min-width: 0; }
.notice-line { display: flex; }
.notice-txt {
  font-size: 24rpx; color: var(--fyt-text-2); font-weight: 600;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
</style>
