<template>
  <view class="f-countdown">
    <view class="cd-head">
      <text class="cd-title">{{ title }}</text>
      <text v-if="note" class="cd-note">{{ note }}</text>
    </view>
    <view v-if="!expired" class="cd-timer">
      <view v-for="(seg, i) in segments" :key="i" class="cd-cell">
        <text class="cd-num">{{ seg.value }}</text>
        <text class="cd-unit">{{ seg.unit }}</text>
      </view>
    </view>
    <text v-else class="cd-expired">{{ expired_text }}</text>
  </view>
</template>

<script>
/** f-countdown 倒计时楼层（画布组件库）：deadline 到点切 expired 文案；仅倒计展示（秒杀数据面未建） */
export default {
  name: 'FCountdown',
  props: {
    title: { type: String, default: '限时开抢' },
    note: { type: String, default: '' },
    deadline: { type: String, default: '' }, // ISO 时间或 'YYYY-MM-DD HH:mm:ss'
    expired_text: { type: String, default: '活动已开始' },
  },
  data() {
    return { now: Date.now(), timer: null };
  },
  computed: {
    target() {
      if (!this.deadline) return 0;
      const t = Date.parse(this.deadline.replace(' ', 'T'));
      return Number.isNaN(t) ? 0 : t;
    },
    expired() {
      return !this.target || this.now >= this.target;
    },
    segments() {
      let diff = Math.max(0, Math.floor((this.target - this.now) / 1000));
      const d = Math.floor(diff / 86400); diff -= d * 86400;
      const h = Math.floor(diff / 3600); diff -= h * 3600;
      const m = Math.floor(diff / 60);
      const s = diff - m * 60;
      const pad = (n) => String(n).padStart(2, '0');
      return [
        { value: d > 0 ? String(d) : '0', unit: '天' },
        { value: pad(h), unit: '时' },
        { value: pad(m), unit: '分' },
        { value: pad(s), unit: '秒' },
      ];
    },
  },
  mounted() {
    this.timer = setInterval(() => { this.now = Date.now(); }, 1000);
  },
  beforeUnmount() {
    if (this.timer) clearInterval(this.timer);
  },
  // 小程序页面卸载（uni Vue3 Options 也走 beforeUnmount；Vue2 兼容 beforeDestroy）
  beforeDestroy() {
    if (this.timer) clearInterval(this.timer);
  },
};
</script>

<style scoped>
.f-countdown {
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg);
  box-shadow: var(--fyt-shadow-pop);
  padding: var(--fyt-space-3) var(--fyt-space-4);
  display: flex; align-items: center; justify-content: space-between;
}
.cd-head { display: flex; flex-direction: column; gap: 6rpx; }
.cd-title { font-size: 30rpx; font-weight: 900; color: var(--fyt-primary); }
.cd-note { font-size: 22rpx; color: var(--fyt-text-2); }
.cd-timer { display: flex; gap: 10rpx; }
.cd-cell {
  background: var(--fyt-primary); border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-sm);
  min-width: 56rpx; padding: 8rpx 10rpx;
  display: flex; flex-direction: column; align-items: center;
}
.cd-num { color: var(--fyt-on-primary); font-size: 28rpx; font-weight: 900; }
.cd-unit { color: rgba(255, 255, 255, 0.8); font-size: 18rpx; }
.cd-expired { font-size: 26rpx; font-weight: 800; color: var(--fyt-text-2); }
</style>
