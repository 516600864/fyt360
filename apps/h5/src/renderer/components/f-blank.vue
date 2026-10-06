<template>
  <view class="f-blank" :style="{ height: (height || 24) + 'rpx' }" />
</template>

<script>
export default {
  name: 'FBlank',
  props: {
    /** 间距高度（rpx） */
    height: { type: Number, default: 24 },
  },
};
</script>

<style scoped>
.f-blank { width: 100%; }
</style>
