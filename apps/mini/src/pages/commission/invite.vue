<template>
  <view class="inv-page" :style="pageTheme">
    <!-- 主卡（画布 25） -->
    <view class="hero">
      <view class="hero-card">
        <text class="hero-title">邀好友 · 赚元宝</text>
        <text class="hero-sub">首单奖 500 元宝/人 · 直推佣金按等级上不封顶</text>
      </view>

      <!-- 两奖励卡 -->
      <view class="reward-row">
        <view class="reward gold">
          <text class="rw-title">🪙 首单奖励</text>
          <text class="rw-num">+{{ bonus }} 元宝/人</text>
          <text class="rw-desc">好友完成首单即到账</text>
        </view>
        <view class="reward">
          <text class="rw-title">🧧 直推佣金</text>
          <text class="rw-num hot">最高 20%</text>
          <text class="rw-desc">L2 返利 10% · L3 合伙人 20%</text>
        </view>
      </view>
      <text class="hero-note">佣金为现金可提现，与元宝独立分账</text>
    </view>

    <!-- 邀请码卡 -->
    <view class="card code-card">
      <view class="qr-box"><text class="qr-emoji">🎁</text></view>
      <view class="code-main">
        <text class="code-label">我的邀请码</text>
        <text class="code-value">{{ inviteCode }}</text>
        <text class="code-hint">好友注册时填码即可绑定邀请关系</text>
        <view class="code-btns">
          <button class="cb ghost" @click="copyCode">复制邀请码</button>
          <button class="cb solid" open-type="share">分享好友</button>
        </view>
      </view>
    </view>

    <!-- 数据行 -->
    <view class="stats">
      <view class="st">
        <text class="st-num">{{ invited }} 人</text>
        <text class="st-label">累计邀请</text>
      </view>
      <view class="st">
        <text class="st-num hot">+{{ fmt(ingotTotal) }}</text>
        <text class="st-label">累计元宝</text>
      </view>
      <view class="st">
        <text class="st-num hot">+¥{{ fmt(commissionTotal) }}</text>
        <text class="st-label">累计佣金</text>
      </view>
    </view>

    <!-- 活动规则 -->
    <view class="rules">
      <text class="rl-title">活动规则</text>
      <text class="rl">· 好友注册且完成首单后，{{ bonus }} 元宝自动到账你的元宝账户</text>
      <text class="rl">· 好友后续订单佣金按你的会员等级比例结算为现金</text>
    </view>

    <!-- 底部邀请按钮 -->
    <view class="bottom-bar">
      <button class="invite-btn" open-type="share">立即邀请好友</button>
    </view>
  </view>
</template>

<script>
/** 画布 25 邀请推广页（33:716，M4·分销）：邀请码 + 分享（onShareAppMessage 携码） + 数据 */
import { request } from '../../utils/request';
import { copyText } from '../../utils/clip';

export default {
  data() {
    return { inviteCode: '', bonus: 500, invited: 0, ingotTotal: 0, commissionTotal: 0 };
  },
  onShow() {
    this.load();
  },
  onShareAppMessage() {
    return {
      title: '一起领吃喝玩乐优惠，注册立得福利！',
      path: `/pages/index/index?invite=${this.inviteCode}`,
    };
  },
  methods: {
    fmt(n) {
      return Number(n ?? 0).toFixed(Number.isInteger(Number(n ?? 0)) ? 0 : 2);
    },
    async load() {
      try {
        const d = await request('/api/me/invite');
        this.inviteCode = d.invite_code ?? '';
        this.invited = d.invited;
        this.ingotTotal = d.ingot_total;
        this.commissionTotal = d.commission_total;
        this.bonus = d.bonus_per_invite ?? 500;
      } catch (e) {
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      }
    },
    copyCode() {
      copyText(this.inviteCode, '邀请码已复制');
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.inv-page { min-height: 100vh; background: var(--fyt-bg, #fff6e9); padding-bottom: 180rpx; }

.hero { background: linear-gradient(180deg, var(--fyt-primary, #e8336d) 0%, var(--fyt-primary, #e8336d) 85%, var(--fyt-bg, #fff6e9) 85%); padding: 24rpx 32rpx 0; }
.hero-card { text-align: left; padding: 16rpx 8rpx 24rpx; }
.hero-title { font-size: 48rpx; font-weight: 900; color: #fff; display: block; }
.hero-sub { font-size: 24rpx; color: rgba(255, 255, 255, 0.85); margin-top: 8rpx; display: block; }

.reward-row { display: flex; gap: 20rpx; }
.reward {
  flex: 1; background: #fffdf7; border: 3rpx solid #f0dfc8; border-radius: $fyt-radius-lg;
  padding: 24rpx; display: flex; flex-direction: column; gap: 8rpx;
}
.reward.gold { border-color: var(--fyt-secondary, #ffaa1d); background: linear-gradient(135deg, #fffdf7 60%, #fff1d6 100%); }
.rw-title { font-size: 26rpx; font-weight: 800; color: #3d2530; }
.rw-num { font-size: 32rpx; font-weight: 900; color: #3d2530; }
.rw-num.hot { color: var(--fyt-primary, #e8336d); }
.rw-desc { font-size: 20rpx; color: #a08592; }
.hero-note { display: block; font-size: 22rpx; color: rgba(255, 255, 255, 0.85); padding: 16rpx 8rpx 0; }

.card {
  background: #fffdf7; border: 2rpx solid #f0dfc8; border-radius: $fyt-radius-lg;
  margin: 24rpx 32rpx 0; padding: 30rpx;
}
.code-card { display: flex; gap: 28rpx; align-items: center; }
.qr-box {
  width: 180rpx; height: 180rpx; border-radius: $fyt-radius-md; flex-shrink: 0;
  background: #ffe3ef; border: 3rpx solid var(--fyt-primary, #e8336d);
  display: flex; align-items: center; justify-content: center;
}
.qr-emoji { font-size: 88rpx; }
.code-main { flex: 1; display: flex; flex-direction: column; gap: 8rpx; }
.code-label { font-size: 24rpx; color: #a08592; }
.code-value { font-size: 44rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); letter-spacing: 2rpx; }
.code-hint { font-size: 20rpx; color: #a08592; }
.code-btns { display: flex; gap: 16rpx; margin-top: 10rpx; }
.cb {
  flex: 1; margin: 0; line-height: 68rpx; font-size: 26rpx; font-weight: 800;
  border-radius: 999rpx; padding: 0;
}
.cb::after { border: none; }
.cb.ghost { background: #fff; color: var(--fyt-primary, #e8336d); border: 3rpx solid var(--fyt-primary, #e8336d); }
.cb.solid { background: var(--fyt-primary, #e8336d); color: #fff; border: 3rpx solid var(--fyt-primary-dark, #a31245); }

.stats {
  background: #fffdf7; border: 2rpx solid #f0dfc8; border-radius: $fyt-radius-lg;
  margin: 24rpx 32rpx 0; padding: 30rpx; display: flex;
}
.st { flex: 1; text-align: center; display: flex; flex-direction: column; gap: 6rpx; }
.st-num { font-size: 32rpx; font-weight: 900; color: #3d2530; }
.st-num.hot { color: var(--fyt-primary, #e8336d); }
.st-label { font-size: 22rpx; color: #a08592; }

.rules {
  background: #ffe3ef; border-radius: $fyt-radius-lg; margin: 24rpx 32rpx 0; padding: 30rpx;
  display: flex; flex-direction: column; gap: 10rpx;
}
.rl-title { font-size: 28rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }
.rl { font-size: 24rpx; color: var(--fyt-primary-dark, #a31245); line-height: 1.7; }

.bottom-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 99;
  background: #fffdf7; border-top: 2rpx solid #f0dfc8;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
}
.invite-btn {
  background: var(--fyt-primary, #e8336d); color: #fff; font-size: 30rpx; font-weight: 800;
  border-radius: 999rpx; line-height: 92rpx; padding: 0;
  border: 3rpx solid var(--fyt-primary-dark, #a31245); box-shadow: 0 6rpx 0 rgba(163, 18, 69, 0.35);
}
.invite-btn::after { border: none; }
</style>
