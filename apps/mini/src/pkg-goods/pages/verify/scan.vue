<template>
  <view class="scan-page" :style="pageTheme">
    <!-- 查券中 / 查不到 -->
    <view v-if="loading" class="tip"><text>查券中…</text></view>
    <view v-else-if="!c" class="tip">
      <text class="tip-emoji">📷</text>
      <text class="tip-title">未识别到有效券码</text>
      <text class="tip-desc">{{ errMsg || '请扫描用户核销码，或手动输入券码' }}</text>
      <view class="manual">
        <input class="m-input" v-model="manualCode" placeholder="手动输入券码，如 GC48912" />
        <button class="m-btn" @tap="lookupCode">查询</button>
      </view>
      <button class="rescan" @tap="rescan">重新扫码</button>
    </view>

    <!-- 券信息 + 确认核销 -->
    <template v-else>
      <view class="c-card">
        <image v-if="c.pic" class="c-pic" :src="c.pic" mode="aspectFill" />
        <view class="c-main">
          <text class="c-title">{{ c.goods_title }}<template v-if="c.spec"> · {{ c.spec }}</template></text>
          <text class="c-code">券码 {{ c.code }}</text>
          <text class="c-sub">实付 ¥{{ c.pay_price }} · 有效期至 {{ fmtDate(c.expire_at) }}</text>
        </view>
      </view>

      <view class="kv-card">
        <view class="kv"><text class="k">核销状态</text><text class="v">{{ statusText }}</text></view>
        <view class="kv"><text class="k">剩余次数</text><text class="v">{{ c.remain_times }}/{{ c.total_times }}</text></view>
        <view class="kv"><text class="k">订单编号</text><text class="v mono">{{ c.order_sn }}</text></view>
      </view>

      <template v-if="!done">
        <button v-if="c.verifiable" class="do-btn" :disabled="busy" @tap="onConfirm">
          {{ busy ? '核销中…' : '确认核销 1 次' }}
        </button>
        <view v-else class="no-card"><text class="no-t">该券当前不可核销（{{ statusText }}）</text></view>
        <!-- 退款入口：未核销的券可由核销员发起全额退款（核销员有退款权限） -->
        <button
          v-if="c.verifiable && Number(c.used_times) === 0 && !refunded"
          class="refund-btn" :disabled="busy || refunding" @tap="onRefund"
        >{{ refunding ? '退款中…' : '发起退款' }}</button>
        <button class="rescan" @tap="rescan">扫下一单</button>
      </template>

      <!-- 退款结果 -->
      <view v-if="refunded && !done" class="refund-card">
        <text class="refund-emoji">↩️</text>
        <text class="refund-t">退款已发起（¥{{ c.pay_price }}）</text>
        <text class="refund-d">原路退回，1-3 个工作日到账；券已作废</text>
        <button class="rescan" @tap="rescan">扫下一单</button>
      </view>

      <!-- 核销结果 -->
      <view v-else class="done-card">
        <text class="done-emoji">✅</text>
        <text class="done-t">核销成功（第 {{ c.used_times }}/{{ c.total_times }} 次）</text>
        <text class="done-d">{{ c.status === 'used' ? '该券次数已用完' : '用户剩余可核销 ' + c.remain_times + ' 次' }}</text>
        <button class="rescan" @tap="rescan">扫下一单</button>
      </view>
    </template>
  </view>
</template>

<script>
/**
 * 核销员扫码核销页（M9.6）：uni.scanCode 扫用户 mini-20 二维码 → lookup 查券 → confirm 原子核销。
 * 入口：我的页「扫码核销」宫格（仅核销员可见）→ 扫码成功带 ?code=；扫码失败在本页手动输码兜底。
 */
import { request } from '@/utils/request';
import { themeTokens } from '@/core/theme';

export default {
  data() {
    return { code: '', c: null, loading: true, errMsg: '', manualCode: '', busy: false, done: false, refunding: false, refunded: false };
  },
  computed: {
    statusText() {
      const s = this.c?.status;
      return { unused: '未使用', partial: '部分核销', used: '已核销', expired: '已过期' }[s] ?? '未使用';
    },
  },
  onLoad(q) {
    const code = String(q.code ?? '').trim();
    if (code) this.lookupCode(code);
    else this.loading = false;
  },
  methods: {
    async lookupCode(code) {
      const c = String(code ?? this.manualCode ?? '').trim().toUpperCase();
      if (!c) {
        uni.showToast({ title: '请输入券码', icon: 'none' });
        return;
      }
      this.loading = true;
      this.done = false;
      this.refunded = false;
      this.errMsg = '';
      try {
        this.c = await request(`/api/me/verify/lookup?code=${encodeURIComponent(c)}`);
        this.code = c;
      } catch (e) {
        this.c = null;
        this.errMsg = e.message ?? '券不存在';
      } finally {
        this.loading = false;
      }
    },
    async onConfirm() {
      if (this.busy) return;
      this.busy = true;
      try {
        this.c = { ...this.c, ...(await request('/api/me/verify/confirm', { method: 'POST', data: { code: this.code } })) };
        this.done = true;
      } catch (e) {
        uni.showToast({ title: e.message ?? '核销失败', icon: 'none', duration: 2500 });
        // 状态可能已被他人核销 → 刷新
        this.lookupCode(this.code);
      } finally {
        this.busy = false;
      }
    },
    async onRefund() {
      if (this.refunding || this.busy) return;
      uni.showModal({
        title: '确认退款',
        content: `将为订单 ${this.c.order_sn} 全额退款 ¥${this.c.pay_price}，券作废且不可恢复。确认？`,
        confirmColor: themeTokens().primary || '#e8336d',
        success: async (r) => {
          if (!r.confirm) return;
          this.refunding = true;
          try {
            await request('/api/me/verify/refund', { method: 'POST', data: { code: this.code } });
            this.refunded = true;
          } catch (e) {
            uni.showToast({ title: e.message ?? '退款失败', icon: 'none', duration: 2500 });
          } finally {
            this.refunding = false;
          }
        },
      });
    },
    rescan() {
      uni.scanCode({
        onlyFromCamera: false,
        scanType: ['qrCode'],
        success: (r) => {
          const code = String(r.result ?? '').trim().toUpperCase();
          uni.redirectTo({ url: `/pkg-goods/pages/verify/scan?code=${encodeURIComponent(code)}` });
        },
        fail: () => uni.showToast({ title: '已取消扫码', icon: 'none' }),
      });
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

.scan-page { min-height: 100vh; background: $fyt-surface; padding: 24rpx 32rpx 60rpx; }
.tip { padding: 100rpx 0; display: flex; flex-direction: column; align-items: center; color: #b3a89a; font-size: 26rpx; }
.tip-emoji { font-size: 72rpx; margin-bottom: 16rpx; }
.tip-title { font-size: 34rpx; font-weight: Bold; color: #5c3a4a; margin-bottom: 8rpx; }
.tip-desc { margin-bottom: 40rpx; }

.manual { display: flex; gap: 16rpx; width: 100%; padding: 0 20rpx; }
.m-input { flex: 1; background: #ffffff; border: 2rpx solid #e8d9c5; border-radius: 16rpx; padding: 18rpx 24rpx; font-size: 28rpx; color: #1a1a1a; }
.m-btn { background: $fyt-primary; color: #ffffff; font-size: 28rpx; font-weight: Bold; border-radius: 16rpx; padding: 0 36rpx; line-height: 84rpx; }

.c-card { background: #ffffff; border-radius: 20rpx; padding: 28rpx; display: flex; gap: 24rpx; align-items: center; }
.c-pic { width: 128rpx; height: 128rpx; border-radius: 16rpx; background: #f5ede2; flex-shrink: 0; }
.c-main { display: flex; flex-direction: column; gap: 8rpx; min-width: 0; }
.c-title { font-size: 30rpx; font-weight: Bold; color: #1a1a1a; }
.c-code { font-size: 26rpx; color: $fyt-primary; font-weight: Bold; }
.c-sub { font-size: 24rpx; color: #b3a89a; }

.kv-card { background: #ffffff; border-radius: 20rpx; padding: 12rpx 28rpx; margin-top: 24rpx; }
.kv { display: flex; justify-content: space-between; align-items: center; padding: 20rpx 0; border-bottom: 2rpx solid #f5ede2; }
.kv:last-child { border-bottom: none; }
.k { font-size: 26rpx; color: #8a7a6b; }
.v { font-size: 26rpx; font-weight: Bold; color: #1a1a1a; }
.mono { font-family: Consolas, monospace; }

.do-btn { margin-top: 40rpx; background: $fyt-primary; color: #ffffff; font-size: 32rpx; font-weight: Bold; border-radius: 44rpx; line-height: 96rpx; }
.refund-btn { margin-top: 24rpx; background: #ffffff; color: var(--fyt-primary-dark, #a31245); font-size: 28rpx; font-weight: Bold; border: 2rpx solid #e8b9cd; border-radius: 44rpx; line-height: 84rpx; }
.refund-card { margin-top: 40rpx; background: var(--fyt-bg, #fff6e9); border-radius: 24rpx; padding: 48rpx 32rpx; display: flex; flex-direction: column; align-items: center; gap: 12rpx; }
.refund-emoji { font-size: 80rpx; }
.refund-t { font-size: 34rpx; font-weight: Bold; color: var(--fyt-primary-dark, #a31245); }
.refund-d { font-size: 24rpx; color: #8a6b75; }
.no-card { margin-top: 40rpx; background: #fde3ec; border-radius: 20rpx; padding: 32rpx; text-align: center; }
.no-t { color: $fyt-primary; font-size: 28rpx; font-weight: Bold; }
.done-card { margin-top: 40rpx; background: #e8f7ef; border-radius: 24rpx; padding: 48rpx 32rpx; display: flex; flex-direction: column; align-items: center; gap: 12rpx; }
.done-emoji { font-size: 80rpx; }
.done-t { font-size: 34rpx; font-weight: Bold; color: #1f9d61; }
.done-d { font-size: 24rpx; color: #8a6b75; }

.rescan { margin-top: 32rpx; background: #ffffff; color: #5c3a4a; font-size: 28rpx; font-weight: Bold; border: 2rpx solid #e8d9c5; border-radius: 44rpx; line-height: 88rpx; }
</style>
