<template>
  <view class="set-page" :style="pageTheme">
    <!-- 用户卡（画布 28：头像/昵称/ID/等级徽标） -->
    <view class="user-card" @click="goEdit">
      <image v-if="info.avatar" class="uc-avatar" :src="info.avatar" mode="aspectFill" />
      <view v-else class="uc-avatar uc-ph"><text class="uc-ph-t">{{ (info.nickname || '友')[0] }}</text></view>
      <view class="uc-main">
        <text class="uc-name">{{ info.nickname || '微信用户' }}</text>
        <text class="uc-id">ID：FYT{{ info.user_id || '------' }}</text>
        <view class="uc-level">
          <text class="uc-level-t">👑 {{ info.level_name || '注册会员' }} · 自购{{ ratePct(info.self_rate) }}% · 直推{{ ratePct(info.direct_rate) }}%</text>
        </view>
      </view>
      <text class="uc-arrow">›</text>
    </view>

    <!-- 资料与安全 -->
    <view class="group">
      <view class="g-row" @click="goEdit"><text class="gr-label">个人资料</text><text class="gr-arrow">›</text></view>
      <view class="g-row" @click="onPhoneRow">
        <text class="gr-label">账号与安全</text>
        <text class="gr-val">{{ info.phone ? info.phone : '未绑定手机号' }} ›</text>
      </view>
    </view>

    <!-- 通用设置 -->
    <view class="group">
      <view class="g-row" @click="onNotify">
        <text class="gr-label">通知设置</text><text class="gr-val warn">订阅消息 ›</text>
      </view>
      <view class="g-row" @click="onClearCache">
        <text class="gr-label">清除缓存</text><text class="gr-val">{{ cacheSize }} ›</text>
      </view>
      <view class="g-row" @click="onDark">
        <text class="gr-label">深色模式</text><text class="gr-val">跟随系统 ›</text>
      </view>
    </view>

    <!-- 关于 -->
    <view class="group">
      <button class="g-row fb-btn" open-type="feedback"><text class="gr-label">帮助与反馈</text><text class="gr-arrow">›</text></button>
      <view class="g-row" @click="onAbout"><text class="gr-label">关于 FYT360</text><text class="gr-val">v1.0.0 ›</text></view>
      <view class="g-row" @click="onDoc('agreement')"><text class="gr-label">用户协议</text><text class="gr-arrow">›</text></view>
      <view class="g-row" @click="onDoc('privacy')"><text class="gr-label">隐私政策</text><text class="gr-arrow">›</text></view>
    </view>

    <button class="logout-btn" @click="onLogout">退出登录</button>
  </view>
</template>

<script>
/**
 * 画布 28 设置页（M8）：
 * 数据 = /api/me/member/overview（等级）+ storage 登录态（userId/phone）。
 * 诚实实现：清除缓存=清非登录态 key（保留 token）；帮助反馈=微信原生 open-type=feedback；
 * 协议/隐私=内置通用文本页 /pages/profile/doc。
 */
import { request } from '../../utils/request';
import { themeTokens } from '../../core/theme';

const KEEP_KEYS = ['fyt_token_site-a', 'fyt_invite', 'fyt_userId'];

export default {
  data() {
    return { info: {}, cacheSize: '0 KB' };
  },
  onShow() {
    this.load();
  },
  methods: {
    ratePct(r) {
      return Math.round(Number(r ?? 0) * 100);
    },
    async load() {
      // 登录态本地缓存
      try {
        this.info.user_id = uni.getStorageSync('fyt_userId') || '';
        this.info.phone = uni.getStorageSync('fyt_phone') || '';
      } catch (e) { /* 忽略 */ }
      try {
        const d = await request('/api/me/member/overview');
        this.info = { ...this.info, ...d };
      } catch (e) { /* 匿名态：头卡展示本地信息 */ }
      this.calcCache();
    },
    calcCache() {
      try {
        const res = uni.getStorageInfoSync();
        this.cacheSize = `${Math.max(1, Math.round((res.currentSize || 1) / 1024 * 10) / 10)} MB`;
      } catch (e) {
        this.cacheSize = '0 KB';
      }
    },
    goEdit() {
      uni.navigateTo({
        url: `/pages/profile/profile-edit?nickname=${encodeURIComponent(this.info.nickname ?? '')}&avatar=${encodeURIComponent(this.info.avatar ?? '')}`,
      });
    },
    async onPhoneRow() {
      if (this.info.phone) return;
      uni.navigateTo({ url: '/pages/profile/login' });
    },
    onNotify() {
      uni.showToast({ title: '订单订阅消息即将开放', icon: 'none' });
    },
    onClearCache() {
      uni.showModal({
        title: '清除缓存',
        content: '将清除搜索历史等本地数据（保留登录状态），确定吗？',
        confirmColor: themeTokens().primary || '#e8336d',
        success: (r) => {
          if (!r.confirm) return;
          try {
            const res = uni.getStorageInfoSync();
            res.keys.forEach((k) => {
              if (!KEEP_KEYS.includes(k)) uni.removeStorageSync(k);
            });
          } catch (e) { /* 忽略 */ }
          this.calcCache();
          uni.showToast({ title: '已清除', icon: 'success' });
        },
      });
    },
    onDark() {
      uni.showToast({ title: '跟随系统设置', icon: 'none' });
    },
    onAbout() {
      uni.showModal({ title: '关于 FYT360', content: '吃喝玩乐购 · 一站式省钱变现\nv1.0.0', showCancel: false, confirmColor: themeTokens().primary || '#e8336d' });
    },
    onDoc(doc) {
      uni.navigateTo({ url: `/pages/profile/doc?doc=${doc}` });
    },
    onLogout() {
      uni.showModal({
        title: '退出登录',
        content: '退出后需重新登录才能使用返利功能',
        confirmColor: themeTokens().primary || '#e8336d',
        success: (r) => {
          if (!r.confirm) return;
          try {
            uni.removeStorageSync('fyt_token_site-a');
            uni.removeStorageSync('fyt_userId');
          } catch (e) { /* 忽略 */ }
          uni.reLaunch({ url: '/pages/index/index' });
        },
      });
    },
  },
};
</script>

<style scoped>
.set-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding: 24rpx 32rpx 64rpx;
}
.user-card {
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 24rpx;
  padding: 32rpx;
  display: flex;
  align-items: center;
  gap: 24rpx;
  margin-bottom: 24rpx;
}
.uc-avatar { width: 112rpx; height: 112rpx; border-radius: 50%; background: #fdeef4; flex-shrink: 0; }
.uc-ph { display: flex; align-items: center; justify-content: center; background: linear-gradient(160deg, #f0568b, var(--fyt-primary, #e8336d)); }
.uc-ph-t { font-size: 48rpx; font-weight: 900; color: #ffffff; }
.uc-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8rpx; }
.uc-name { font-size: 34rpx; font-weight: 900; color: #2b2b2b; }
.uc-id { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); }
.uc-level { align-self: flex-start; background: #fff3d6; border-radius: 8rpx; padding: 4rpx 14rpx; }
.uc-level-t { font-size: 22rpx; font-weight: 800; color: #c77800; }
.uc-arrow { font-size: 44rpx; color: #b3a89a; }

.group {
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  padding: 4rpx 28rpx;
  margin-bottom: 24rpx;
}
.g-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 30rpx 0;
  border-bottom: 2rpx solid #fdeef4;
  background: transparent;
  width: 100%;
  text-align: left;
  line-height: inherit;
  font-size: inherit;
}
.g-row:last-child { border-bottom: none; }
.fb-btn::after { border: none; }
.gr-label { font-size: 30rpx; font-weight: 700; color: #2b2b2b; }
.gr-val { font-size: 26rpx; color: var(--fyt-text-2, #8c8577); }
.gr-val.warn { color: #c77800; }
.gr-arrow { font-size: 40rpx; color: #b3a89a; }

.logout-btn {
  margin-top: 48rpx;
  background: #fffdf7;
  color: var(--fyt-primary, #e8336d);
  font-size: 32rpx;
  font-weight: 900;
  border-radius: 999rpx;
  padding: 22rpx 0;
  border: 3rpx solid var(--fyt-primary, #e8336d);
}
</style>
