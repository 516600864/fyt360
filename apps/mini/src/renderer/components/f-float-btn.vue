<template>
  <view class="f-float-btn" :style="{ bottom: bottom + 'rpx' }" @click="tap">
    <text v-if="icon" class="fb-icon">{{ icon }}</text>
    <text class="fb-text">{{ text }}</text>
  </view>
</template>

<script>
/** f-float-btn 悬浮按钮（画布组件库）：固定右下角，波普粗描边+硬阴影；action 上抛宿主 */
export default {
  name: 'FFloatBtn',
  props: {
    text: { type: String, default: '点我' },
    icon: { type: String, default: '' },
    bottom: { type: Number, default: 180 },
    action: { type: Object, default: null },
  },
  methods: {
    tap() {
      if (this.action && this.action.type !== 'none') this.$emit('action', this.action);
    },
  },
};
</script>

<style scoped>
.f-float-btn {
  position: fixed; right: 24rpx; z-index: 90;
  display: flex; align-items: center; gap: 8rpx;
  background: var(--fyt-primary);
  border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-full);
  box-shadow: var(--fyt-shadow-btn);
  padding: 18rpx 32rpx;
}
.fb-icon { font-size: 30rpx; }
.fb-text { color: var(--fyt-on-primary); font-size: 26rpx; font-weight: 900; }
</style>
