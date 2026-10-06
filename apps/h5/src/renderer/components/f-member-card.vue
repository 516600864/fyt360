<template>
  <view class="f-member-card" :style="bgStyle" @click="tap">
    <view class="mc-main">
      <text class="mc-title">{{ title }}</text>
      <text class="mc-subtitle">{{ subtitle }}</text>
      <text v-if="level_text" class="mc-level">{{ level_text }}</text>
    </view>
    <view class="mc-btn">
      <text>{{ btn_text }}</text>
    </view>
  </view>
</template>

<script>
/** f-member-card 会员权益卡（画布 9:250 风格）：深色渐变底 + 鎏金按钮；纯装修配置（数据在「我的」页） */
export default {
  name: 'FMemberCard',
  props: {
    title: { type: String, default: '会员权益中心' },
    subtitle: { type: String, default: '' },
    level_text: { type: String, default: '' },
    btn_text: { type: String, default: '立即查看' },
    bg: { type: String, default: '' },
    action: { type: Object, default: null },
  },
  computed: {
    bgStyle() {
      return this.bg ? { background: this.bg } : {};
    },
  },
  methods: {
    tap() {
      if (this.action && this.action.type !== 'none') this.$emit('action', this.action);
    },
  },
};
</script>

<style scoped>
.f-member-card {
  background: linear-gradient(115deg, var(--fyt-primary-dark) 0%, var(--fyt-primary) 60%, #ff5d43 100%);
  border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-lg);
  box-shadow: var(--fyt-shadow-pop);
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--fyt-space-4);
}
.mc-main { display: flex; flex-direction: column; gap: 6rpx; }
.mc-title { color: var(--fyt-on-primary); font-size: 34rpx; font-weight: 900; }
.mc-subtitle { color: rgba(255, 255, 255, 0.85); font-size: 22rpx; }
.mc-level {
  align-self: flex-start;
  background: rgba(255, 255, 255, 0.2); color: #ffe9c9;
  font-size: 20rpx; font-weight: 800;
  border-radius: var(--fyt-radius-full); padding: 4rpx 16rpx;
  margin-top: 6rpx;
}
.mc-btn {
  background: var(--fyt-secondary);
  border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-full);
  padding: 14rpx 30rpx;
  box-shadow: var(--fyt-shadow-btn);
}
.mc-btn text { color: var(--fyt-primary-dark); font-size: 26rpx; font-weight: 900; }
</style>
