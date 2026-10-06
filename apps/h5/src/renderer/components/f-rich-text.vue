<template>
  <view class="f-richtext">
    <view class="rt-head" v-if="title">
      <text class="rt-title">{{ title }}</text>
      <text v-if="badge" class="rt-badge">{{ badge }}</text>
    </view>
    <view class="rt-body">
      <text class="rt-p" v-for="(p, i) in paras" :key="i">{{ p }}</text>
    </view>
    <view v-if="action && action.type !== 'none'" class="rt-more" @tap="go">
      <text class="rt-more-txt">{{ more_text || '了解详情 >' }}</text>
    </view>
  </view>
</template>

<script>
export default {
  name: 'FRichText',
  props: {
    title: { type: String, default: '' },
    badge: { type: String, default: '' },
    /** 段落数组（字符串）；空行分段由宿主预先切好 */
    paras: { type: Array, default: () => [] },
    more_text: { type: String, default: '了解详情 >' },
    action: { type: Object, default: null },
  },
  emits: ['action'],
  methods: {
    go() {
      if (this.action && this.action.type !== 'none') this.$emit('action', this.action);
    },
  },
};
</script>

<style scoped>
.f-richtext {
  background: var(--fyt-surface); border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg); padding: var(--fyt-space-3); box-shadow: var(--fyt-shadow-pop);
}
.rt-head { display: flex; align-items: center; gap: 10rpx; margin-bottom: 10rpx; }
.rt-title { font-size: 30rpx; font-weight: 900; color: var(--fyt-text-1); }
.rt-badge {
  background: var(--fyt-secondary); color: var(--fyt-text);
  font-size: 20rpx; font-weight: 800; border-radius: 999rpx; padding: 2rpx 14rpx;
}
.rt-body { display: flex; flex-direction: column; gap: 8rpx; }
.rt-p { font-size: 24rpx; color: var(--fyt-text-2); line-height: 1.7; }
.rt-more { margin-top: 10rpx; display: flex; justify-content: flex-end; }
.rt-more-txt { font-size: 24rpx; color: var(--fyt-primary); font-weight: 700; }
</style>
