<template>
  <view class="wallet-page" :style="pageTheme">
    <!-- 玫红渐变余额卡（画布 23） -->
    <view class="hero">
      <view class="hero-card">
        <text class="hero-label">可提现佣金（¥）</text>
        <text class="hero-amount">{{ fmt(balance) }}</text>
        <view class="hero-stats">
          <view class="stat">
            <text class="stat-label">累计收益</text>
            <text class="stat-num">¥{{ fmt(total) }}</text>
          </view>
          <view class="stat">
            <text class="stat-label">待结算</text>
            <text class="stat-num">¥{{ fmt(pending) }}</text>
          </view>
          <view class="stat">
            <text class="stat-label">今日新增</text>
            <text class="stat-num">¥{{ fmt(today) }}</text>
          </view>
        </view>
      </view>
      <!-- 等级横幅 -->
      <view v-if="level" class="level-banner" @click="goUpgrade">
        <text class="lb-left">🔥 {{ level.name }} 自购{{ pct(level.self_rate) }} · 直推{{ pct(level.direct_rate) }}</text>
        <text class="lb-right" v-if="level.level_id < 3">升L3拿更多 ›</text>
      </view>
    </view>

    <!-- 流水 tab -->
    <view class="flow-tabs">
      <text v-for="t in tabs" :key="t.key" class="ft" :class="{ active: tab === t.key }" @click="tab = t.key; loadFlows()">{{ t.label }}</text>
    </view>

    <!-- 流水列表 -->
    <view class="flow-list">
      <view v-if="loading" class="empty"><text>加载中…</text></view>
      <view v-else-if="!flows.length" class="empty"><text>暂无流水，去逛逛赚佣金吧</text></view>
      <view v-for="f in filteredFlows" :key="f.kind + f.id" class="flow-item">
        <view class="fi-icon" :class="f.kind === 'withdraw' ? 'ic-wd' : 'ic-cm'">
          <text>{{ f.kind === 'withdraw' ? '💰' : f.level === 1 ? '🛒' : '🤝' }}</text>
        </view>
        <view class="fi-main">
          <text class="fi-title">{{ f.title }} · {{ f.kind === 'withdraw' ? (f.settled ? '成功' : '处理中') : (f.provider === 'self' ? '到店团购订单' : 'CPS订单') }}</text>
          <text class="fi-detail">{{ f.created_at.slice(5, 16) }} · {{ f.detail }}</text>
        </view>
        <view class="fi-right">
          <text class="fi-amount" :class="{ neg: f.amount < 0 }">{{ f.amount < 0 ? '-' : '+' }}¥{{ fmt(Math.abs(f.amount)) }}</text>
          <text class="fi-badge" :class="{ ok: f.settled }">{{ f.status_label }}</text>
        </view>
      </view>
    </view>

    <text class="footnote">佣金与元宝相互独立：佣金为现金可提现，元宝仅用于兑换等级</text>

    <!-- 底部固定提现条 -->
    <view class="bottom-bar">
      <view class="bb-left">
        <text class="bb-label">可提现</text>
        <text class="bb-amount">¥{{ fmt(balance) }}</text>
      </view>
      <button class="bb-btn" @click="goWithdraw">去提现</button>
    </view>
  </view>
</template>

<script>
/** 画布 23 佣金钱包页（33:574，M4·分销）：余额卡 + 等级横幅 + 混合流水 + 底部提现条 */
import { request } from '../../utils/request';

export default {
  data() {
    return {
      balance: 0, total: 0, pending: 0, today: 0, level: null,
      tab: 'all',
      tabs: [
        { key: 'all', label: '全部' },
        { key: 'pending', label: '待结算' },
        { key: 'settled', label: '已到账' },
      ],
      flows: [],
      loading: true,
    };
  },
  computed: {
    filteredFlows() {
      if (this.tab === 'pending') return this.flows.filter((f) => !f.settled && f.kind === 'commission');
      if (this.tab === 'settled') return this.flows.filter((f) => f.settled);
      return this.flows;
    },
  },
  onShow() {
    this.load();
  },
  methods: {
    fmt(n) {
      return Number(n ?? 0).toFixed(2);
    },
    pct(rate) {
      return Math.round(Number(rate ?? 0) * 100) + '%';
    },
    async load() {
      try {
        const s = await request('/api/me/commission/summary');
        this.balance = s.balance;
        this.total = s.total;
        this.pending = s.pending;
        this.today = s.today;
        this.level = s.level;
        await this.loadFlows();
      } catch (e) {
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      }
    },
    async loadFlows() {
      this.loading = true;
      try {
        const d = await request('/api/me/commission/flows?size=50');
        this.flows = d.items;
      } catch (e) {
        this.flows = [];
      } finally {
        this.loading = false;
      }
    },
    goWithdraw() {
      uni.navigateTo({ url: '/pages/commission/withdraw' });
    },
    goUpgrade() {
      uni.showToast({ title: '会员等级即将开放', icon: 'none' });
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.wallet-page { min-height: 100vh; background: var(--fyt-bg, #fff6e9); padding-bottom: 160rpx; }

.hero {
  background: linear-gradient(180deg, var(--fyt-primary, #e8336d) 0%, var(--fyt-primary, #e8336d) 78%, var(--fyt-bg, #fff6e9) 78%);
  padding: 24rpx 32rpx 0;
}
.hero-card {
  background: linear-gradient(135deg, #c01c50 0%, var(--fyt-primary, #e8336d) 100%);
  border-radius: $fyt-radius-lg; padding: 36rpx 32rpx;
  box-shadow: 0 8rpx 24rpx rgba(163, 18, 69, 0.25);
}
.hero-label { font-size: 26rpx; color: rgba(255, 255, 255, 0.85); }
.hero-amount { display: block; font-size: 72rpx; font-weight: 900; color: var(--fyt-secondary, #ffaa1d); margin: 8rpx 0 24rpx; }
.hero-stats { display: flex; gap: 16rpx; }
.stat {
  flex: 1; background: rgba(255, 255, 255, 0.12); border-radius: $fyt-radius-md; padding: 16rpx 20rpx;
  display: flex; flex-direction: column; gap: 4rpx;
}
.stat-label { font-size: 22rpx; color: rgba(255, 255, 255, 0.75); }
.stat-num { font-size: 28rpx; font-weight: 800; color: #fff; }

.level-banner {
  margin-top: 20rpx; background: #ffe3ef; border-radius: 999rpx;
  padding: 16rpx 28rpx; display: flex; justify-content: space-between; align-items: center;
}
.lb-left { font-size: 24rpx; color: var(--fyt-primary-dark, #a31245); font-weight: 700; }
.lb-right { font-size: 24rpx; color: var(--fyt-primary, #e8336d); font-weight: 800; }

.flow-tabs {
  display: flex; gap: 44rpx; padding: 28rpx 36rpx 16rpx; background: #fffdf7;
  border-bottom: 2rpx solid #f0dfc8;
}
.ft { font-size: 28rpx; color: var(--fyt-text-2, #8c8577); font-weight: 500; padding-bottom: 12rpx; }
.ft.active { color: var(--fyt-primary, #e8336d); font-weight: 900; border-bottom: 6rpx solid var(--fyt-primary, #e8336d); }

.flow-list { padding: 8rpx 32rpx; display: flex; flex-direction: column; gap: 20rpx; }
.empty { text-align: center; color: #a08592; font-size: 26rpx; padding: 80rpx 0; }
.flow-item {
  background: #fffdf7; border: 2rpx solid #f0dfc8; border-radius: $fyt-radius-lg;
  padding: 28rpx; display: flex; align-items: center; gap: 20rpx;
}
.fi-icon {
  width: 88rpx; height: 88rpx; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 40rpx;
}
.ic-cm { background: #ffe3ef; }
.ic-wd { background: #fff1d6; }
.fi-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6rpx; }
.fi-title { font-size: 28rpx; font-weight: 800; color: #3d2530; }
.fi-detail { font-size: 22rpx; color: #a08592; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fi-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8rpx; flex-shrink: 0; }
.fi-amount { font-size: 30rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.fi-amount.neg { color: var(--fyt-text-2, #8c8577); }
.fi-badge {
  font-size: 20rpx; color: var(--fyt-primary-dark, #a31245); background: #ffe3ef;
  border-radius: 999rpx; padding: 4rpx 14rpx; font-weight: 700;
}
.fi-badge.ok { background: var(--fyt-secondary, #ffaa1d); color: #fff; }

.footnote { display: block; text-align: center; font-size: 22rpx; color: #a08592; padding: 28rpx 40rpx; }

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
</style>
