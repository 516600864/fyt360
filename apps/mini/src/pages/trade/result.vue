<template>
  <view class="rs-page" :style="pageTheme">
    <!-- 成功卡（画布 18：金勾 + 金额 + 返利提示） -->
    <view class="hero-card">
      <view class="check"><text class="check-t">✓</text></view>
      <text class="hero-title">支付成功</text>
      <text class="hero-sub">¥{{ fmt(amount) }} · 微信支付</text>
      <view class="rebate-pill">
        <text class="rp-t">🪙 结算后返 {{ fmt(rebate) }} 元宝</text>
        <text class="rp-link" @click="goIngot">余额查看 ›</text>
      </view>
    </view>

    <!-- 核销券卡（到店核销单：支付成功即产券） -->
    <view v-if="coupon" class="coupon-card">
      <view class="cc-head"><text class="cc-t">🏪 到店核销券</text><text class="cc-status">{{ couponStatusText }}</text></view>
      <view class="cc-code-row">
        <text class="cc-code">{{ coupon.code }}</text>
        <text class="cc-copy" @click="copyCode">复制</text>
      </view>
      <text class="cc-desc">到店出示券码由店员核销 · 可核销 {{ coupon.used_times ?? 0 }}/{{ coupon.total_times ?? 1 }} 次{{ coupon.expire_at ? ` · ${coupon.expire_at.slice(0, 10)} 前有效` : '' }}</text>
      <button v-if="coupon.status !== 'used'" class="cc-qr-btn" @click="showQr">出示核销码</button>
    </view>

    <!-- 订单信息 -->
    <view class="info-card">
      <view class="i-row"><text class="i-label">订单编号</text><view class="i-right"><text class="i-val">{{ orderSn }}</text><text class="i-copy" @click="copySn">复制</text></view></view>
      <view class="i-row"><text class="i-label">商品</text><text class="i-val">{{ title }} ×{{ num }}</text></view>
      <view class="i-row"><text class="i-label">状态</text><text class="i-val hot">{{ mock ? '已结算（联调通道）' : '已结算 · 返利到账' }}</text></view>
    </view>

    <!-- 操作按钮（画布 18：查看订单/查看券包） -->
    <view class="btn-row">
      <button class="btn ghost" @click="goOrders">查看订单</button>
      <button class="btn solid" @click="goHome">再逛逛</button>
    </view>

    <!-- 邀请横幅（画布 18） -->
    <view class="invite-strip" @click="goInvite">
      <view class="is-main">
        <text class="is-t">🤝 邀好友下单，每单再赚元宝</text>
        <text class="is-s">首单奖励 500 元宝/人 · 上不封顶</text>
      </view>
      <button class="is-btn" open-type="share">去邀请</button>
    </view>
  </view>
</template>

<script>
/**
 * 画布 18 支付结果页（团购交易链）：
 * 参数 = order_id&paid=1&mock=1；订单详情由 storage 传递简化（金额/标题来自 confirm 落库值经 me/orders 查询）。
 * 简化实现：金额与返利从 /api/me/orders/:id 详情端点拉取（M6.5 已有）。
 */
import { request } from '../../utils/request';
import { copyText } from '../../utils/clip';

export default {
  data() {
    return { orderId: 0, amount: 0, rebate: 0, orderSn: '', title: '', num: 1, mock: false, coupon: null };
  },
  computed: {
    couponStatusText() {
      const s = this.coupon?.status ?? 'unused';
      return { unused: '未使用', partial: '部分核销', used: '已核销', expired: '已过期' }[s] ?? '未使用';
    },
  },
  onLoad(q) {
    this.orderId = Number(q.order_id ?? 0);
    this.mock = String(q.mock ?? '') === '1';
    this.load();
  },
  onShareAppMessage() {
    const uid = uni.getStorageSync('fyt_userId') || '';
    const invite = 'FYT' + Number(uid || 0).toString(36);
    return { title: '吃喝玩乐购 · 一站式省钱变现', path: `/pages/index/index?invite=${invite}` };
  },
  methods: {
    fmt(n) {
      return Number(n ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    },
    async load() {
      try {
        const d = await request(`/api/me/orders/${this.orderId}`);
        this.amount = d.pay_price ?? 0;
        this.rebate = Math.floor((d.pay_price ?? 0) * 100);
        this.orderSn = d.order_sn ?? '';
        this.title = d.title ?? '';
        this.num = d.sku_snapshot?.num ?? 1;
        this.coupon = d.verify_coupon ?? null;
      } catch (e) {
        uni.showToast({ title: e.message ?? '订单加载失败', icon: 'none' });
      }
    },
    copySn() {
      copyText(this.orderSn, '订单编号已复制');
    },
    copyCode() {
      copyText(this.coupon?.code, '券码已复制');
    },
    showQr() {
      uni.navigateTo({ url: `/pages/verify/qrcode?order_id=${this.orderId}` });
    },
    goIngot() {
      uni.navigateTo({ url: '/pages/rights/ingot' });
    },
    goOrders() {
      // 自营支付成功 → 订单即「已付款（待使用）」
      uni.navigateTo({ url: '/pages/orders/index?tab=paid' });
    },
    goHome() {
      uni.switchTab({ url: '/pages/index/index' });
    },
    goInvite() {
      uni.navigateTo({ url: '/pages/commission/invite' });
    },
  },
};
</script>

<style scoped>
.rs-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding: 24rpx 32rpx 64rpx;
}
.hero-card {
  background: linear-gradient(160deg, #f0568b 0%, var(--fyt-primary, #e8336d) 55%, #c9225a 100%);
  border-radius: 28rpx;
  padding: 56rpx 40rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
}
.check {
  width: 128rpx; height: 128rpx; border-radius: 50%;
  background: var(--fyt-secondary, #ffaa1d);
  display: flex; align-items: center; justify-content: center;
  border: 6rpx solid #ffffff;
}
.check-t { font-size: 72rpx; font-weight: 900; color: #ffffff; }
.hero-title { font-size: 48rpx; font-weight: 900; color: #ffffff; margin-top: 8rpx; }
.hero-sub { font-size: 28rpx; color: #ffd9e6; }
.rebate-pill {
  margin-top: 20rpx;
  background: rgba(255, 255, 255, 0.16);
  border-radius: 999rpx;
  padding: 16rpx 32rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.rp-t { font-size: 26rpx; font-weight: 800; color: #ffffff; }
.rp-link { font-size: 24rpx; color: var(--fyt-secondary, #ffaa1d); font-weight: 800; }

.info-card {
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  padding: 10rpx 28rpx;
  margin-top: 24rpx;
}
.i-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 24rpx 0;
  border-bottom: 2rpx solid #fdeef4;
}
.i-row:last-child { border-bottom: none; }
.i-label { font-size: 26rpx; color: var(--fyt-text-2, #8c8577); }
.i-right { display: flex; align-items: center; gap: 16rpx; }
.i-val { font-size: 26rpx; color: #2b2b2b; font-weight: 600; max-width: 380rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.i-val.hot { color: var(--fyt-primary, #e8336d); }
.i-copy { font-size: 22rpx; color: var(--fyt-primary, #e8336d); border: 2rpx solid var(--fyt-primary, #e8336d); border-radius: 8rpx; padding: 2rpx 12rpx; }

.coupon-card {
  margin-top: 24rpx;
  background: linear-gradient(160deg, #fff3d6, #ffe9b8);
  border: 3rpx solid var(--fyt-secondary, #ffaa1d);
  border-radius: 20rpx;
  padding: 28rpx;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}
.cc-head { display: flex; justify-content: space-between; align-items: center; }
.cc-t { font-size: 30rpx; font-weight: 900; color: #7a3c00; }
.cc-status { font-size: 22rpx; font-weight: 800; color: #ffffff; background: var(--fyt-secondary, #ffaa1d); border-radius: 999rpx; padding: 4rpx 18rpx; }
.cc-code-row { display: flex; align-items: center; gap: 16rpx; }
.cc-code { font-size: 44rpx; font-weight: 900; letter-spacing: 4rpx; color: #2b2b2b; }
.cc-copy { font-size: 22rpx; color: var(--fyt-primary, #e8336d); border: 2rpx solid var(--fyt-primary, #e8336d); border-radius: 8rpx; padding: 2rpx 12rpx; }
.cc-desc { font-size: 22rpx; color: #a36b00; line-height: 1.5; }
.cc-qr-btn { margin-top: 20rpx; background: var(--fyt-primary, #e8336d); color: #ffffff; font-size: 26rpx; font-weight: Bold; border-radius: 40rpx; line-height: 76rpx; }

.btn-row { display: flex; gap: 24rpx; margin-top: 28rpx; }
.btn {
  flex: 1;
  font-size: 30rpx;
  font-weight: 900;
  border-radius: 999rpx;
  padding: 20rpx 0;
}
.btn.ghost { background: #fffdf7; color: var(--fyt-primary, #e8336d); border: 3rpx solid var(--fyt-primary, #e8336d); }
.btn.solid { background: linear-gradient(160deg, #f0568b, var(--fyt-primary, #e8336d)); color: #ffffff; border: none; }

.invite-strip {
  margin-top: 28rpx;
  background: linear-gradient(160deg, #fff3d6, #ffe9b8);
  border: 2rpx solid var(--fyt-secondary, #ffaa1d);
  border-radius: 20rpx;
  padding: 24rpx 28rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.is-main { display: flex; flex-direction: column; gap: 8rpx; }
.is-t { font-size: 28rpx; font-weight: 900; color: #7a3c00; }
.is-s { font-size: 22rpx; color: #c77800; }
.is-btn {
  background: var(--fyt-primary, #e8336d);
  color: #ffffff;
  font-size: 26rpx;
  font-weight: 900;
  border-radius: 999rpx;
  padding: 12rpx 32rpx;
  border: none;
  line-height: 1.6;
}
</style>
