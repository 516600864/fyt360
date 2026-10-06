<template>
  <view class="f-nav">
    <view
      v-for="(item, i) in items"
      :key="i"
      class="nav-item"
      :style="{ width: 'calc(100% / ' + columns + ')' }"
      @click="tap(item)"
    >
      <view class="nav-icon" :class="{ hot: item.hot }">
        <text>{{ item.icon }}</text>
      </view>
      <text class="nav-label">{{ item.label }}</text>
    </view>
  </view>
</template>

<script>
/** f-nav 金刚区（画布 mini-01 ③）：columns 列圆角描边贴纸图标宫格；hot=领券中心特写态 */
export default {
  name: 'FNav',
  props: {
    items: { type: Array, default: () => [] },
    columns: { type: Number, default: 5 },
  },
  methods: {
    tap(item) {
      if (item.action && item.action.type !== 'none') this.$emit('action', item.action);
    },
  },
};
</script>

<style scoped>
.f-nav {
  display: flex; flex-wrap: wrap;
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  padding: var(--fyt-space-3) 0 var(--fyt-space-2);
  box-shadow: var(--fyt-shadow-pop);
}
.nav-item { display: flex; flex-direction: column; align-items: center; gap: 10rpx; margin-bottom: var(--fyt-space-2); }
.nav-icon {
  width: 92rpx; height: 92rpx; border-radius: var(--fyt-radius-lg);
  background: var(--fyt-surface-alt);
  border: var(--fyt-border-thick) solid var(--fyt-primary);
  display: flex; align-items: center; justify-content: center;
  font-size: 44rpx; box-shadow: var(--fyt-shadow-btn);
}
.nav-icon.hot {
  background: var(--fyt-primary); border-color: var(--fyt-primary-dark);
}
.nav-icon.hot text { color: var(--fyt-on-primary); font-weight: 900; font-size: 36rpx; }
.nav-label { font-size: 22rpx; color: var(--fyt-text); font-weight: 700; }
</style>
