<template>
  <view class="f-activity" :style="bgStyle">
    <image v-if="image" :src="image" mode="widthFix" class="ac-image" />
    <view class="ac-body">
      <text class="ac-title">{{ title }}</text>
      <text v-if="subtitle" class="ac-subtitle">{{ subtitle }}</text>
      <view class="ac-btns">
        <view
          v-for="(b, i) in buttons"
          :key="i"
          class="ac-btn"
          :class="{ ghost: b.ghost }"
          @click="tap(b)"
        >
          <text>{{ b.text }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
/** f-activity-floor 活动楼层（画布组件库）：图/渐变底 + 多按钮转化卡 */
export default {
  name: 'FActivityFloor',
  props: {
    title: { type: String, default: '' },
    subtitle: { type: String, default: '' },
    image: { type: String, default: '' },
    bg: { type: String, default: '' },
    buttons: { type: Array, default: () => [] },
  },
  computed: {
    bgStyle() {
      return this.bg ? { background: this.bg } : {};
    },
  },
  methods: {
    tap(btn) {
      if (btn.action && btn.action.type !== 'none') this.$emit('action', btn.action);
    },
  },
};
</script>

<style scoped>
.f-activity {
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  box-shadow: var(--fyt-shadow-pop);
  overflow: hidden;
}
.ac-image { width: 100%; display: block; }
.ac-body { padding: var(--fyt-space-4); display: flex; flex-direction: column; gap: 10rpx; }
.ac-title { font-size: 32rpx; font-weight: 900; color: var(--fyt-text); }
.ac-subtitle { font-size: 22rpx; color: var(--fyt-text-2); }
.ac-btns { display: flex; gap: 16rpx; margin-top: 10rpx; flex-wrap: wrap; }
.ac-btn {
  background: var(--fyt-primary);
  border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-full);
  padding: 14rpx 36rpx;
  box-shadow: var(--fyt-shadow-btn);
}
.ac-btn text { color: var(--fyt-on-primary); font-size: 26rpx; font-weight: 900; }
.ac-btn.ghost { background: var(--fyt-surface); }
.ac-btn.ghost text { color: var(--fyt-primary); }
</style>
