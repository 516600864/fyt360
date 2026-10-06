<template>
  <view class="f-seckill">
    <view class="sk-head">
      <text class="sk-title">{{ title }}</text>
      <view v-if="deadline" class="sk-cd">
        <text class="sk-cd-label">{{ started ? '距结束' : '距开始' }}</text>
        <text class="sk-cd-time">{{ cdText }}</text>
      </view>
      <text v-if="more_text" class="sk-more">{{ more_text }}</text>
    </view>
    <view class="sk-grid">
      <view v-for="(it, i) in items" :key="i" class="sk-card" @click="onTap(it)">
        <image class="sk-pic" :src="it.pic" mode="aspectFill" />
        <view class="sk-body">
          <text class="sk-name">{{ it.title }}</text>
          <view class="sk-price-row">
            <text class="sk-price">¥{{ it.price }}</text>
            <text v-if="it.origin_price" class="sk-origin">¥{{ it.origin_price }}</text>
          </view>
          <view class="sk-btn"><text class="sk-btn-t">抢</text></view>
        </view>
      </view>
    </view>
    <view v-if="!items.length" class="sk-empty"><text>秒杀商品配置中</text></view>
  </view>
</template>

<script>
/**
 * f-seckill 秒杀楼层（画布 06 组件库·营销卡）：标题 + 倒计时 + 秒杀商品卡。
 * 数据 = 运营在装修器配置（items 数组），无独立秒杀场次数据面（诚实口径，非后端驱动）。
 * 点击：item.action（Action 协议）优先；否则 item.platform+goods_id → goods-tap 上抛宿主转链/商详。
 * props：title/more_text/deadline(ISO，未来时间=距开始，已开始=距结束)/items[{title,pic,price,origin_price,platform,goods_id,action}]
 */
export default {
  name: 'FSeckill',
  props: {
    title: { type: String, default: '限时秒杀' },
    more_text: { type: String, default: '更多 >' },
    deadline: { type: String, default: '' },
    items: { type: Array, default: () => [] },
  },
  data() {
    return { now: Date.now(), timer: null };
  },
  computed: {
    targetTs() {
      const t = new Date(this.deadline.replace(/-/g, '/')).getTime();
      return Number.isFinite(t) ? t : 0;
    },
    started() {
      return !this.targetTs || this.now >= this.targetTs;
    },
    cdText() {
      if (!this.targetTs) return '即将开抢';
      let diff = Math.max(0, Math.floor((this.targetTs - this.now) / 1000));
      const d = Math.floor(diff / 86400); diff -= d * 86400;
      const h = Math.floor(diff / 3600); diff -= h * 3600;
      const m = Math.floor(diff / 60);
      const s = diff - m * 60;
      const pad = (n) => String(n).padStart(2, '0');
      return d > 0 ? `${d}天${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
    },
  },
  mounted() {
    this.timer = setInterval(() => { this.now = Date.now(); }, 1000);
  },
  beforeDestroy() { clearInterval(this.timer); },
  // #ifdef VUE3
  unmounted() { clearInterval(this.timer); },
  // #endif
  methods: {
    onTap(it) {
      if (it.action && it.action.type && it.action.type !== 'none') {
        this.$emit('action', it.action);
        return;
      }
      if (it.goods_id && it.platform) {
        this.$emit('goods-tap', {
          item: { id: String(it.goods_id), title: it.title, price: it.origin_price ?? it.price, finalPrice: it.price, coupon: null, pic: it.pic, sales: null, shop: '', raw: {} },
          platform: it.platform,
        });
        return;
      }
      uni.showToast({ title: '商品未配置跳转', icon: 'none' });
    },
  },
};
</script>

<style scoped>
.f-seckill {
  background: var(--fyt-surface); border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg); padding: var(--fyt-space-3); box-shadow: var(--fyt-shadow-pop);
}
.sk-head { display: flex; align-items: center; gap: 14rpx; }
.sk-title { font-size: 30rpx; font-weight: 900; color: var(--fyt-primary); }
.sk-cd { display: flex; align-items: center; gap: 8rpx; }
.sk-cd-label { font-size: 20rpx; color: var(--fyt-text-3); }
.sk-cd-time {
  font-size: 22rpx; font-weight: 900; color: var(--fyt-surface);
  background: var(--fyt-primary); border-radius: 6rpx; padding: 2rpx 10rpx;
}
.sk-more { margin-left: auto; font-size: 22rpx; color: var(--fyt-text-3); }
.sk-grid { display: flex; gap: 14rpx; margin-top: var(--fyt-space-2); flex-wrap: wrap; }
.sk-card {
  width: calc(33.33% - 10rpx); box-sizing: border-box;
  background: var(--fyt-surface); border: var(--fyt-border-thick) solid var(--fyt-border-default);
  border-radius: var(--fyt-radius-md); overflow: hidden;
}
.sk-pic { width: 100%; height: 180rpx; background: var(--fyt-surface-alt); display: block; }
.sk-body { padding: 10rpx; display: flex; flex-direction: column; gap: 6rpx; }
.sk-name {
  font-size: 22rpx; color: var(--fyt-text); font-weight: 700;
  display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden;
}
.sk-price-row { display: flex; align-items: baseline; gap: 8rpx; }
.sk-price { font-size: 28rpx; font-weight: 900; color: var(--fyt-primary); }
.sk-origin { font-size: 18rpx; color: var(--fyt-text-3); text-decoration: line-through; }
.sk-btn {
  background: var(--fyt-primary); border-radius: var(--fyt-radius-full);
  text-align: center; padding: 4rpx 0; margin-top: 2rpx;
}
.sk-btn-t { font-size: 20rpx; font-weight: 900; color: var(--fyt-on-primary); }
.sk-empty {
  margin-top: var(--fyt-space-2); border: var(--fyt-border-thick) dashed var(--fyt-border-default);
  border-radius: var(--fyt-radius-md); padding: var(--fyt-space-5); text-align: center;
  color: var(--fyt-text-3); font-size: 24rpx;
}
</style>
