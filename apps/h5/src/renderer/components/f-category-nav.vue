<template>
  <view class="f-cat-nav">
    <scroll-view :scroll-x="true" class="cat-scroll" :show-scrollbar="false">
      <view class="cat-row">
        <view
          v-for="(item, i) in items"
          :key="i"
          class="cat-chip"
          :class="{ hot: item.hot }"
          @click="tap(item)"
        >
          <text>{{ item.label }}</text>
        </view>
      </view>
    </scroll-view>
  </view>
</template>

<script>
/** f-category-nav 分类导航（画布组件库）：横向滚动 chips；hot=玫红选中态 */
export default {
  name: 'FCategoryNav',
  props: {
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
.f-cat-nav { background: var(--fyt-surface); border: var(--fyt-border-thick) solid var(--fyt-border-strong); border-radius: var(--fyt-radius-full); box-shadow: var(--fyt-shadow-pop); padding: 10rpx; }
.cat-scroll { width: 100%; white-space: nowrap; }
.cat-row { display: flex; flex-direction: row; }
.cat-chip {
  flex-shrink: 0;
  background: var(--fyt-surface-alt);
  border: var(--fyt-border-thick) solid var(--fyt-border-default);
  border-radius: var(--fyt-radius-full);
  padding: 12rpx 30rpx; margin-right: 12rpx;
}
.cat-chip text { font-size: 24rpx; font-weight: 700; color: var(--fyt-text-2); }
.cat-chip.hot { background: var(--fyt-primary); border-color: var(--fyt-primary-dark); }
.cat-chip.hot text { color: var(--fyt-on-primary); font-weight: 900; }
</style>
