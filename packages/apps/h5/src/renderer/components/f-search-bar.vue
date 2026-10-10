<template>
  <view class="f-search">
    <view class="search-logo"><text>{{ logo_text }}</text></view>
    <view class="search-box" @click="tap(action)">
      <text class="search-icon">🔍</text>
      <text class="search-placeholder">{{ placeholder }}</text>
    </view>
    <view class="search-action" @click="tap(action)">
      <text>{{ action_text }}</text>
    </view>
  </view>
</template>

<script>
/** f-search-bar 搜索条（画布 mini-01 ①）：券 logo + 搜索占位 + 鎏金「签到有礼」胶囊 */
export default {
  name: 'FSearchBar',
  props: {
    logo_text: { type: String, default: '券' },
    placeholder: { type: String, default: '搜索券 · 请输入商品名称' },
    action_text: { type: String, default: '' },
    action: { type: Object, default: null },
  },
  methods: {
    tap(action) {
      if (action && action.type !== 'none') this.$emit('action', action);
    },
  },
};
</script>

<style scoped>
.f-search { display: flex; align-items: center; gap: 16rpx; }
.search-logo {
  width: 64rpx; height: 64rpx; border-radius: var(--fyt-radius-md);
  background: var(--fyt-primary); border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  display: flex; align-items: center; justify-content: center;
  color: var(--fyt-on-primary); font-size: 32rpx; font-weight: 900;
  box-shadow: var(--fyt-shadow-btn);
}
.search-box {
  flex: 1; display: flex; align-items: center; gap: 12rpx;
  background: var(--fyt-surface); border: var(--fyt-border-thick) solid var(--fyt-border-default);
  border-radius: var(--fyt-radius-full); height: 72rpx; padding: 0 var(--fyt-space-3);
}
.search-icon { font-size: 26rpx; }
.search-placeholder { color: var(--fyt-text-3); font-size: 26rpx; }
.search-action {
  background: var(--fyt-secondary); border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-full); height: 64rpx; padding: 0 22rpx;
  display: flex; align-items: center;
  color: var(--fyt-primary-dark); font-size: 24rpx; font-weight: 900;
  box-shadow: var(--fyt-shadow-btn);
}
</style>
