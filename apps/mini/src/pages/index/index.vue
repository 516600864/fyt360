<template>
  <view class="page" :style="pageTheme">
    <!-- 福袋兽过渡遮罩（与会员权益页同规格：🦊+💰 动效 + BUILD 身份牌） -->
    <view v-if="loading" class="loading-mask">
      <view class="loading-card">
        <text class="loading-beast">🦊</text>
        <text class="loading-coin">💰</text>
        <text class="loading-text">福袋兽搬金币中…</text>
        <text class="loading-ver">{{ buildVer }}</text>
      </view>
    </view>
    <view v-else-if="error" class="error">
      <text>{{ error }}</text>
      <button class="fyt-btn" @click="load">重试</button>
    </view>
    <!-- Schema 引擎（§6.1）：页面=JSON Schema，渲染器统一消费 -->
    <SchemaPage v-else :schema="schema" :theme="theme" :fetcher="request" @goods-tap="onGoodsTap" @action="onAction" @checkin="onCheckin" />
    <!-- 聚宝盆签到弹层（决策#31，画布 142:208/142:269）：搜索条「签到有礼」触发 -->
    <CheckinPopup ref="checkin" />
  </view>
</template>

<script>
import SchemaPage from '@/renderer/index.vue';
import CheckinPopup from '@/renderer/components/checkin-popup.vue';
import defaultHome from '@/renderer/schema/default-home.json';
import { loadSiteConfig } from '../../core/bootstrap';
import { onGoodsTap as cpsTap } from '../../core/link';
import { request, getToken } from '../../utils/request';
import { syncTabBar } from '../../core/tabbar';
import { handleAction } from '../../core/action';

export default {
  components: { SchemaPage, CheckinPopup },
  data() {
    return {
      loading: true,
      error: '',
      schema: null,
      theme: null,
      // 遮罩可见版本身份牌（与会员权益页同款）：构建时 patch-buildver 自动替换为真实时间戳
      buildVer: 'BUILD 20260930.1135',
    };
  },
  onLoad(options) {
    // 邀请码（分享卡 path ?invite=）：新用户由 bootstrap（launch query）登录时绑定；
    // 已登录老用户在此补绑（有 token，不走 clogin）。bindInviter 幂等，双路并发只绑一次。
    const invite = String(options?.invite ?? '').trim();
    if (invite) {
      uni.setStorageSync('fyt_invite', invite);
      if (getToken()) {
        request('/api/me/bind-invite', { method: 'POST', data: { invite } })
          .then(() => uni.removeStorageSync('fyt_invite'))
          .catch(() => {});
      }
    }
    this.load();
  },
  onShow() {
    // M4：TabBar 首位选中态强制同步（决策#28 custom-tab-bar）
    syncTabBar(this, 0);
  },
  methods: {
    // fetcher 注入：模块 import 对模板不可见（Options API），必须挂 methods 才能被 :fetcher 引用
    request,
    async load() {
      this.loading = true;
      this.error = '';
      try {
        const cfg = await loadSiteConfig();
        uni.setNavigationBarTitle({ title: cfg.site?.name || 'FYT360' });
        // 端内回退：无 published schema 时用内置默认装修（与 003 seed 同源）
        this.schema = cfg.home?.schema ?? defaultHome;
        this.theme = cfg.site?.theme ?? null;
      } catch (e) {
        this.schema = defaultHome;
      } finally {
        this.loading = false;
      }
    },
    onGoodsTap({ item, platform }) {
      // M2.2：转链真跳转（platform 取当前 tab；self 由 link.js 内拦截）
      cpsTap({ ...item, platform });
    },
    onAction({ action }) {
      // 统一 Action 协议（§6.1 约定①）：popup 已由渲染器内置弹层处理，此处落地 jump/plugin-launch
      handleAction(action);
    },
    onCheckin() {
      // 聚宝盆签到（决策#31）：渲染器 popup/checkin 上抛 → 打开弹层
      this.$refs.checkin?.open();
    },
  },
};
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  box-sizing: border-box;
}
.loading,
.error {
  display: flex; flex-direction: column; align-items: center; gap: $fyt-space-4;
  padding: 200rpx 0; color: $fyt-text-secondary;
}
/* ---------- 福袋兽过渡遮罩（与会员权益页同款规格） ---------- */
.loading-mask {
  position: fixed;
  left: 0; right: 0; top: 0; bottom: 0;
  z-index: 999;
  background: rgba(255, 246, 233, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}
.loading-card { display: flex; flex-direction: column; align-items: center; gap: 20rpx; }
.loading-beast { font-size: 88rpx; animation: beast-bounce 0.9s ease-in-out infinite; }
.loading-coin { font-size: 52rpx; margin-top: -30rpx; animation: coin-sway 0.9s ease-in-out infinite; }
.loading-text { font-size: 30rpx; font-weight: 800; color: var(--fyt-primary, #e8336d); }
.loading-ver { font-size: 20rpx; color: #c9a7b3; margin-top: 8rpx; }
@keyframes beast-bounce {
  0%, 100% { transform: translateY(0) rotate(-6deg); }
  50% { transform: translateY(-24rpx) rotate(6deg); }
}
@keyframes coin-sway {
  0%, 100% { transform: translateX(-14rpx); }
  50% { transform: translateX(14rpx); }
}
.fyt-btn {
  background: $fyt-primary; color: $fyt-text-on-primary;
  border: $fyt-border-thick solid $fyt-border-strong;
  border-radius: $fyt-radius-md; box-shadow: $fyt-shadow-btn;
  font-weight: 700; padding: 0 $fyt-space-6;
}
</style>
