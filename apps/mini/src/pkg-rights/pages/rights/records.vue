<template>
  <view class="record-page" :style="pageTheme">
    <!-- tabs（画布 12：全部/充值中/已到账/退款） -->
    <view class="tabs">
      <text v-for="t in tabs" :key="t.key" class="tab" :class="{ active: tab === t.key }" @click="tab = t.key; load()">{{ t.label }}</text>
    </view>

    <!-- 列表 -->
    <view class="list">
      <view v-if="loading" class="empty"><text>加载中…</text></view>
      <view v-else-if="!items.length" class="empty"><text>暂无兑换记录，去权益页逛逛吧</text></view>
      <view v-for="r in items" :key="r.id" class="record-item">
        <view class="ri-icon"><text class="ri-emoji">{{ emojiOf(r.title) }}</text></view>
        <view class="ri-main">
          <text class="ri-title">{{ r.title }}</text>
          <text class="ri-detail">{{ shortTime(r.created_at) }}<template v-if="subOf(r)"> · {{ subOf(r) }}</template></text>
        </view>
        <view class="ri-right">
          <view class="ri-badge" :class="'st-' + r.status"><text class="ri-badge-text">{{ r.status_label }}</text></view>
        </view>
      </view>
    </view>

    <text class="footnote">兑换成功后不支持撤销，到账失败积分将自动退回账户</text>
  </view>
</template>

<script>
/**
 * 画布 12 兑换记录页（M5·权益会员）：
 * GET /api/me/member/exchange-records?tab=all|pending|done|refund（蚂蚁系订单 mayixingqiu/recharge/movie/dc，只读）。
 * 积分消耗发生在蚂蚁侧不落库（CPS 铁律），故列表不展示积分金额，仅状态徽标。
 */
import { request } from '@/utils/request';

const EMOJI_MAP = { 视频: '📺', 影音: '📺', 音乐: '🎧', 音频: '🎧', 读书: '📚', 学习: '📚', 咖啡: '☕', 奶茶: '🧋', 肯德基: '🍔', 麦当劳: '🍟', 电影: '🎬', 话费: '📱', 其他: '🎁' };

export default {
  data() {
    return {
      loading: true,
      tab: 'all',
      tabs: [
        { key: 'all', label: '全部' },
        { key: 'pending', label: '充值中' },
        { key: 'done', label: '已到账' },
        { key: 'refund', label: '退款' },
      ],
      items: [],
    };
  },
  onShow() {
    this.load();
  },
  methods: {
    emojiOf(title) {
      for (const [k, v] of Object.entries(EMOJI_MAP)) {
        if (String(title).includes(k)) return v;
      }
      return '🎁';
    },
    shortTime(t) {
      return String(t ?? '').slice(5, 16);
    },
    subOf(r) {
      // 副行：待支付/充值中给订单号尾号；已到账给现金实付（蚂蚁跟单回传）
      if (r.status === 'done' && r.pay_price > 0) return `实付 ¥${Number(r.pay_price).toFixed(2)}`;
      return r.order_sn ? `单号 ${String(r.order_sn).slice(-8)}` : '';
    },
    async load() {
      this.loading = true;
      try {
        const d = await request(`/api/me/member/exchange-records?tab=${this.tab}&size=50`);
        this.items = d.items ?? [];
      } catch (e) {
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      }
      this.loading = false;
    },
  },
};
</script>

<style scoped>
.record-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding-bottom: 40rpx;
}
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
  margin-right: 44rpx;
  font-weight: 600;
}
.tab.active { color: var(--fyt-primary, #e8336d); font-weight: 900; border-bottom: 6rpx solid var(--fyt-primary, #e8336d); }
.list { padding: 24rpx 32rpx 0; display: flex; flex-direction: column; gap: 20rpx; }
.record-item {
  background: #fffdf7;
  border: 2rpx solid #f0e0d0;
  border-radius: 20rpx;
  padding: 26rpx;
  display: flex;
  align-items: center;
  gap: 20rpx;
}
.ri-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 20rpx;
  background: #fdeef4;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ri-emoji { font-size: 44rpx; }
.ri-main { flex: 1; display: flex; flex-direction: column; gap: 6rpx; min-width: 0; }
.ri-title { font-size: 28rpx; font-weight: 800; color: #2b2b2b; }
.ri-detail { font-size: 22rpx; color: var(--fyt-text-2, #8c8577); }
.ri-right { flex-shrink: 0; }
.ri-badge { border-radius: 8rpx; padding: 6rpx 14rpx; }
.st-done { background: var(--fyt-secondary, #ffaa1d); }
.st-pending { background: #fdeef4; }
.st-refund, .st-refunding { background: #eee7dc; }
.ri-badge-text { font-size: 20rpx; font-weight: 800; color: #7a3c00; }
.st-pending .ri-badge-text { color: var(--fyt-primary-dark, #a31245); }
.st-refund .ri-badge-text, .st-refunding .ri-badge-text { color: #6b5a4e; }
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
