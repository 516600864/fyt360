<template>
  <view class="f-brands">
    <view class="brands-head">
      <text class="brands-title">{{ title }}</text>
      <text class="brands-badge">{{ badge }}</text>
    </view>
    <view class="brands-chips">
      <view v-for="(c, i) in chips" :key="i" class="brand-chip" @click="tap(c)">
        <text>{{ chipLabel(c) }}</text>
      </view>
    </view>
  </view>
</template>

<script>
/** f-brand-chips 品牌补贴日（画布 mini-01 ⑤）：标题+鎏金徽标 + 描边胶囊 chips，点击呼起品牌插件 */
export default {
  name: 'FBrandChips',
  props: {
    title: { type: String, default: '品牌补贴日' },
    badge: { type: String, default: '' },
    chips: { type: Array, default: () => [] },
  },
  methods: {
    // chips 兼容两种形态：字符串（AI/手编）或 {label,value}（品牌选择器产出，value=brand_code）
    chipLabel(c) {
      return typeof c === 'object' && c !== null ? (c.label ?? '') : c;
    },
    tap(chip) {
      const value = typeof chip === 'object' && chip !== null ? (chip.value ?? chip.label) : chip;
      this.$emit('action', { type: 'plugin-launch', value });
    },
  },
};
</script>

<style scoped>
.f-brands {
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  padding: var(--fyt-space-3) var(--fyt-space-3) var(--fyt-space-2);
  box-shadow: var(--fyt-shadow-pop);
}
.brands-head { display: flex; align-items: center; gap: 14rpx; margin-bottom: var(--fyt-space-2); }
.brands-title { color: var(--fyt-text); font-size: 30rpx; font-weight: 900; }
.brands-badge {
  background: var(--fyt-secondary); color: var(--fyt-primary-dark);
  font-size: 20rpx; font-weight: 900; font-style: italic;
  border-radius: var(--fyt-radius-full); padding: 4rpx 14rpx;
}
.brands-chips { display: flex; flex-wrap: wrap; gap: 16rpx; }
.brand-chip {
  background: var(--fyt-surface-alt);
  border: var(--fyt-border-thick) solid var(--fyt-primary);
  border-radius: var(--fyt-radius-full);
  padding: 10rpx 26rpx;
}
.brand-chip text { color: var(--fyt-text); font-size: 24rpx; font-weight: 800; }
</style>
