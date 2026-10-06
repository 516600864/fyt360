<template>
  <swiper class="f-swiper" :autoplay="autoplay" :interval="interval" circular :indicator-dots="items.length > 1">
    <swiper-item v-for="(item, i) in items" :key="i">
      <view class="banner" :style="{ background: item.bg || defaultBg }" @click="tap(item.action)">
        <view class="banner-copy">
          <view class="banner-title-row">
            <text class="banner-title">{{ item.title }}</text>
            <text class="banner-em">{{ item.emphasize }}</text>
          </view>
          <view class="banner-sub">
            <text v-for="t in item.tags || []" :key="t" class="banner-tag">{{ t }}</text>
            <text v-if="item.tail" class="banner-tail">{{ item.tail }}</text>
          </view>
        </view>
        <text class="banner-emoji">{{ item.emoji }}</text>
      </view>
    </swiper-item>
  </swiper>
</template>

<script>
/** f-swiper 轮播（画布 mini-01 ②）：大圆角渐变 banner + 描边大字 + 标签胶囊 + 装饰 emoji */
export default {
  name: 'FSwiper',
  props: {
    items: { type: Array, default: () => [] },
    autoplay: { type: Boolean, default: true },
    interval: { type: Number, default: 4000 },
  },
  data() {
    return { defaultBg: 'linear-gradient(100deg, #e8336d 0%, #ffaa1d 100%)' };
  },
  methods: {
    tap(action) {
      if (action && action.type !== 'none') this.$emit('action', action);
    },
  },
};
</script>

<style scoped>
.f-swiper { height: 300rpx; }
.banner {
  height: 300rpx; border-radius: var(--fyt-radius-lg);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  box-shadow: var(--fyt-shadow-pop);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 var(--fyt-space-4); overflow: hidden; position: relative;
}
.banner-copy { display: flex; flex-direction: column; gap: 14rpx; z-index: 1; }
.banner-title-row { display: flex; align-items: baseline; gap: 10rpx; }
.banner-title { color: #fff; font-size: 52rpx; font-weight: 900; letter-spacing: 2rpx; }
.banner-em {
  color: #fff; font-size: 56rpx; font-weight: 900; font-style: italic;
  text-shadow: 3rpx 3rpx 0 var(--fyt-primary-dark), -2rpx -2rpx 0 var(--fyt-primary-dark),
    2rpx -2rpx 0 var(--fyt-primary-dark), -2rpx 2rpx 0 var(--fyt-primary-dark);
}
.banner-sub { display: flex; align-items: center; gap: 12rpx; }
.banner-tag {
  background: var(--fyt-surface); color: var(--fyt-primary-dark);
  font-size: 20rpx; font-weight: 800; border-radius: var(--fyt-radius-full);
  padding: 4rpx 14rpx;
}
.banner-tail { color: #ffe9a8; font-size: 24rpx; font-weight: 800; }
.banner-emoji { font-size: 100rpx; opacity: 0.92; }
</style>
