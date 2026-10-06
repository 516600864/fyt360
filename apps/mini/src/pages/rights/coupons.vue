<template>
  <view class="coupon-page" :style="pageTheme">
    <!-- tabs（画布 19：待使用(N)/已使用/已过期）——切页签必须走switchTab 重新请求，
         否则只改 tab 变量不触发 load，三页签永远显示首次(unused)那份数据（2026-10-02 修） -->
    <view class="tabs">
      <text
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ active: tab === t.key }"
        @click="switchTab(t.key)"
      >
        {{ t.label }}<template v-if="t.key !== 'all'"> ({{ counts[t.key] }})</template>
      </text>
    </view>

    <!-- 券列表 -->
    <view class="list">
      <view v-if="loading" class="empty"><text>加载中…</text></view>
      <view v-else-if="!items.length" class="empty"><text>{{ tab === 'unused' ? '暂无可用券，去首页营销券条领取吧' : '暂无记录' }}</text></view>
      <view v-for="c in items" :key="c.id" class="coupon-card" :class="{ used: c.status !== 'unused' }">
        <view class="cc-icon"><text class="cc-emoji">{{ emojiOf(c) }}</text></view>
        <view class="cc-main">
          <text class="cc-name">{{ c.name }}</text>
          <text class="cc-meta">{{ metaOf(c) }}</text>
          <text v-if="c.status === 'used' && c.used_order_id" class="cc-used">已用于订单 #{{ c.used_order_id }}</text>
        </view>
        <view v-if="c.status === 'unused'" class="cc-btn" @click.stop="onUse(c)"><text class="cc-btn-text">去使用</text></view>
        <view v-else class="cc-btn ghost"><text class="cc-btn-text ghost-text">{{ c.status === 'used' ? '已使用' : '已过期' }}</text></view>
      </view>
    </view>

    <!-- 兑换码条（画布 19） -->
    <view class="redeem-bar" @click="onCode">
      <text class="rb-left">🔑 有兑换码？输入即可换券</text>
      <text class="rb-right">去兑换 ›</text>
    </view>
  </view>
</template>

<script>
/**
 * 画布 19 我的券包页（M5·权益会员）：
 * GET /api/me/member/coupons?tab=unused|used|expired（user_coupon × coupon，站点隔离）。
 * 核销链路（团购核销 verify）未覆盖券包 → 「出示使用」暂为提示，不造假券码。
 */
import { request } from '../../utils/request';

const EMOJI_MAP = { 咖啡: '☕', 奶茶: '🧋', 肯德基: '🍔', 麦当劳: '🍟', 电影: '🎬', 视频: '📺', 外卖: '🛵', 满: '💰', 折: '🏷️', 其他: '🎟️' };

export default {
  data() {
    return {
      loading: true,
      tab: 'unused',
      tabs: [
        { key: 'unused', label: '待使用' },
        { key: 'used', label: '已使用' },
        { key: 'expired', label: '已过期' },
      ],
      counts: { unused: 0, used: 0, expired: 0 },
      items: [],
    };
  },
  onShow() {
    this.load();
  },
  methods: {
    emojiOf(c) {
      for (const [k, v] of Object.entries(EMOJI_MAP)) {
        if (String(c.name).includes(k)) return v;
      }
      return '🎟️';
    },
    metaOf(c) {
      const parts = [];
      if (c.type === 'cash_off') parts.push(`¥${c.amount} 券`);
      else if (c.type === 'discount') parts.push(`${Math.round(c.amount * 10) / 10} 折`);
      else parts.push('兑换券');
      if (c.threshold > 0) parts.push(`满 ¥${c.threshold} 可用`);
      if (c.valid_to) parts.push(`至 ${String(c.valid_to).slice(5, 10)}`);
      return parts.join(' · ');
    },
    async load() {
      this.loading = true;
      try {
        const d = await request(`/api/me/member/coupons?tab=${this.tab}`);
        this.counts = d.counts ?? { unused: 0, used: 0, expired: 0 };
        this.items = d.items ?? [];
      } catch (e) {
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      }
      this.loading = false;
    },
    switchTab(k) {
      if (this.tab === k) return;
      this.tab = k;
      this.load();
    },
    onUse(c) {
      // 档 C：营销券在下单时抵扣（确认订单页选券）→ 跳自营商品列表去挑商品
      if (c.scope === 'self') {
        uni.navigateTo({ url: '/pages/goods/list', fail: () => uni.showToast({ title: '页面打开失败', icon: 'none' }) });
        return;
      }
      uni.showToast({ title: '权益券暂不支持直接抵扣', icon: 'none' });
    },
    onCode() {
      uni.showToast({ title: '兑换码功能即将开放', icon: 'none' });
    },
  },
};
</script>

<style scoped>
.coupon-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding-bottom: 60rpx;
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
.coupon-card {
  background: #fffdf7;
  border: 3rpx solid var(--fyt-primary, #e8336d);
  border-radius: 20rpx;
  padding: 26rpx;
  display: flex;
  align-items: center;
  gap: 20rpx;
}
.coupon-card.used { border-color: #eadfce; opacity: 0.75; }
.cc-icon {
  width: 88rpx;
  height: 88rpx;
  border-radius: 20rpx;
  background: linear-gradient(140deg, #fdeef4, #fff3d6);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.cc-emoji { font-size: 44rpx; }
.cc-main { flex: 1; display: flex; flex-direction: column; gap: 6rpx; min-width: 0; }
.cc-name { font-size: 28rpx; font-weight: 800; color: #2b2b2b; }
.cc-meta { font-size: 22rpx; color: var(--fyt-text-2, #8c8577); }
.cc-used { font-size: 20rpx; color: var(--fyt-text-2, #8c8577); }
.cc-btn {
  background: var(--fyt-primary, #e8336d);
  border-radius: 999rpx;
  padding: 14rpx 28rpx;
  flex-shrink: 0;
}
.cc-btn-text { font-size: 24rpx; font-weight: 800; color: #ffffff; }
.cc-btn.ghost { background: #eee7dc; }
.ghost-text { color: var(--fyt-text-2, #8c8577); }
.empty {
  border: 2rpx dashed #e8d9c5;
  border-radius: 16rpx;
  padding: 48rpx 0;
  text-align: center;
  color: var(--fyt-text-2, #8c8577);
  font-size: 26rpx;
}
.redeem-bar {
  margin: 28rpx 32rpx 0;
  background: #fdeef4;
  border-radius: 16rpx;
  padding: 24rpx 28rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.rb-left { font-size: 26rpx; font-weight: 800; color: var(--fyt-primary-dark, #a31245); }
.rb-right { font-size: 24rpx; font-weight: 800; color: var(--fyt-primary, #e8336d); }
</style>
