<template>
  <!-- ① float 悬浮球（fixed，corner 四角可配；同页 ≤1 由 schema 校验层保证） -->
  <view v-if="shape === 'float'" class="aie-float" :class="`corner-${corner}`" @click="go">
    <view v-if="bubble" class="aie-bubble">{{ bubble }}</view>
    <view class="aie-ball">
      <text class="aie-ball-icon">{{ iconChar }}</text>
    </view>
  </view>

  <!-- ② banner 通栏横幅（楼层流内，玫红底 + 数字钩子副文） -->
  <view v-else-if="shape === 'banner'" class="aie-banner" @click="go">
    <view class="aie-banner-icon"><text class="aie-banner-icon-txt">{{ iconChar }}</text></view>
    <view class="aie-banner-main">
      <text class="aie-banner-title">{{ title }}</text>
      <text class="aie-banner-note">{{ note }}</text>
    </view>
    <view class="aie-banner-btn"><text class="aie-banner-btn-txt">开问</text></view>
  </view>

  <!-- ③ block 按钮块（白卡粗描边，塞任意楼层位） -->
  <view v-else class="aie-block" @click="go">
    <view class="aie-block-icon"><text class="aie-block-icon-txt">{{ iconChar }}</text></view>
    <view class="aie-block-main">
      <text class="aie-block-title">{{ title }}</text>
      <text class="aie-block-note">{{ note }}</text>
    </view>
    <text class="aie-block-arrow">›</text>
  </view>
</template>

<script>
/**
 * f-ai-chat-entry：AI 助手入口楼层（第 28 种 KNOWN_TYPES，决策 #46/#47）
 * 三形态 shape：float 悬浮球 / banner 通栏横幅 / block 按钮块 —— 点击一律进 mini-29 对话页。
 * 悬浮球气泡 V1 为静态文案（props.bubble，D先生 2026-10-07 裁决：动态结果气泡不做）。
 * 样式铁律：只写 var(--fyt-*)，波普粗描边 + 硬阴影。
 */
export default {
  name: 'FAiChatEntry',
  props: {
    shape: { type: String, default: 'block' },          // float | banner | block
    corner: { type: String, default: 'br' },            // float 专用：tl/tr/bl/br
    title: { type: String, default: 'AI 管家' },        // banner/block 主文案
    note: { type: String, default: '找券 · 转链 · 点餐 · 返利，随口一句话' },
    bubble: { type: String, default: '帮你找券，一句话搞定~' }, // float 气泡（静态）
    icon: { type: String, default: 'robot' },           // 内置图标 key
  },
  computed: {
    /** 内置图标集：品牌首字贴纸风格（#47 四视觉锤），emoji 兜底 */
    iconChar() {
      const map = { robot: '🤖', sparkles: '✨', ticket: '🎫', magic: '🪄' };
      return map[this.icon] ?? '🤖';
    },
  },
  methods: {
    go() {
      uni.navigateTo({ url: '/pages/chat/index', fail: () => uni.showToast({ title: 'AI 助手建设中', icon: 'none' }) });
    },
  },
};
</script>

<style scoped>
/* ── ① float ── */
.aie-float { position: fixed; z-index: 90; display: flex; flex-direction: column; align-items: flex-end; gap: 12rpx; }
.corner-br { right: 32rpx; bottom: 200rpx; }
.corner-bl { left: 32rpx; bottom: 200rpx; align-items: flex-start; }
.corner-tr { right: 32rpx; top: 320rpx; }
.corner-tl { left: 32rpx; top: 320rpx; align-items: flex-start; }
.aie-bubble { max-width: 340rpx; background: #2b2b33; color: #fff; font-size: 22rpx; line-height: 1.5;
  padding: 12rpx 20rpx; border-radius: 20rpx 20rpx 4rpx 20rpx; box-shadow: var(--fyt-shadow-pop); }
.aie-ball { width: 108rpx; height: 108rpx; border-radius: 50%; background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-primary-dark); box-shadow: var(--fyt-shadow-btn);
  display: flex; align-items: center; justify-content: center; }
.aie-ball-icon { font-size: 52rpx; }

/* ── ② banner ── */
.aie-banner { display: flex; align-items: center; gap: 20rpx; margin: var(--fyt-space-3);
  padding: 24rpx 28rpx; background: var(--fyt-primary); border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-lg); box-shadow: var(--fyt-shadow-pop); }
.aie-banner-icon { width: 72rpx; height: 72rpx; border-radius: 50%; background: var(--fyt-surface);
  border: 3rpx solid var(--fyt-primary-dark); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.aie-banner-icon-txt { font-size: 36rpx; }
.aie-banner-main { flex: 1; display: flex; flex-direction: column; gap: 4rpx; min-width: 0; }
.aie-banner-title { color: var(--fyt-on-primary); font-size: 30rpx; font-weight: 700; }
.aie-banner-note { color: rgba(255, 255, 255, 0.85); font-size: 22rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aie-banner-btn { background: var(--fyt-secondary); border: 3rpx solid var(--fyt-primary-dark); border-radius: var(--fyt-radius-full);
  padding: 10rpx 28rpx; flex-shrink: 0; box-shadow: var(--fyt-shadow-btn); }
.aie-banner-btn-txt { color: var(--fyt-primary-dark); font-size: 26rpx; font-weight: 700; }

/* ── ③ block ── */
.aie-block { display: flex; align-items: center; gap: 20rpx; margin: var(--fyt-space-3);
  padding: 28rpx; background: var(--fyt-surface); border: var(--fyt-border-thick) solid var(--fyt-primary-dark);
  border-radius: var(--fyt-radius-lg); box-shadow: var(--fyt-shadow-pop); }
.aie-block-icon { width: 88rpx; height: 88rpx; border-radius: 50%; background: var(--fyt-bg);
  border: 3rpx solid var(--fyt-primary-dark); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.aie-block-icon-txt { font-size: 44rpx; }
.aie-block-main { flex: 1; display: flex; flex-direction: column; gap: 4rpx; min-width: 0; }
.aie-block-title { color: var(--fyt-text); font-size: 30rpx; font-weight: 700; }
.aie-block-note { color: var(--fyt-text-2); font-size: 22rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aie-block-arrow { color: var(--fyt-primary); font-size: 40rpx; font-weight: 700; flex-shrink: 0; }
</style>
