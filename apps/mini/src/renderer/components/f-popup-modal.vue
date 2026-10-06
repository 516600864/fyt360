<template>
  <view v-if="show" class="f-popup-mask" @click="close">
    <view class="f-popup" @click.stop>
      <image v-if="image" :src="image" mode="widthFix" class="fp-image" />
      <text class="fp-title">{{ title }}</text>
      <text class="fp-content">{{ content }}</text>
      <view class="fp-btn" @click="confirm">
        <text>{{ btn_text }}</text>
      </view>
      <view class="fp-close" @click="close">
        <text>×</text>
      </view>
    </view>
  </view>
</template>

<script>
/** f-popup-modal 进页弹窗（画布组件库）：进页自动弹（auto_show），关闭后本次会话不再弹 */
export default {
  name: 'FPopupModal',
  props: {
    title: { type: String, default: '' },
    content: { type: String, default: '' },
    image: { type: String, default: '' },
    btn_text: { type: String, default: '知道了' },
    auto_show: { type: Boolean, default: true },
    floor_id: { type: String, default: '' }, // 会话级关闭记忆键
    action: { type: Object, default: null },
  },
  data() {
    return { show: false };
  },
  mounted() {
    if (this.auto_show) {
      const key = `fyt-popup-closed-${this.floor_id || this.title}`;
      try {
        this.show = !uni.getStorageSync(key);
      } catch {
        this.show = true;
      }
    }
  },
  methods: {
    close() {
      this.show = false;
      try { uni.setStorageSync(`fyt-popup-closed-${this.floor_id || this.title}`, 1); } catch { /* 存储失败仅本次会话生效 */ }
    },
    confirm() {
      this.close();
      if (this.action && this.action.type !== 'none') this.$emit('action', this.action);
    },
  },
};
</script>

<style scoped>
.f-popup-mask {
  position: fixed; inset: 0; z-index: 998;
  background: rgba(30, 10, 20, 0.55);
  display: flex; align-items: center; justify-content: center;
}
.f-popup {
  width: 600rpx; box-sizing: border-box;
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  box-shadow: var(--fyt-shadow-pop);
  padding: var(--fyt-space-6) var(--fyt-space-4) var(--fyt-space-4);
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: var(--fyt-space-2);
}
.fp-image { width: 100%; border-radius: var(--fyt-radius-md); }
.fp-title { font-size: 34rpx; font-weight: 900; color: var(--fyt-text); }
.fp-content { font-size: 24rpx; color: var(--fyt-text-2); line-height: 1.7; text-align: center; }
.fp-btn {
  margin-top: var(--fyt-space-2);
  background: var(--fyt-primary);
  border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-full);
  box-shadow: var(--fyt-shadow-btn);
  padding: 16rpx 70rpx;
}
.fp-btn text { color: var(--fyt-on-primary); font-size: 28rpx; font-weight: 900; }
.fp-close {
  position: absolute; top: 14rpx; right: 20rpx;
  width: 48rpx; height: 48rpx;
  display: flex; align-items: center; justify-content: center;
}
.fp-close text { font-size: 40rpx; color: var(--fyt-text-3); font-weight: 700; }
</style>
