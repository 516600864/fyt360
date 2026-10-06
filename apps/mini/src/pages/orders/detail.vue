<template>
  <view class="detail" :style="pageTheme">
    <view v-if="loading" class="tip"><text>加载中…</text></view>
    <view v-else-if="!o" class="tip">
      <text class="tip-title">订单不存在</text>
      <text class="tip-desc">该订单可能不属于当前账号</text>
    </view>
    <template v-else>
      <!-- 状态横幅 -->
      <view class="hero">
        <view class="hero-ico"><text class="hero-emoji">{{ statusEmoji }}</text></view>
        <view class="hero-txt">
          <text class="hero-status">{{ o.status }}</text>
          <text class="hero-desc">{{ statusDesc }}</text>
        </view>
      </view>

      <!-- 跟单进度：提交订单 → 平台确认 → 返利到账 -->
      <view class="card">
        <text class="card-title">跟单进度</text>
        <view class="steps">
          <template v-for="(s, i) in steps" :key="s.name">
            <view class="step">
              <view class="dot" :class="{ on: s.done, last: i === steps.length - 1 }" />
              <text class="s-name" :class="{ on: s.done }">{{ s.name }}</text>
              <text class="s-time" :class="{ on: s.done }">{{ s.time }}</text>
            </view>
            <view v-if="i < steps.length - 1" class="bar" :class="{ on: steps[i + 1].done || s.done }" />
          </template>
        </view>
      </view>

      <!-- 商品卡 -->
      <view class="card goods">
        <image class="pic" :src="o.pic" mode="aspectFill" />
        <view class="g-info">
          <text class="g-title">{{ o.title }}</text>
          <text class="g-plat">{{ platName(o.provider) }}订单</text>
          <view class="g-price-row">
            <text class="g-price">¥{{ fmt(o.pay_price) }}</text>
          </view>
        </view>
      </view>

      <!-- 返利明细（仅自购单） -->
      <view v-if="o.is_self_buy" class="card">
        <view class="rb-head">
          <text class="card-title">返利明细</text>
        </view>
        <view class="kv"><text class="k">订单实付金额</text><text class="v">¥{{ fmt(o.pay_price) }}</text></view>
        <view class="kv"><text class="k">佣金比例（自购）</text><text class="v">{{ pct(o.self_rate) }}</text></view>
        <view class="kv"><text class="k hl">预估返利（含自购）</text><text class="v money">¥{{ fmt2(o.est_rebate) }}</text></view>
        <view class="rb-note">
          <text class="rb-note-t">确认收货 + 平台结算后自动入余额，退款则不计返利</text>
        </view>
      </view>

      <!-- 核销券（到店核销团购单，画布 mini-20 入口） -->
      <view v-if="o.fulfillment === 'group' && o.verify_coupon" class="card">
        <text class="card-title">到店核销券</text>
        <view class="vc-row">
          <text class="vc-code">{{ o.verify_coupon.code }}</text>
          <text class="copy" @tap="copyCoupon">复制</text>
        </view>
        <view class="kv"><text class="k">券状态</text><text class="v hl">{{ couponStatus }}</text></view>
        <view class="kv"><text class="k">可核销次数</text><text class="v">{{ o.verify_coupon.used_times ?? 0 }}/{{ o.verify_coupon.total_times ?? 1 }}</text></view>
        <view v-if="o.verify_coupon.expire_at" class="kv"><text class="k">有效期至</text><text class="v">{{ fmtTime(o.verify_coupon.expire_at) }}</text></view>
        <text class="vc-note">到店出示券码由店员核销，核销后不可退</text>
        <button v-if="o.verify_coupon.status !== 'used'" class="show-qr-btn" @tap="showQr">出示核销码</button>
      </view>

      <!-- 订单信息 -->
      <view class="card">
        <view class="kv"><text class="k">订单编号</text><text class="v sn" @tap="copySn">{{ o.order_sn }}</text><text class="copy" @tap="copySn">复制</text></view>
        <view class="kv"><text class="k">下单渠道</text><text class="v">{{ platName(o.provider) }}</text></view>
        <view class="kv"><text class="k">支付方式</text><text class="v">{{ payDesc }}</text></view>
        <view class="kv"><text class="k">下单时间</text><text class="v">{{ fmtTime(o.created_at) }}</text></view>
      </view>

      <!-- 未付款自营单：取消入口（释放库存+退券；CPS/权益单无此通道） -->
      <view v-if="canCancel" class="card">
        <view class="cancel-tip">订单未支付，取消后已占用的库存与优惠券将立即退回</view>
        <button class="cancel-btn" @tap="onCancel">取消订单</button>
      </view>
    </template>
  </view>
</template>

<script>
/**
 * 订单详情（M6，画布 mini-10 对齐）：状态横幅 + 跟单进度三节点 + 商品 + 自购返利明细 + 订单信息。
 * 业务诚实裁剪：CPS 订单支付/售发生在上游平台，无「联系客服/申请售后/确认收货」操作通道，底栏省略；
 * 支付方式显示上游口径；返利明细仅自购单（promoter=buyer）显示。
 */
import { request } from '../../utils/request';
import { copyText } from '../../utils/clip';

const PLAT_NAMES = {
  jd: '京东（蚂蚁星球跟单）', tb: '淘宝（淘口令跟单）', pdd: '拼多多（蚂蚁星球跟单）', vip: '唯品会（蚂蚁星球跟单）',
  self: '到店团购', mayixingqiu: '蚂蚁星球直充', recharge: '直充', movie: '电影票直充', dc: '直充',
};

export default {
  data() {
    return { id: 0, o: null, loading: true };
  },
  computed: {
    statusEmoji() {
      const s = this.o?.status ?? '';
      if (s === '已返利' || s === '已完成') return '✅';
      if (s.includes('退款')) return '↩️';
      if (s === '待付款') return '💳';
      return '⏰';
    },
    statusDesc() {
      const s = this.o?.status ?? '';
      if (s === '已返利' || s === '已完成') return '返利已到账，可在佣金钱包查看';
      if (s.includes('退款')) return '退款流程处理中，退款则不计返利';
      if (s === '待付款') return '订单已提交，等待上游平台确认付款';
      if (s === '待使用') return '支付成功，到店出示核销码使用';
      if (s === '待发货') return '订单已确认，等待核销使用';
      return '平台已确认订单，返利预计确认收货后到账';
    },
    couponStatus() {
      const s = this.o?.verify_coupon?.status ?? 'unused';
      return { unused: '未使用', partial: '部分核销', used: '已核销', expired: '已过期' }[s] ?? '未使用';
    },
    canCancel() {
      return this.o?.provider === 'self' && this.o?.platform_status === 'created';
    },
    steps() {
      const t = this.o?.timeline ?? {};
      const f = (x) => (x ? this.fmtTime(x) : '待同步');
      return [
        { name: '提交订单', time: f(t.submitted_at), done: !!t.submitted_at },
        { name: '平台确认', time: f(t.confirmed_at), done: !!t.confirmed_at },
        { name: '返利到账', time: f(t.rebated_at), done: !!t.rebated_at },
      ];
    },
    payDesc() {
      const p = this.o?.provider ?? '';
      if (['mayixingqiu', 'recharge', 'movie', 'dc'].includes(p)) return '微信支付';
      if (p === 'self') return '微信支付';
      return '上游平台支付';
    },
  },
  onLoad(q) {
    this.id = Number(q?.id ?? 0);
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
    pct(x) {
      return `${(Number(x ?? 0) * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
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
    copySn() {
      copyText(this.o?.order_sn, '订单编号已复制');
    },
    copyCoupon() {
      copyText(this.o?.verify_coupon?.code, '券码已复制');
    },
    showQr() {
      uni.navigateTo({ url: `/pages/verify/qrcode?order_id=${this.id}` });
    },
    onCancel() {
      uni.showModal({
        title: '取消订单',
        content: '取消后将释放已占用的库存与优惠券，订单不可恢复。确定取消吗？',
        confirmText: '确定取消',
        confirmColor: '#e8336d',
        success: async (r) => {
          if (!r.confirm) return;
          try {
            const d = await request(`/api/trade/orders/${this.id}/cancel`, { method: 'POST' });
            uni.showToast({
              title: d.coupon_refunded ? '已取消，优惠券已退回' : '订单已取消',
              icon: 'none',
            });
            setTimeout(() => this.load(), 1200);
          } catch (e) {
            uni.showToast({ title: e?.message ?? '取消失败', icon: 'none' });
          }
        },
      });
    },
    async load() {
      this.loading = true;
      try {
        const d = await request(`/api/me/orders/${this.id}`);
        this.o = d;
      } catch (e) {
        this.o = null;
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.detail { min-height: 100vh; background: $fyt-surface; padding: 24rpx 32rpx 60rpx; display: flex; flex-direction: column; gap: 24rpx; }

.tip { display: flex; flex-direction: column; align-items: center; gap: 16rpx; padding: 200rpx 40rpx; }
.tip-title { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }
.tip-desc { font-size: 24rpx; color: #999; }

.hero {
  background: linear-gradient(135deg, var(--fyt-primary, #e8336d) 0%, var(--fyt-primary-dark, #a31245) 100%);
  border-radius: 28rpx; padding: 36rpx 32rpx;
  display: flex; align-items: center; gap: 24rpx;
}
.hero-ico {
  width: 96rpx; height: 96rpx; border-radius: 50%;
  background: var(--fyt-secondary, #ffaa1d); display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.hero-emoji { font-size: 48rpx; }
.hero-txt { display: flex; flex-direction: column; gap: 8rpx; }
.hero-status { font-size: 36rpx; font-weight: 900; color: #fff; }
.hero-desc { font-size: 24rpx; color: rgba(255, 255, 255, 0.85); }

.card { background: #fff; border: 3rpx solid #f7c2d6; border-radius: 24rpx; padding: 28rpx; }
.card-title { font-size: 30rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }

.steps { display: flex; align-items: flex-start; margin-top: 32rpx; }
.step { display: flex; flex-direction: column; align-items: center; gap: 10rpx; width: 140rpx; }
.dot {
  width: 28rpx; height: 28rpx; border-radius: 50%; background: #f0d8e0;
  border: 6rpx solid #fff; box-shadow: 0 0 0 2rpx #f0d8e0;
}
.dot.on { background: var(--fyt-primary, #e8336d); box-shadow: 0 0 0 2rpx var(--fyt-primary, #e8336d); }
.dot.last { background: #fff; }
.dot.last.on { background: #fff; box-shadow: 0 0 0 6rpx var(--fyt-primary, #e8336d); }
.s-name { font-size: 24rpx; color: #999; }
.s-name.on { color: var(--fyt-primary-dark, #a31245); font-weight: 700; }
.s-time { font-size: 20rpx; color: #ccc; }
.s-time.on { color: var(--fyt-primary, #e8336d); }
.bar { flex: 1; height: 6rpx; border-radius: 999rpx; background: #f0d8e0; margin-top: 12rpx; }
.bar.on { background: var(--fyt-primary, #e8336d); }

.goods { display: flex; gap: 20rpx; }
.pic { width: 150rpx; height: 150rpx; border-radius: 16rpx; background: var(--fyt-bg, #fff6e9); flex-shrink: 0; }
.g-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12rpx; }
.g-title { font-size: 28rpx; font-weight: 700; color: #333; }
.g-plat { font-size: 22rpx; color: #999; }
.g-price-row { display: flex; align-items: center; gap: 16rpx; }
.g-price { font-size: 34rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }

.rb-head { display: flex; align-items: center; justify-content: space-between; }
.kv { display: flex; align-items: center; gap: 12rpx; padding: 14rpx 0; }
.k { width: 240rpx; font-size: 24rpx; color: #888; flex-shrink: 0; }
.k.hl { color: var(--fyt-primary-dark, #a31245); font-weight: 700; }
.v { flex: 1; font-size: 26rpx; color: #333; font-weight: 600; text-align: right; }
.v.money { color: var(--fyt-primary, #e8336d); font-weight: 900; font-size: 30rpx; }
.v.sn { font-size: 24rpx; }
.copy {
  font-size: 20rpx; font-weight: 700; color: var(--fyt-primary, #e8336d);
  border: 2rpx solid var(--fyt-primary, #e8336d); border-radius: 999rpx; padding: 2rpx 14rpx;
}
.rb-note {
  margin-top: 12rpx; background: var(--fyt-bg, #fff6e9); border-radius: 12rpx; padding: 16rpx 20rpx;
}
.rb-note-t { font-size: 22rpx; color: #a3690f; line-height: 1.6; }
.vc-row { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 0; }
.vc-code {
  flex: 1; font-size: 40rpx; font-weight: 900; letter-spacing: 4rpx; color: #2b2b2b;
  background: linear-gradient(160deg, #fff3d6, #ffe9b8);
  border: 2rpx solid var(--fyt-secondary, #ffaa1d); border-radius: 14rpx; padding: 20rpx 24rpx;
}
.vc-note { display: block; margin-top: 12rpx; font-size: 22rpx; color: #a3690f; line-height: 1.6; }
.show-qr-btn { margin-top: 24rpx; background: var(--fyt-primary, #e8336d); color: #ffffff; font-size: 28rpx; font-weight: Bold; border-radius: 40rpx; line-height: 80rpx; }
.cancel-tip { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); line-height: 36rpx; margin-bottom: 20rpx; }
.cancel-btn {
  background: #fff; color: var(--fyt-primary, #e8336d);
  border: 3rpx solid var(--fyt-primary, #e8336d);
  font-size: 28rpx; font-weight: 800; border-radius: 40rpx; line-height: 76rpx;
}
</style>
