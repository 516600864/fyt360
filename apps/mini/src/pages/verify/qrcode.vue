<template>
  <view class="qr-page" :style="pageTheme">
    <view v-if="loading" class="tip"><text>加载中…</text></view>
    <view v-else-if="!c" class="tip"><text class="tip-title">券不存在</text></view>
    <template v-else>
      <!-- 二维码主卡（画布 mini-20：白卡玫红描边 + 大二维码 + 券码 + 亮度提示） -->
      <view class="qr-card">
        <view class="qr-box">
          <QrCode :text="c.code" :size="228" />
        </view>
        <view class="code-row">
          <text class="code-t">{{ c.code }}</text>
          <text class="code-copy" @tap="copyCode">复制</text>
        </view>
        <text class="qr-hint">请将屏幕亮度调至最高 · 店员扫码即完成核销</text>
      </view>

      <!-- 状态条（部分核销/已核销/过期如实展示） -->
      <view class="st-strip" :class="'st-' + c.status">
        <text class="st-t">{{ statusText }}</text>
        <text class="st-d">{{ remainText }}</text>
      </view>

      <!-- 商品信息卡 -->
      <view class="goods-card">
        <text class="g-title">{{ c.goods_title }}<template v-if="c.spec"> · {{ c.spec }}</template></text>
        <text class="g-sub">有效期至 {{ fmtDate(c.expire_at) }} · 本单门店通用</text>
      </view>

      <!-- 核销说明 -->
      <view class="note-card">
        <text class="n-title">核销说明</text>
        <text class="n-t">到店出示此码，店员扫码即完成核销；核销前请勿泄露券码，核销后不可退。</text>
      </view>
    </template>
  </view>
</template>

<script>
/**
 * 核销码展示页（画布 mini-20，M9.6）：到店核销单的二维码出示页。
 * 入口：订单详情/支付结果页核销卡「出示核销码」→ ?order_id=。
 * 二维码内容 = 券码原文（核销员扫码 → /api/me/verify/lookup 按 code 精确匹配）。
 */
import { request } from '../../utils/request';
import { copyText } from '../../utils/clip';
import QrCode from '../../components/QrCode.vue';

const STATUS = { unused: '未使用', partial: '部分核销', used: '已核销', expired: '已过期' };

export default {
  components: { QrCode },
  data() {
    return { orderId: 0, c: null, loading: true };
  },
  computed: {
    statusText() {
      return STATUS[this.c?.status] ?? '未使用';
    },
    remainText() {
      if (!this.c) return '';
      if (this.c.status === 'used') return `已核销 ${this.c.used_times ?? 0}/${this.c.total_times ?? 1} 次`;
      if (this.c.status === 'expired') return '券已过期，请联系商家';
      return `剩余可核销 ${Math.max(0, (this.c.total_times ?? 1) - (this.c.used_times ?? 0))} 次`;
    },
  },
  onLoad(q) {
    this.orderId = Number(q.order_id ?? 0);
    this.load();
  },
  methods: {
    async load() {
      try {
        const d = await request(`/api/me/orders/${this.orderId}`);
        const vc = d.verify_coupon;
        if (!vc) {
          uni.showToast({ title: '该订单无核销券', icon: 'none' });
          setTimeout(() => uni.navigateBack({ fail: () => {} }), 1200);
          return;
        }
        this.c = { ...vc, goods_title: d.title ?? '', spec: d.sku_snapshot?.spec ?? '' };
      } catch (e) {
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      } finally {
        this.loading = false;
      }
    },
    copyCode() {
      copyText(this.c?.code, '券码已复制');
    },
    fmtDate(s) {
      if (!s) return '长期有效';
      const d = new Date(s);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.qr-page { min-height: 100vh; background: $fyt-surface; padding: 24rpx 32rpx 60rpx; }
.tip { padding: 120rpx 0; text-align: center; color: #b3a89a; font-size: 28rpx; }
.tip-title { font-size: 34rpx; font-weight: Bold; color: #5c3a4a; display: block; margin-bottom: 12rpx; }

.qr-card {
  background: #ffffff; border: 4rpx solid $fyt-primary; border-radius: 32rpx;
  padding: 48rpx 40rpx 40rpx; display: flex; flex-direction: column; align-items: center;
}
.qr-box { padding: 16rpx; }
.code-row { display: flex; align-items: center; gap: 16rpx; margin-top: 28rpx; }
.code-t { font-size: 44rpx; font-weight: Bold; color: #1a1a1a; letter-spacing: 2rpx; }
.code-copy { font-size: 26rpx; font-weight: Bold; color: $fyt-primary; }
.qr-hint { margin-top: 20rpx; font-size: 24rpx; color: #b3a89a; }

.st-strip { display: flex; align-items: center; justify-content: space-between; margin-top: 24rpx; padding: 24rpx 32rpx; border-radius: 20rpx; }
.st-unused, .st-partial { background: #fde3ec; .st-t { color: $fyt-primary; } .st-d { color: #a3690f; } }
.st-used { background: #e8f7ef; .st-t { color: #1f9d61; } }
.st-expired { background: #f0ebe4; .st-t { color: #8a6b75; } }
.st-t { font-size: 30rpx; font-weight: Bold; }
.st-d { font-size: 24rpx; }

.goods-card { background: #ffffff; border-radius: 20rpx; padding: 32rpx; margin-top: 24rpx; display: flex; flex-direction: column; gap: 12rpx; }
.g-title { font-size: 30rpx; font-weight: Bold; color: #1a1a1a; }
.g-sub { font-size: 24rpx; color: #b3a89a; }

.note-card { background: #fde3ec; border-radius: 20rpx; padding: 28rpx 32rpx; margin-top: 24rpx; display: flex; flex-direction: column; gap: 10rpx; }
.n-title { font-size: 28rpx; font-weight: Bold; color: $fyt-primary; }
.n-t { font-size: 24rpx; color: var(--fyt-primary-dark, #a31245); line-height: 1.6; }
</style>
