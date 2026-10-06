<template>
  <view class="f-groupbuy">
    <view class="gb-head">
      <text class="gb-title">{{ title }}</text>
      <text class="gb-sub">{{ subtitle }}</text>
    </view>
    <view class="gb-grid">
      <view v-for="(it, i) in items" :key="i" class="gb-card" @click="onTap(it)">
        <image class="gb-pic" :src="it.pic" mode="aspectFill" />
        <view class="gb-body">
          <text class="gb-name">{{ it.title }}</text>
          <view class="gb-price-row">
            <text class="gb-price"><text class="gb-y">¥</text>{{ it.group_price }}</text>
            <text v-if="it.price" class="gb-origin">¥{{ it.price }}</text>
          </view>
          <view class="gb-meta-row">
            <text class="gb-joined">{{ it.joined ?? '全新上线' }}</text>
            <view class="gb-btn"><text class="gb-btn-t">去拼团</text></view>
          </view>
        </view>
      </view>
    </view>
    <view v-if="!items.length" class="gb-empty"><text>拼团商品配置中</text></view>
  </view>
</template>

<script>
/**
 * f-group-buy-floor 拼团楼层（画布 06 组件库·营销卡）：标题 + 拼团商品卡（拼团价/已拼件数/去拼团）。
 * 数据 = 运营在装修器配置（items 数组）；团购交易数据面未建 → 点击走 Action 协议（jump/plugin-launch），
 * 不虚构下单链路（诚实口径）。
 * props：title/subtitle/items[{title,pic,price,group_price,joined,action}]
 */
export default {
  name: 'FGroupBuyFloor',
  props: {
    title: { type: String, default: '超值拼团' },
    subtitle: { type: String, default: '好物拼着买 · 到店核销' },
    items: { type: Array, default: () => [] },
  },
  methods: {
    onTap(it) {
      if (it.action && it.action.type && it.action.type !== 'none') {
        this.$emit('action', it.action);
        return;
      }
      uni.showToast({ title: '拼团活动配置中', icon: 'none' });
    },
  },
};
</script>

<style scoped>
.f-groupbuy {
  background: var(--fyt-surface); border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg); padding: var(--fyt-space-3); box-shadow: var(--fyt-shadow-pop);
}
.gb-head { display: flex; align-items: baseline; gap: 14rpx; }
.gb-title { font-size: 30rpx; font-weight: 900; color: var(--fyt-text); }
.gb-sub { font-size: 20rpx; color: var(--fyt-text-3); }
.gb-grid { display: flex; gap: 14rpx; margin-top: var(--fyt-space-2); flex-wrap: wrap; }
.gb-card {
  width: calc(50% - 7rpx); box-sizing: border-box;
  background: var(--fyt-surface); border: var(--fyt-border-thick) solid var(--fyt-border-default);
  border-radius: var(--fyt-radius-md); overflow: hidden;
}
.gb-pic { width: 100%; height: 220rpx; background: var(--fyt-surface-alt); display: block; }
.gb-body { padding: 12rpx; display: flex; flex-direction: column; gap: 8rpx; }
.gb-name {
  font-size: 24rpx; color: var(--fyt-text); font-weight: 700;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.gb-price-row { display: flex; align-items: baseline; gap: 8rpx; }
.gb-price { font-size: 30rpx; font-weight: 900; color: var(--fyt-primary); }
.gb-y { font-size: 20rpx; }
.gb-origin { font-size: 20rpx; color: var(--fyt-text-3); text-decoration: line-through; }
.gb-meta-row { display: flex; align-items: center; justify-content: space-between; }
.gb-joined { font-size: 20rpx; color: var(--fyt-text-3); }
.gb-btn {
  background: var(--fyt-secondary); border-radius: var(--fyt-radius-full); padding: 4rpx 18rpx;
}
.gb-btn-t { font-size: 20rpx; font-weight: 900; color: #fff; }
.gb-empty {
  margin-top: var(--fyt-space-2); border: var(--fyt-border-thick) dashed var(--fyt-border-default);
  border-radius: var(--fyt-radius-md); padding: var(--fyt-space-5); text-align: center;
  color: var(--fyt-text-3); font-size: 24rpx;
}
</style>
