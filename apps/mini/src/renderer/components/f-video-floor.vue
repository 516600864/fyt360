<template>
  <view class="f-video-floor">
    <text v-if="title" class="vf-title">{{ title }}</text>
    <video
      v-if="src"
      :src="src"
      :poster="poster"
      class="vf-video"
      :controls="true"
      object-fit="contain"
    />
    <view v-else class="vf-empty"><text>未配置视频地址</text></view>
  </view>
</template>

<script>
/** f-video-floor 视频楼层（画布组件库）：uni video 跨端（MP-WEIXIN/H5） */
export default {
  name: 'FVideoFloor',
  props: {
    title: { type: String, default: '' },
    src: { type: String, default: '' },
    poster: { type: String, default: '' },
  },
};
</script>

<style scoped>
.f-video-floor {
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  box-shadow: var(--fyt-shadow-pop);
  padding: var(--fyt-space-3);
}
.vf-title { display: block; margin-bottom: var(--fyt-space-2); font-size: 30rpx; font-weight: 900; color: var(--fyt-text); }
.vf-video { width: 100%; height: 380rpx; border-radius: var(--fyt-radius-md); }
.vf-empty { height: 200rpx; display: flex; align-items: center; justify-content: center; background: var(--fyt-surface-alt); border-radius: var(--fyt-radius-md); }
.vf-empty text { font-size: 24rpx; color: var(--fyt-text-3); }
</style>
