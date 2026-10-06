<template>
  <view class="level-page" :style="pageTheme">
    <!-- 玫红头卡（画布 14）：当前等级 + 元宝 + 元宝明细入口 -->
    <view class="hero">
      <view class="hero-card">
        <view class="hc-top">
          <view class="hc-level-row">
            <text class="hc-crown">👑</text>
            <text class="hc-level">{{ current ? current.name : '省心会员 L1' }}</text>
            <view class="hc-badge"><text class="hc-badge-text">当前等级</text></view>
          </view>
          <text class="hc-ingot-link" @click="go('/pages/rights/ingot')">元宝明细 ›</text>
        </view>
        <view class="hc-ingot-row">
          <text class="hc-coin">🪙</text>
          <text class="hc-amount">{{ fmt(balance) }}</text>
          <text class="hc-unit">元宝</text>
        </view>
        <text class="hc-rule">100元宝 ≈ ¥1 · 购物/邀请即得，用于兑换会员等级</text>
      </view>

      <!-- 双胶囊（画布 14） -->
      <view class="dual-pill">
        <view class="dp"><text class="dp-text">🛍 购物返元宝 1元=100元宝</text></view>
        <view class="dp" @click="go('/pages/commission/invite')"><text class="dp-text">🤝 邀请好友 首单+500元宝</text></view>
      </view>
    </view>

    <!-- 等级权益对比 -->
    <text class="sec-title">等级权益对比</text>
    <view class="level-list">
      <view v-if="loading" class="empty"><text>加载中…</text></view>
      <view v-for="l in levels" :key="l.code" class="level-card" :class="{ current: l.is_current }">
        <view class="lc-head">
          <view class="lc-badge" :class="'lv-' + l.code.toLowerCase()">
            <text class="lc-badge-text">{{ l.code }}</text>
          </view>
          <text class="lc-name">{{ l.name }}</text>
          <view v-if="l.is_current" class="lc-current"><text class="lc-current-text">当前等级</text></view>
          <view v-else-if="l.ingot_price > 0" class="lc-price">
            <text class="lc-price-num">{{ fmt(l.ingot_price) }}</text>
            <text class="lc-price-unit"> 元宝</text>
          </view>
        </view>

        <!-- 进度条（非当前、可兑换等级） -->
        <view v-if="!l.is_current && l.ingot_price > 0" class="lc-progress">
          <view class="lcp-track"><view class="lcp-fill" :style="{ width: progressPct(l) + '%' }" /></view>
          <text class="lcp-label">{{ fmt(balance) }} / {{ fmt(l.ingot_price) }} 元宝<template v-if="l.lack > 0"> · 还差 {{ fmt(l.lack) }} 可兑换</template></text>
        </view>

        <view class="lc-rates">
          <view class="rate"><text class="rate-label">自购返利</text><text class="rate-num">{{ pct(l.self_rate) }}</text></view>
          <view class="rate"><text class="rate-label">直推分佣</text><text class="rate-num">{{ pct(l.direct_rate) }}</text></view>
          <view class="rate"><text class="rate-label">间推分佣</text><text class="rate-num">{{ l.team_rate > 0 ? pct(l.team_rate) : '—' }}</text></view>
        </view>
        <text v-if="l.desc" class="lc-desc">{{ l.desc }}</text>

        <!-- 兑换按钮：当前=无；可兑=玫红；不可兑=灰「元宝不足」 -->
        <view v-if="!l.is_current && l.ingot_price > 0" class="lc-action">
          <button v-if="l.exchangeable" class="lc-btn" @click="onExchange(l)">立即兑换</button>
          <button v-else class="lc-btn disabled" @click="onLack(l)">元宝不足</button>
        </view>
        <text v-if="l.is_current" class="lc-hint">自购省钱 · 纯消费者角色</text>
      </view>
    </view>

    <!-- 等级规则（画布 14） -->
    <view class="rule-card">
      <text class="rc-title">等级规则</text>
      <text class="rc-item">· 元宝仅通过购物返利与邀请奖励获得，不可购买</text>
      <text class="rc-item">· 等级兑换后永久有效，不做保级与降级</text>
      <text class="rc-item">· 佣金比例按上级自身等级收取，沿关系树三级内分配</text>
    </view>

    <!-- 底部固定条（画布 14） -->
    <view class="bottom-bar">
      <view class="bb-left">
        <text class="bb-label">我的元宝</text>
        <text class="bb-amount">{{ fmt(balance) }}</text>
      </view>
      <button class="bb-btn" @click="go('/pages/commission/invite')">邀请好友赚元宝 ›</button>
    </view>
  </view>
</template>

<script>
/**
 * 画布 14 会员等级页（33:1 / x8615，M5·权益会员）：
 * GET /api/me/member/level（元宝余额 + 当前等级 + 三档权益）；
 * POST /api/me/member/level/exchange（元宝唯一消耗 = 兑换等级，只升不降）。
 */
import { request } from '../../utils/request';
import { themeTokens } from '../../core/theme';

export default {
  data() {
    return { loading: true, balance: 0, current: null, levels: [] };
  },
  onShow() {
    this.load();
  },
  methods: {
    go(url) {
      uni.navigateTo({ url, fail: () => uni.showToast({ title: '页面建设中', icon: 'none' }) });
    },
    fmt(n) {
      return Number(n ?? 0).toLocaleString();
    },
    pct(rate) {
      return Math.round(Number(rate ?? 0) * 100) + '%';
    },
    progressPct(l) {
      if (!l.ingot_price) return 0;
      return Math.min(100, Math.round((this.balance / l.ingot_price) * 100));
    },
    async load() {
      this.loading = true;
      try {
        const d = await request('/api/me/member/level');
        this.balance = d.balance ?? 0;
        this.current = d.current;
        this.levels = d.levels ?? [];
      } catch (e) {
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      }
      this.loading = false;
    },
    onExchange(l) {
      uni.showModal({
        title: '兑换确认',
        content: `消耗 ${this.fmt(l.ingot_price)} 元宝兑换「${l.name}」，兑换后永久有效。确认兑换？`,
        confirmColor: themeTokens().primary || '#e8336d',
        success: (r) => {
          if (!r.confirm) return;
          request('/api/me/member/level/exchange', { method: 'POST', data: { code: l.code } })
            .then((d) => {
              uni.showToast({ title: `已升级 ${d.name}`, icon: 'success' });
              this.load();
            })
            .catch((e) => uni.showToast({ title: e.message ?? '兑换失败', icon: 'none' }));
        },
      });
    },
    onLack(l) {
      uni.showToast({ title: `还差 ${this.fmt(l.lack)} 元宝，邀请好友可赚元宝`, icon: 'none' });
    },
  },
};
</script>

<style scoped>
.level-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding-bottom: 200rpx;
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
.hc-top { display: flex; justify-content: space-between; align-items: center; }
.hc-level-row { display: flex; align-items: center; gap: 12rpx; }
.hc-crown { font-size: 36rpx; }
.hc-level { font-size: 34rpx; font-weight: 900; color: #ffffff; }
.hc-badge { background: var(--fyt-secondary, #ffaa1d); border-radius: 8rpx; padding: 4rpx 14rpx; }
.hc-badge-text { font-size: 20rpx; font-weight: 800; color: #7a3c00; }
.hc-ingot-link { font-size: 24rpx; color: #ffd9e6; font-weight: 600; }
.hc-ingot-row { display: flex; align-items: baseline; gap: 12rpx; }
.hc-coin { font-size: 40rpx; }
.hc-amount { font-size: 68rpx; font-weight: 900; color: var(--fyt-secondary, #ffaa1d); }
.hc-unit { font-size: 26rpx; color: #ffd9e6; }
.hc-rule { font-size: 22rpx; color: #ffc9db; }
.dual-pill { display: flex; gap: 16rpx; margin-top: 20rpx; }
.dp {
  flex: 1;
  background: #ffffff;
  border: 2rpx solid #ffffff;
  border-radius: 999rpx;
  padding: 14rpx 0;
  display: flex;
  justify-content: center;
}
.dp-text { font-size: 22rpx; font-weight: 800; color: var(--fyt-primary-dark, #a31245); }
.sec-title {
  display: block;
  margin: 32rpx 32rpx 20rpx;
  font-size: 30rpx;
  font-weight: 900;
  color: #2b2b2b;
}
.level-list { padding: 0 32rpx; display: flex; flex-direction: column; gap: 24rpx; }
.level-card {
  background: #fffdf7;
  border: 3rpx solid #eadfce;
  border-radius: 24rpx;
  padding: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.level-card.current { border-color: var(--fyt-primary, #e8336d); }
.lc-head { display: flex; align-items: center; gap: 14rpx; }
.lc-badge {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.lv-l1 { background: #fbdce7; }
.lv-l2 { background: var(--fyt-secondary, #ffaa1d); }
.lv-l3 { background: var(--fyt-primary, #e8336d); }
.lc-badge-text { font-size: 24rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }
.lv-l2 .lc-badge-text { color: #7a3c00; }
.lv-l3 .lc-badge-text { color: #ffffff; }
.lc-name { font-size: 32rpx; font-weight: 900; color: #2b2b2b; flex: 1; }
.lc-current { background: var(--fyt-primary, #e8336d); border-radius: 999rpx; padding: 6rpx 18rpx; }
.lc-current-text { font-size: 20rpx; font-weight: 800; color: #ffffff; }
.lc-price { display: flex; align-items: baseline; }
.lc-price-num { font-size: 30rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.lc-price-unit { font-size: 20rpx; color: #c9778f; }
.lc-progress { display: flex; flex-direction: column; gap: 8rpx; }
.lcp-track { height: 14rpx; background: #fbdce7; border-radius: 999rpx; overflow: hidden; }
.lcp-fill { height: 100%; background: linear-gradient(90deg, var(--fyt-secondary, #ffaa1d), var(--fyt-primary, #e8336d)); border-radius: 999rpx; }
.lcp-label { font-size: 22rpx; color: var(--fyt-text-2, #8c8577); }
.lc-rates { display: flex; }
.rate { flex: 1; display: flex; flex-direction: column; gap: 6rpx; }
.rate-label { font-size: 22rpx; color: var(--fyt-text-2, #8c8577); }
.rate-num { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.lc-desc { font-size: 22rpx; color: var(--fyt-text-2, #8c8577); }
.lc-hint { font-size: 22rpx; color: #b3a89a; }
.lc-action { display: flex; justify-content: flex-end; }
.lc-btn {
  background: var(--fyt-primary, #e8336d);
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 800;
  border-radius: 999rpx;
  padding: 0 48rpx;
  line-height: 72rpx;
  margin: 0;
}
.lc-btn.disabled { background: #e9d5cd; color: #b3a89a; }
.rule-card {
  margin: 24rpx 32rpx 0;
  background: #fffdf7;
  border: 2rpx solid #eadfce;
  border-radius: 20rpx;
  padding: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}
.rc-title { font-size: 28rpx; font-weight: 900; color: #2b2b2b; }
.rc-item { font-size: 24rpx; color: #6b5a4e; line-height: 1.7; }
.empty {
  border: 2rpx dashed #e8d9c5;
  border-radius: 16rpx;
  padding: 48rpx 0;
  text-align: center;
  color: var(--fyt-text-2, #8c8577);
  font-size: 26rpx;
}
.bottom-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fffdf7;
  border-top: 2rpx solid #f0e6d8;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bb-left { display: flex; flex-direction: column; gap: 4rpx; }
.bb-label { font-size: 22rpx; color: var(--fyt-text-2, #8c8577); }
.bb-amount { font-size: 36rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.bb-btn {
  background: #fdeef4;
  color: var(--fyt-primary, #e8336d);
  border: 3rpx solid var(--fyt-primary, #e8336d);
  font-size: 28rpx;
  font-weight: 800;
  border-radius: 999rpx;
  padding: 0 48rpx;
  line-height: 80rpx;
}
</style>
