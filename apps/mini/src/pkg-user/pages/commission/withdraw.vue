<template>
  <view class="wd-page" :style="pageTheme">
    <!-- 可提现卡（画布 24） -->
    <view class="hero">
      <view class="hero-card">
        <text class="hero-label">可提现佣金（¥）</text>
        <text class="hero-amount">{{ fmt(balance) }}</text>
        <text class="hero-sub">无门槛提现 · 即时到账 · 免手续费</text>
      </view>
    </view>

    <!-- 提现金额 -->
    <view class="card">
      <view class="card-row">
        <text class="card-title">提现金额</text>
        <text class="all-btn" @click="amount = balance">全部提现</text>
      </view>
      <view class="amt-row">
        <text class="amt-symbol">¥</text>
        <input v-model="amountStr" class="amt-input" type="digit" placeholder="0.00" placeholder-class="amt-ph" />
      </view>
      <text class="amt-hint">无提现门槛 · 单日次数不限 · 可提现额度即佣金余额</text>
    </view>

    <!-- 提现方式 -->
    <view class="card">
      <text class="card-title">提现方式</text>
      <view class="ch-item active">
        <view class="ch-icon">💬</view>
        <view class="ch-main">
          <text class="ch-name">微信零钱</text>
          <text class="ch-desc">实名结算 · 免手续费</text>
        </view>
        <view class="ch-check">✓</view>
      </view>
    </view>

    <!-- 提现规则 -->
    <view class="card rules">
      <text class="card-title">提现规则</text>
      <text class="rule">· 可提现额度：账户佣金余额，支持「全部提现」</text>
      <text class="rule">· 提现门槛：无门槛，余额内金额均可提现（单笔限额 ¥{{ max }}）</text>
      <text class="rule">· 提现时间：全天 24 小时可提交，单日提现次数不限</text>
      <text class="rule">· 到账时间：提交后即时到账微信零钱</text>
      <text class="rule">· 佣金为现金收益，提现免手续费</text>
      <text class="rule">· 元宝不可提现、不可转赠，仅用于兑换会员等级</text>
    </view>

    <!-- 底部确认条 -->
    <view class="bottom-bar">
      <view class="bb-left">
        <text class="bb-label">预计到账</text>
        <text class="bb-amount">¥{{ fmt(payable) }}</text>
      </view>
      <button class="bb-btn" :disabled="submitting" @click="submit">确认提现</button>
    </view>
  </view>
</template>

<script>
/** 画布 24 佣金提现页（33:663，M4·分销）：金额卡 + 微信零钱 + 规则 + 确认提现 */
import { request } from '@/utils/request';

export default {
  data() {
    return { balance: 0, max: 5000, amountStr: '', submitting: false };
  },
  computed: {
    payable() {
      const n = Number(this.amountStr);
      return Number.isFinite(n) && n > 0 ? n : 0;
    },
  },
  onLoad() {
    this.load();
  },
  methods: {
    fmt(n) {
      return Number(n ?? 0).toFixed(2);
    },
    async load() {
      try {
        const s = await request('/api/me/commission/summary');
        this.balance = s.balance;
        this.max = s.max_withdraw_per;
      } catch (e) {
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      }
    },
    async submit() {
      const n = Number(this.amountStr);
      if (!Number.isFinite(n) || n <= 0) return uni.showToast({ title: '请输入提现金额', icon: 'none' });
      if (n > this.balance) return uni.showToast({ title: '超过可提现余额', icon: 'none' });
      this.submitting = true;
      try {
        await request('/api/me/withdraw', { method: 'POST', data: { amount: n, channel: 'wx_wallet' } });
        uni.showToast({ title: '提现成功，已到账微信零钱', icon: 'success' });
        setTimeout(() => uni.navigateBack(), 1200);
      } catch (e) {
        uni.showToast({ title: e.message ?? '提交失败', icon: 'none' });
      } finally {
        this.submitting = false;
      }
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.wd-page { min-height: 100vh; background: var(--fyt-bg, #fff6e9); padding-bottom: 180rpx; }

.hero { background: linear-gradient(180deg, var(--fyt-primary, #e8336d) 0%, var(--fyt-primary, #e8336d) 82%, var(--fyt-bg, #fff6e9) 82%); padding: 24rpx 32rpx 0; }
.hero-card {
  background: linear-gradient(135deg, #c01c50 0%, var(--fyt-primary, #e8336d) 100%);
  border-radius: $fyt-radius-lg; padding: 36rpx 32rpx;
  box-shadow: 0 8rpx 24rpx rgba(163, 18, 69, 0.25);
}
.hero-label { font-size: 26rpx; color: rgba(255, 255, 255, 0.85); }
.hero-amount { display: block; font-size: 72rpx; font-weight: 900; color: var(--fyt-secondary, #ffaa1d); margin: 8rpx 0 12rpx; }
.hero-sub { font-size: 24rpx; color: rgba(255, 255, 255, 0.75); }

.card {
  background: #fffdf7; border: 2rpx solid #f0dfc8; border-radius: $fyt-radius-lg;
  margin: 24rpx 32rpx 0; padding: 30rpx;
  display: flex; flex-direction: column; gap: 18rpx;
}
.card-row { display: flex; justify-content: space-between; align-items: center; }
.card-title { font-size: 28rpx; font-weight: 800; color: #3d2530; }
.all-btn { font-size: 26rpx; color: var(--fyt-primary, #e8336d); font-weight: 800; }
.amt-row { display: flex; align-items: baseline; gap: 8rpx; }
.amt-symbol { font-size: 48rpx; font-weight: 900; color: #3d2530; }
.amt-input { flex: 1; font-size: 56rpx; font-weight: 900; color: #3d2530; }
.amt-ph { color: #d8cfc2; font-weight: 700; }
.amt-hint { font-size: 22rpx; color: #a08592; }

.ch-item {
  display: flex; align-items: center; gap: 20rpx;
  border: 3rpx solid #f0dfc8; border-radius: $fyt-radius-md; padding: 24rpx;
}
.ch-item.active { background: #ffe3ef; border-color: var(--fyt-primary, #e8336d); }
.ch-icon {
  width: 72rpx; height: 72rpx; border-radius: 50%; background: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 36rpx;
}
.ch-main { flex: 1; display: flex; flex-direction: column; gap: 4rpx; }
.ch-name { font-size: 28rpx; font-weight: 800; color: #3d2530; }
.ch-desc { font-size: 22rpx; color: #a08592; }
.ch-check {
  width: 44rpx; height: 44rpx; border-radius: 50%; background: var(--fyt-primary, #e8336d); color: #fff;
  font-size: 26rpx; font-weight: 900; display: flex; align-items: center; justify-content: center;
}
.rules .rule { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); line-height: 1.7; }

.bottom-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 99;
  background: #fffdf7; border-top: 2rpx solid #f0dfc8;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  display: flex; justify-content: space-between; align-items: center;
}
.bb-label { font-size: 22rpx; color: #a08592; }
.bb-amount { display: block; font-size: 40rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.bb-btn {
  background: var(--fyt-primary, #e8336d); color: #fff; font-size: 30rpx; font-weight: 800;
  border-radius: 999rpx; padding: 0 64rpx; line-height: 88rpx;
  border: 3rpx solid var(--fyt-primary-dark, #a31245); box-shadow: 0 6rpx 0 rgba(163, 18, 69, 0.35);
}
.bb-btn::after { border: none; }
.bb-btn[disabled] { opacity: 0.5; }
</style>
