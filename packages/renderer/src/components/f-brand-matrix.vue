<template>
  <view class="f-brand-matrix">
    <view
      v-for="(item, i) in items"
      :key="i"
      class="bm-cell"
      :style="{ width: 'calc((100% - ' + (columns - 1) * 12 + 'rpx) / ' + columns + ')' }"
      @click="tap(item)"
    >
      <text class="bm-icon">{{ item.icon }}</text>
      <text class="bm-name">{{ item.name }}</text>
      <text v-if="item.tag" class="bm-tag">{{ item.tag }}</text>
    </view>
  </view>
</template>

<script>
/** f-brand-matrix 品牌宫格（画布组件库）：columns 列品牌卡；tag=角标（如"5折"） */
export default {
  name: 'FBrandMatrix',
  props: {
    columns: { type: Number, default: 4 },
    items: { type: Array, default: () => [] },
  },
  methods: {
    tap(item) {
      if (item.action && item.action.type !== 'none') this.$emit('action', item.action);
    },
  },
};
</script>

<style scoped>
.f-brand-matrix { display: flex; flex-wrap: wrap; gap: 12rpx; }
.bm-cell {
  position: relative;
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  box-shadow: var(--fyt-shadow-pop);
  display: flex; flex-direction: column; align-items: center;
  padding: 22rpx 8rpx 18rpx;
  box-sizing: border-box;
}
.bm-icon { font-size: 44rpx; }
.bm-name { margin-top: 8rpx; font-size: 22rpx; font-weight: 800; color: var(--fyt-text); }
.bm-tag {
  position: absolute; top: -12rpx; right: -8rpx;
  background: var(--fyt-secondary); color: var(--fyt-primary-dark);
  border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  font-size: 18rpx; font-weight: 900;
  border-radius: var(--fyt-radius-full); padding: 2rpx 12rpx;
}
</style>
