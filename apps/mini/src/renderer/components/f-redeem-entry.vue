<template>
  <view class="f-redeem" :style="{ background: bg }" @tap="onLaunch">
    <view class="f-rd-left">
      <text class="f-rd-emoji">{{ emoji }}</text>
      <view class="f-rd-text">
        <text class="f-rd-title">{{ title }}</text>
        <text v-if="subtitle" class="f-rd-sub">{{ subtitle }}</text>
      </view>
    </view>
    <view class="f-rd-btn">{{ btnText }} ›</view>
    <!-- #ifndef MP-WEIXIN -->
    <view v-if="showH5Tip" class="f-rd-tip">请前往小程序完成兑换</view>
    <!-- #endif -->
  </view>
</template>

<script>
/**
 * f-redeem-entry 权益直达（2026-09-27 第三批品牌三轨：积分权益兑换 cid 直达弹窗）
 * 点击 → brand-launch(brand_code 默认 life_05 生活权益) 拿半屏壳呼起参数 → path 拼 &cid=<cid>
 * 打开蚂蚁星球 pages/vipredeem/webview/index 的对应权益兑换弹窗。
 * cid 来源：运营在 DIY 编辑器「权益直达」楼层从蚂蚁 fasttype 实时列表中选取（cid 动态，不落库）。
 * props：title/subtitle/emoji/btn_text/bg 视觉可覆盖；cid 必配；brand_code 默认 life_05。
 */
export default {
  name: 'FRedeemEntry',
  props: {
    title: { type: String, default: '视频会员 1 抢' },
    subtitle: { type: String, default: '低至 5 折 · 元宝当钱花' },
    emoji: { type: String, default: '🎬' },
    btn_text: { type: String, default: '立即抢' },
    bg: { type: String, default: '' },
    cid: { type: [Number, String], default: 0 },
    brand_code: { type: String, default: 'life_05' },
  },
  inject: { fytFetcher: { default: null } },
  data() {
    return { launch: null, showH5Tip: false };
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
        this.launch = d ?? null;
      } catch (e) {
        this.launch = null;
      }
    },
    onLaunch() {
      // #ifndef MP-WEIXIN
      this.showH5Tip = true;
      return;
      // #endif
      // #ifdef MP-WEIXIN
      if (!this.cid) {
        uni.showToast({ title: '未配置直达权益', icon: 'none' });
        return;
      }
      if (!this.launch || !this.launch.path) {
        uni.showToast({ title: '呼起配置加载中，请稍后再试', icon: 'none' });
        return;
      }
      const sep = this.launch.path.includes('?') ? '&' : '?';
      const fullPath = `${this.launch.path}${sep}cid=${this.cid}`;
      const go = (api) => api({
        appId: this.launch.appid,
        path: fullPath,
        fail: () => uni.showToast({ title: '呼起失败，请将小程序更新至最新版本', icon: 'none' }),
      });
      if (this.launch.mode === 'halfscreen' && typeof wx !== 'undefined' && wx.openEmbeddedMiniProgram) {
        go((opt) => wx.openEmbeddedMiniProgram({ ...opt, envVersion: 'release' }));
      } else {
        go((opt) => uni.navigateToMiniProgram(opt));
      }
      // #endif
    },
  },
};
</script>

<style scoped>
.f-redeem {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: var(--fyt-radius-lg);
  padding: var(--fyt-space-4) var(--fyt-space-5);
  background: linear-gradient(100deg, var(--fyt-primary-soft, #fdeef4), var(--fyt-secondary-soft, var(--fyt-bg, #fff6e9)));
  border: var(--fyt-border-thick) solid var(--fyt-secondary, var(--fyt-secondary, #ffaa1d));
}
.f-rd-left { display: flex; align-items: center; gap: var(--fyt-space-3); }
.f-rd-emoji { font-size: 44rpx; }
.f-rd-text { display: flex; flex-direction: column; gap: 4rpx; }
.f-rd-title { font-size: 30rpx; font-weight: 800; color: var(--fyt-text, #3d2530); }
.f-rd-sub { font-size: 22rpx; color: var(--fyt-text-2, #b0898f); }
.f-rd-btn {
  background: var(--fyt-primary, var(--fyt-primary, #e8336d));
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 800;
  border-radius: 999rpx;
  padding: 10rpx 26rpx;
}
.f-rd-tip {
  width: 100%;
  margin-top: var(--fyt-space-2);
  font-size: 20rpx;
  color: var(--fyt-text-2, #b0898f);
  text-align: center;
}
</style>
