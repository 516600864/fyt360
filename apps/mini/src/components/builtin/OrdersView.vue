<template>
  <view class="orders">
    <!-- 状态 tabs + 角标 -->
    <view class="tabs">
      <view
        v-for="t in tabs"
        :key="t.key"
        class="tab"
        :class="{ on: tab === t.key }"
        @tap="switchTab(t.key)"
      >
        <text class="t-lab">{{ t.name }}</text>
        <text v-if="t.key !== 'all' && badges[t.key] > 0" class="t-badge">{{ badges[t.key] }}</text>
      </view>
    </view>

    <view v-if="loading" class="tip"><text>加载中…</text></view>
    <view v-else-if="!items.length" class="tip">
      <text class="tip-emoji">🧾</text>
      <text class="tip-title">暂无相关订单</text>
      <text class="tip-desc">去首页逛逛，好物好券等你拿</text>
    </view>
    <view v-else class="list">
      <view v-for="o in items" :key="o.id" class="order-card">
        <!-- 头：平台徽标 + 时间 + 状态 -->
        <view class="head">
          <text class="plat" :class="'p-' + o.provider">{{ platName(o.provider) }}</text>
          <text class="time">{{ fmtTime(o.created_at) }}</text>
          <text class="status" :class="{ done: o.status === '已完成' || o.status === '已返利' }">{{ o.status }}</text>
        </view>
        <view class="sn-row" @tap="copySn(o.order_sn)">
          <text class="sn">订单编号 {{ o.order_sn }}</text>
          <text class="sn-copy">⧉ 复制</text>
        </view>
        <!-- 商品行 -->
        <view class="goods" @tap="goDetail(o)">
          <image class="pic" :src="o.pic" mode="aspectFill" />
          <view class="info">
            <text class="title">{{ o.title }}</text>
            <view class="price-row">
              <text class="price">¥{{ fmt(o.pay_price) }}</text>
              <text v-if="o.is_self_buy && o.est_rebate > 0" class="rebate">预估返利 ¥{{ fmt2(o.est_rebate) }}</text>
            </view>
          </view>
        </view>
        <!-- 操作行 -->
        <view class="ops">
          <view v-if="o.provider === 'recharge'" class="btn ghost" @tap="goRights"><text class="btn-t">再次兑换</text></view>
          <view
            v-if="canCancel(o)"
            class="btn ghost"
            @tap.stop="onCancel(o)"
          ><text class="btn-t">取消订单</text></view>
          <view class="btn solid" @tap="goDetail(o)"><text class="btn-t on">订单详情</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
/**
 * 我的订单（M6，画布 mini-09 全量对齐）：平台徽标 + 时间 + 状态 + 自购预估返利 + 操作。
 * 双挂载：pages/orders/index.vue（navigateTo）+ ShellView builtin:orders（tab 壳页内嵌）。
 * 业务诚实裁剪：CPS 订单由上游同步，无「去支付/取消订单/查看物流」通道，不放假按钮；
 * 「再次兑换」仅直充单（recharge）显示 → 跳权益页；点餐/电影票是消费单，不挂兑换按钮（2026-10-10 D先生）。
 */
import { request } from '../../utils/request';
import { copyText } from '../../utils/clip';

const PLAT_NAMES = {
  jd: '京东', tb: '淘宝', pdd: '拼多多', vip: '唯品会',
  self: '到店团购', mayixingqiu: '直充', recharge: '直充', movie: '电影票', dc: '点餐',
};

export default {
  props: {
    initTab: { type: String, default: 'all' },
  },
  data() {
    return {
      tab: this.initTab,
      badges: { pending: 0, paid: 0, completed: 0, refund: 0 },
      items: [],
      loading: false,
      tabs: [
        { key: 'all', name: '全部' },
        { key: 'pending', name: '待付款' },
        { key: 'paid', name: '已付款' },
        { key: 'completed', name: '已完成' },
        { key: 'refund', name: '退款售后' },
      ],
    };
  },
  watch: {
    initTab(v) { this.tab = v; this.load(); },
  },
  mounted() {
    this.load();
  },
  methods: {
    fmt(n) {
      return Number(n ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    fmt2(n) {
      return Number(n ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    },
    fmtTime(t) {
      if (!t) return '';
      const d = new Date(t);
      const p = (x) => String(x).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
    platName(p) {
      return PLAT_NAMES[p] ?? '其他';
    },
    copySn(sn) {
      copyText(sn, '订单编号已复制');
    },
    isIngot(p) {
      return p === 'recharge'; // 「再次兑换」只认真直充（点餐/电影票是消费单）
    },
    /** 未付款的自营单可取消（会退券+回补库存）；CPS/权益单由上游同步，无此通道 */
    canCancel(o) {
      return o.provider === 'self' && o.platform_status === 'created';
    },
    onCancel(o) {
      uni.showModal({
        title: '取消订单',
        content: '取消后将释放已占用的库存与优惠券，订单不可恢复。确定取消吗？',
        confirmText: '确定取消',
        confirmColor: '#e8336d',
        success: async (r) => {
          if (!r.confirm) return;
          try {
            const d = await request(`/api/trade/orders/${o.id}/cancel`, { method: 'POST' });
            uni.showToast({
              title: d.coupon_refunded ? '已取消，优惠券已退回' : '订单已取消',
              icon: 'none',
            });
            this.load();
          } catch (e) {
            uni.showToast({ title: e?.message ?? '取消失败', icon: 'none' });
          }
        },
      });
    },
    switchTab(k) {
      if (this.tab === k) return;
      this.tab = k;
      this.load();
    },
    goDetail(o) {
      uni.navigateTo({ url: `/pkg-goods/pages/orders/detail?id=${o.id}` });
    },
    goRights() {
      uni.navigateTo({ url: '/pages/rights/index', fail: () => {} });
    },
    async load() {
      this.loading = true;
      try {
        const d = await request(`/api/me/orders?tab=${encodeURIComponent(this.tab)}`);
        this.items = d.items ?? [];
        if (d.badges) this.badges = d.badges;
      } catch (e) {
        this.items = [];
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.orders { min-height: 100vh; background: $fyt-surface; padding-bottom: 40rpx; }

.tabs {
  position: sticky; top: 0; z-index: 5;
  display: flex; background: #fff; padding: 0 16rpx;
  border-bottom: 2rpx solid #ffe3ec;
}
.tab {
  flex: 1; position: relative; display: flex; align-items: center; justify-content: center;
  padding: 26rpx 0; gap: 6rpx;
}
.t-lab { font-size: 28rpx; color: #666; }
.tab.on .t-lab { color: var(--fyt-primary, #e8336d); font-weight: 900; }
.tab.on::after {
  content: ''; position: absolute; left: 50%; transform: translateX(-50%); bottom: 0;
  width: 56rpx; height: 6rpx; border-radius: 999rpx; background: var(--fyt-primary, #e8336d);
}
.t-badge {
  min-width: 30rpx; height: 30rpx; border-radius: 999rpx; background: var(--fyt-primary, #e8336d); color: #fff;
  font-size: 20rpx; font-weight: 800; display: flex; align-items: center; justify-content: center; padding: 0 6rpx;
}

.tip { display: flex; flex-direction: column; align-items: center; gap: 16rpx; padding: 160rpx 40rpx; }
.tip-emoji { font-size: 96rpx; }
.tip-title { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }
.tip-desc { font-size: 24rpx; color: #999; }

.list { padding: 24rpx 32rpx 0; display: flex; flex-direction: column; gap: 24rpx; }
.order-card {
  background: #fff; border: 3rpx solid #f7c2d6; border-radius: 24rpx; padding: 24rpx;
  display: flex; flex-direction: column; gap: 20rpx;
}
.head { display: flex; align-items: center; gap: 16rpx; }
.plat {
  font-size: 22rpx; font-weight: 800; color: #fff; border-radius: 8rpx; padding: 4rpx 14rpx;
  background: var(--fyt-primary, #e8336d);
}
.p-jd { background: #e23a3a; }
.p-tb { background: #ff7a00; }
.p-pdd { background: #e02e24; }
.p-vip { background: #8a2be2; }
.p-self { background: var(--fyt-primary, #e8336d); }
.p-mayixingqiu, .p-recharge, .p-movie, .p-dc { background: var(--fyt-secondary, #ffaa1d); color: var(--fyt-primary-dark, #a31245); }
.time { flex: 1; font-size: 22rpx; color: #bbb; }
.status { font-size: 26rpx; font-weight: 800; color: var(--fyt-primary, #e8336d); }
.status.done { color: #2fbf71; }
.sn-row { margin-top: -8rpx; display: flex; align-items: center; gap: 12rpx; }
.sn { font-size: 20rpx; color: #c8bfae; font-family: Consolas, monospace; }
.sn-copy { font-size: 20rpx; color: var(--fyt-primary, #e8336d); font-weight: 700; }

.goods { display: flex; gap: 20rpx; }
.pic { width: 150rpx; height: 150rpx; border-radius: 16rpx; background: var(--fyt-bg, #fff6e9); flex-shrink: 0; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12rpx; }
.title {
  font-size: 27rpx; color: #333; font-weight: 700;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.price-row { display: flex; align-items: center; gap: 16rpx; }
.price { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.rebate {
  font-size: 22rpx; font-weight: 700; color: var(--fyt-primary-dark, #a31245);
  background: #ffe9b8; border-radius: 8rpx; padding: 4rpx 12rpx;
}

.ops { display: flex; justify-content: flex-end; gap: 16rpx; }
.btn { border-radius: 999rpx; padding: 12rpx 32rpx; }
.btn.ghost { border: 2rpx solid var(--fyt-secondary, #ffaa1d); background: #fff; }
.btn.solid { background: var(--fyt-secondary, #ffaa1d); }
.btn-t { font-size: 24rpx; font-weight: 700; color: var(--fyt-primary-dark, #a31245); }
.btn-t.on { color: var(--fyt-primary-dark, #a31245); }
</style>
