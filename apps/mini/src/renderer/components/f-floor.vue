<template>
  <view class="f-floor" :style="bgStyle" @click="tap">
    <view v-if="title" class="floor-head">
      <text class="floor-title">{{ title }}</text>
      <text v-if="subtitle" class="floor-subtitle">{{ subtitle }}</text>
    </view>
    <text v-if="text" class="floor-text">{{ text }}</text>
  </view>
</template>

<script>
/**
 * f-floor 通用楼层容器（画布组件库）：标题条 + 色块卡；bg 支持纯色/渐变覆盖。
 * 整卡可点击：action（装修器配置，2026-09-29 补）→ 上抛宿主 handleAction。
 */
export default {
  name: 'FFloor',
  props: {
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    text: { type: String, default: '' },
    bg: { type: String, default: '' },
    action: { type: Object, default: null },
  },
  computed: {
    bgStyle() {
      return this.bg ? { background: this.bg } : {};
    },
  },
  methods: {
    tap() {
      if (this.action && this.action.type !== 'none') this.$emit('action', this.action);
    },
  },
};
</script>

<style scoped>
.f-floor {
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  box-shadow: var(--fyt-shadow-pop);
  padding: var(--fyt-space-4);
}
.floor-head { display: flex; align-items: baseline; gap: 12rpx; }
.floor-title { font-size: 32rpx; font-weight: 900; color: var(--fyt-text); }
.floor-subtitle { font-size: 22rpx; color: var(--fyt-text-2); }
.floor-text { display: block; margin-top: var(--fyt-space-2); font-size: 24rpx; color: var(--fyt-text-2); line-height: 1.7; }
</style>
