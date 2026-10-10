<template>
  <view class="ingot-page" :style="pageTheme">
    <!-- 玫红头卡（画布 15） -->
    <view class="hero">
      <view class="hero-card">
        <view class="hc-row">
          <text class="hc-coin">🪙</text>
          <text class="hc-amount">{{ fmt(s.balance) }}</text>
          <text class="hc-unit">元宝</text>
        </view>
        <text class="hc-rule">100元宝 ≈ ¥1 · 来源：购物返利 / 邀请奖励</text>
        <view class="hc-stats">
          <view class="stat"><text class="stat-label">本月获取</text><text class="stat-num">+{{ fmt(s.month_earned) }}</text></view>
          <view class="stat"><text class="stat-label">本月消耗</text><text class="stat-num">{{ fmt(s.month_spent) }}</text></view>
          <view class="stat"><text class="stat-label">累计获取</text><text class="stat-num">{{ fmt(s.total_earned) }}</text></view>
        </view>
      </view>
    </view>

    <!-- tabs（画布 15：全部/获取/消耗） -->
    <view class="tabs">
      <text v-for="t in tabs" :key="t.key" class="tab" :class="{ active: tab === t.key }" @click="tab = t.key; load()">{{ t.label }}</text>
    </view>

    <!-- 流水列表 -->
    <view class="flow-list">
      <view v-if="loading" class="empty"><text>加载中…</text></view>
      <view v-else-if="!flows.length" class="empty"><text>暂无元宝流水，购物/邀请好友可赚元宝</text></view>
      <view v-for="f in flows" :key="f.tx_id" class="flow-item">
        <view class="fi-icon"><text class="fi-emoji">{{ emojiOf(f) }}</text></view>
        <view class="fi-main">
          <text class="fi-title">{{ f.title }}<template v-if="f.source"> · {{ f.source }}</template></text>
          <text class="fi-detail">{{ shortTime(f.created_at) }}<template v-if="f.detail"> · {{ f.detail }}</template></text>
        </view>
        <text class="fi-amount" :class="{ neg: f.amount < 0 }">{{ f.amount > 0 ? '+' : '' }}{{ fmt(f.amount) }}</text>
      </view>
    </view>

    <text class="footnote">元宝不可提现、不可转赠，仅用于兑换会员等级；退款订单将扣回对应元宝</text>
  </view>
</template>

<script>
/**
 * 画布 15 元宝明细页（33:113，M5·权益会员）：
 * GET /api/me/member/ingot/summary（头卡）+ /ingot/flows?filter=all|earn|spend（列表）。
 * 元宝口径：1元=100元宝；唯一消耗=兑换等级（LEVEL_EXCHANGE）；退款冲销=REFUND_DEDUCT。
 */
import { request } from '@/utils/request';

const EMOJI = { ORDER_REBATE: '🛍️', INVITE_REWARD: '🤝', LEVEL_EXCHANGE: '🏅', REFUND_DEDUCT: '↩️', ADMIN_ADJUST: '⚙️' };

export default {
  data() {
    return {
      loading: true,
      tab: 'all',
      tabs: [
        { key: 'all', label: '全部' },
        { key: 'earn', label: '获取' },
        { key: 'spend', label: '消耗' },
      ],
      s: { balance: 0, month_earned: 0, month_spent: 0, total_earned: 0 },
      flows: [],
    };
  },
  onShow() {
    this.loadSummary();
    this.load();
  },
  methods: {
    fmt(n) {
      return Number(n ?? 0).toLocaleString();
    },
    emojiOf(f) {
      return EMOJI[String(f.type)] ?? '🪙';
    },
    shortTime(t) {
      return String(t ?? '').slice(5, 16);
    },
    async loadSummary() {
      try {
        this.s = await request('/api/me/member/ingot/summary');
      } catch (e) {
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      }
    },
    async load() {
      this.loading = true;
      try {
        const d = await request(`/api/me/member/ingot/flows?filter=${this.tab}&size=50`);
        this.flows = d.items ?? [];
      } catch (e) {
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      }
      this.loading = false;
    },
  },
};
</script>

<style scoped>
.ingot-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding-bottom: 40rpx;
}
.hero {
  background: linear-gradient(160deg, #f0568b 0%, var(--fyt-primary, #e8336d) 55%, #c9225a 100%);
  padding: 32rpx 32rpx 36rpx;
}
.hero-card {
  background: linear-gradient(140deg, #d4143c 0%, #a80e33 100%);
  border: 3rpx solid rgba(255, 255, 255, 0.35);
  border-radius: 28rpx;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.hc-row { display: flex; align-items: baseline; gap: 14rpx; }
.hc-coin { font-size: 44rpx; }
.hc-amount { font-size: 68rpx; font-weight: 900; color: var(--fyt-secondary, #ffaa1d); }
.hc-unit { font-size: 26rpx; color: #ffd9e6; }
.hc-rule { font-size: 22rpx; color: #ffc9db; }
.hc-stats { display: flex; gap: 16rpx; margin-top: 8rpx; }
.stat {
  flex: 1;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 16rpx;
  padding: 16rpx;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.stat-label { font-size: 20rpx; color: #ffc9db; }
.stat-num { font-size: 28rpx; font-weight: 900; color: #ffffff; }
.tabs {
  background: #fffdf7;
  display: flex;
  padding: 0 32rpx;
  border-bottom: 2rpx solid #f0e6d8;
}
.tab {
  font-size: 28rpx;
  color: var(--fyt-text-2, #8c8577);
  padding: 24rpx 0;
  margin-right: 48rpx;
  font-weight: 600;
}
.tab.active {
  color: var(--fyt-primary, #e8336d);
  font-weight: 900;
  border-bottom: 6rpx solid var(--fyt-primary, #e8336d);
}
.flow-list { padding: 24rpx 32rpx 0; display: flex; flex-direction: column; gap: 20rpx; }
.flow-item {
  background: #fffdf7;
  border: 2rpx solid #f0e0d0;
  border-radius: 20rpx;
  padding: 26rpx;
  display: flex;
  align-items: center;
  gap: 20rpx;
}
.fi-icon {
  width: 80rpx;
  height: 80rpx;
  border-radius: 50%;
  background: #fdeef4;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.fi-emoji { font-size: 38rpx; }
.fi-main { flex: 1; display: flex; flex-direction: column; gap: 6rpx; min-width: 0; }
.fi-title { font-size: 28rpx; font-weight: 800; color: #2b2b2b; }
.fi-detail {
  font-size: 22rpx;
  color: var(--fyt-text-2, #8c8577);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fi-amount { font-size: 30rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); flex-shrink: 0; }
.fi-amount.neg { color: var(--fyt-text-2, #8c8577); }
.empty {
  border: 2rpx dashed #e8d9c5;
  border-radius: 16rpx;
  padding: 48rpx 0;
  text-align: center;
  color: var(--fyt-text-2, #8c8577);
  font-size: 26rpx;
}
.footnote {
  display: block;
  margin: 32rpx 32rpx 0;
  font-size: 22rpx;
  color: #b3a89a;
  text-align: center;
  line-height: 1.6;
}
</style>
