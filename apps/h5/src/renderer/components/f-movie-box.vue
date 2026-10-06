<template>
  <view class="f-movie-box">
    <!-- #ifdef MP-WEIXIN -->
    <navigator v-if="path" :url="path" class="mb-launch">
      <box :hot="isHot" :title="title" :more="more" />
    </navigator>
    <view v-else class="mb-state"><text>影票组件加载中…</text></view>
    <!-- #endif -->
    <!-- #ifndef MP-WEIXIN -->
    <view class="mb-h5">
      <view class="mb-h5-head">
        <text class="mb-h5-title">{{ title || (isHot ? '热门电影' : '即将上映') }}</text>
        <text class="mb-h5-more">{{ more || '查看更多' }}</text>
      </view>
      <view class="mb-h5-grid">
        <view v-for="i in 2" :key="i" class="mb-h5-card">
          <view class="mb-h5-poster"><text>🎬</text></view>
          <text class="mb-h5-name">热映影片占位</text>
          <text class="mb-h5-price">¥ 24.9 起</text>
        </view>
      </view>
      <text class="mb-h5-tip">购票请前往小程序「{{ brandCode === 'life_01' ? '折扣电影票' : brandCode }}」</text>
    </view>
    <!-- #endif -->
  </view>
</template>

<script>
/**
 * f-movie-box 影票热映（蚂蚁星球 mayi-movie 插件嵌入，2026-09-27 第二批品牌三轨）：
 * - 仅 MP-WEIXIN 渲染插件原生组件 <box>（pages.json globalStyle.usingComponents 声明 plugin://mayi-movie/box）
 *   外包 navigator 跳插件聚合页（url=/api/site/brand-launch?code=brand_code 动态下发，含 uid/apikey 占位符替换）
 * - 插件 box 参数（movieuid/movieapikey/index/homepath）由 App.vue onLaunch 写 storage（tomovie.js 文档方式）
 * - 其他端诚实 mock：无插件运行时，展示占位卡 + 引导语
 * props：mode=hot|upcoming（hot 控制 <box hot>）、title/more 文本覆盖、brand_code（默认 life_01 折扣电影票）
 */
export default {
  name: 'FMovieBox',
  props: {
    mode: { type: String, default: 'hot' },
    title: { type: String, default: '' },
    more: { type: String, default: '' },
    brand_code: { type: String, default: 'life_01' },
  },
  inject: { fytFetcher: { default: null } },
  data() {
    return { path: '' };
  },
  computed: {
    isHot() {
      return this.mode !== 'upcoming';
    },
  },
  mounted() {
    // #ifdef MP-WEIXIN
    this.loadLaunch();
    // #endif
  },
  methods: {
    async loadLaunch() {
      if (!this.fytFetcher) return;
      try {
        const d = await this.fytFetcher(`/api/site/brand-launch?code=${encodeURIComponent(this.brand_code)}`);
        this.path = d?.path ?? '';
      } catch (e) {
        this.path = '';
      }
    },
  },
};
</script>

<style scoped>
.f-movie-box {
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  overflow: hidden;
}
.mb-launch { display: block; }
.mb-state {
  padding: var(--fyt-space-6);
  text-align: center;
  color: var(--fyt-text-2);
  font-size: 24rpx;
}
/* H5 诚实 mock（无插件运行时） */
.mb-h5 { padding: var(--fyt-space-4); }
.mb-h5-head { display: flex; align-items: center; justify-content: space-between; }
.mb-h5-title { font-size: 30rpx; font-weight: 800; color: var(--fyt-text); }
.mb-h5-more { font-size: 22rpx; color: var(--fyt-text-2); }
.mb-h5-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--fyt-space-3); margin-top: var(--fyt-space-3); }
.mb-h5-card {
  background: var(--fyt-surface-alt);
  border-radius: var(--fyt-radius-lg);
  padding: var(--fyt-space-3);
  display: flex; flex-direction: column; align-items: center; gap: 8rpx;
}
.mb-h5-poster {
  width: 100%; height: 160rpx;
  background: var(--fyt-primary-soft, #fdeef4);
  border-radius: var(--fyt-radius-md);
  display: flex; align-items: center; justify-content: center;
  font-size: 56rpx;
}
.mb-h5-name { font-size: 24rpx; color: var(--fyt-text); font-weight: 600; }
.mb-h5-price { font-size: 26rpx; color: var(--fyt-primary); font-weight: 800; }
.mb-h5-tip { display: block; margin-top: var(--fyt-space-3); font-size: 20rpx; color: var(--fyt-text-2); text-align: center; }
</style>
