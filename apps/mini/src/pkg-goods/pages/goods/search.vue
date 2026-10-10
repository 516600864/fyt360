<template>
  <view class="search-page" :style="pageTheme">
    <!-- 平台 tabs（画布 07：粉底白字 + 选中鎏金下划线） -->
    <view class="plat-row">
      <text
        v-for="p in plats"
        :key="p.key"
        class="plat"
        :class="{ on: platform === p.key }"
        @tap="switchPlat(p.key)"
      >{{ p.name }}</text>
    </view>

    <!-- 三步引导 + 粘贴框 + 搜索按钮 -->
    <view class="guide-card">
      <view class="steps-row">
        <text class="st-num">1</text><text class="st-txt">复制商品链接</text>
        <text class="st-arrow">→</text>
        <text class="st-num on">2</text><text class="st-txt">粘贴至输入框</text>
        <text class="st-arrow">→</text>
        <text class="st-num on">3</text><text class="st-txt">找券享优惠</text>
      </view>
      <view class="input-box">
        <textarea
          v-model="input"
          class="paste-area"
          :maxlength="500"
          placeholder="粘贴商品链接或文案，如「沃隆每日坚果礼盒 750g」"
          placeholder-class="paste-ph"
        />
        <view v-if="input" class="clear-row" @tap="input = ''">
          <text class="clear-t">🗑 清空搜索</text>
        </view>
      </view>
      <view class="go-btn" @tap="doSearch">
        <text class="go-t">🔒 找券享优惠</text>
      </view>
    </view>

    <!-- 历史搜索 -->
    <view v-if="history.length" class="sec">
      <view class="sec-head">
        <text class="sec-title">历史搜索</text>
        <text class="sec-clear" @tap="clearHistory">🗑</text>
      </view>
      <view class="tags">
        <text v-for="h in history" :key="h" class="tag" @tap="quickSearch(h)">{{ h }}</text>
      </view>
    </view>

    <!-- 找券结果（同页直出：当前平台 goodslist 实时透传） -->
    <view v-if="searched" class="sec">
      <view class="sec-head">
        <text class="sec-title">找券结果</text>
        <text class="sec-sub">{{ platName }} · {{ results.length }} 个结果</text>
      </view>
      <view v-if="searching" class="empty-card"><text class="empty-t loading-t">🦊 福袋兽搬金币中…</text></view>
      <view v-else-if="!results.length" class="empty-card"><text class="empty-t">没找到相关券，换个词试试</text></view>
      <view v-else class="r-grid">
        <view v-for="g in results" :key="g.platform + g.id" class="r-card" @tap="tapGoods(g)">
          <image class="r-pic" :src="g.pic" mode="aspectFill" lazy-load />
          <text class="r-name">{{ g.title }}</text>
          <view class="r-price-row">
            <text class="r-price">¥{{ g.finalPrice ?? g.price }}</text>
            <text v-if="g.coupon > 0" class="r-coupon">¥{{ g.coupon }} 券</text>
          </view>
          <text v-if="g.sales" class="r-sales">已售 {{ g.sales }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
/**
 * 搜索找券·入口页（画布 mini-07 对齐）。
 * 业务口径（D先生 定稿 2026-09-29）：「找券」= 当前 tab 平台 goodslist 直查，粘贴原文整段透传作 keyword，结果同页直出；
 * 切平台 tab 自动重查。历史搜索存本地 storage；热搜榜已移除（D先生 2026-10-10）。
 */
import { request } from '@/utils/request';
import { onGoodsTap } from '@/core/link';

const HIST_KEY = 'fyt_search_hist';
const HIST_MAX = 10;

export default {
  data() {
    return {
      input: '',
      platform: 'jd',
      history: [],
      plats: [
        { key: 'pdd', name: '拼多多' },
        { key: 'jd', name: '京东' },
        { key: 'vip', name: '唯品会' },
        { key: 'tb', name: '淘宝' },
      ],
      searching: false,
      searched: false,
      lastKw: '',
      results: [],
    };
  },
  onLoad() {
    try {
      this.history = JSON.parse(uni.getStorageSync(HIST_KEY) || '[]');
    } catch (e) {
      this.history = [];
    }
  },
  computed: {
    platName() {
      const p = this.plats.find((x) => x.key === this.platform);
      return p ? p.name : '';
    },
  },
  methods: {
    saveHistory(kw) {
      const next = [kw, ...this.history.filter((x) => x !== kw)].slice(0, HIST_MAX);
      this.history = next;
      try {
        uni.setStorageSync(HIST_KEY, JSON.stringify(next));
      } catch (e) { /* 存储失败不阻塞 */ }
    },
    clearHistory() {
      this.history = [];
      try {
        uni.removeStorageSync(HIST_KEY);
      } catch (e) { /* ignore */ }
    },
    doSearch() {
      // D先生 定稿：找券=当前 tab 平台 goodslist 直查，粘贴原文整段透传（上游支持含链接文案），结果同页直出
      const kw = String(this.input ?? '').trim();
      if (!kw) {
        uni.showToast({ title: '先粘贴商品链接或文案', icon: 'none' });
        return;
      }
      this.saveHistory(kw.slice(0, 30));
      this.search(kw);
    },
    /** 历史词快捷搜（历史存的是整段粘贴原文，直接透传） */
    quickSearch(w) {
      const kw = String(w ?? '').trim();
      if (!kw) return;
      this.input = kw;
      this.search(kw);
    },
    switchPlat(k) {
      if (this.platform === k) return;
      this.platform = k;
      // 已有搜索词 → 切平台立即重查（当前 tab 接口直调）
      if (this.lastKw) this.search(this.lastKw);
    },
    async search(kw) {
      if (this.searching) return;
      this.lastKw = kw;
      this.searching = true;
      this.searched = true;
      try {
        const d = await request(`/api/goods/${this.platform}/list?page=1&size=10&keyword=${encodeURIComponent(kw)}`);
        this.results = (d?.items ?? []).map((g) => ({ ...g, platform: this.platform }));
      } catch (e) {
        this.results = [];
        uni.showToast({ title: e.message ?? '搜索失败', icon: 'none' });
      }
      this.searching = false;
    },
    tapGoods(g) {
      onGoodsTap({ ...g, platform: g.platform });
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.search-page { min-height: 100vh; background: $fyt-surface; padding-bottom: 60rpx; }

/* 平台 tabs：粉底白字 + 鎏金下划线（画布 07） */
.plat-row { display: flex; background: var(--fyt-primary, #e8336d); padding: 0 12rpx; }
.plat {
  flex: 1; text-align: center; font-size: 30rpx; color: rgba(255, 255, 255, 0.78);
  font-weight: 700; padding: 22rpx 0; position: relative;
}
.plat.on { color: #fff; font-weight: 900; }
.plat.on::after {
  content: ''; position: absolute; left: 50%; transform: translateX(-50%); bottom: 10rpx;
  width: 44rpx; height: 6rpx; border-radius: 999rpx; background: var(--fyt-secondary, #ffaa1d);
}

.guide-card { margin: 28rpx 32rpx 0; background: #fff; border: 3rpx solid var(--fyt-primary, #e8336d); border-radius: 28rpx; padding: 28rpx; }
.steps-row { display: flex; align-items: center; gap: 10rpx; flex-wrap: wrap; }
.st-num {
  width: 36rpx; height: 36rpx; border-radius: 50%; background: #ffe3ec; color: var(--fyt-primary, #e8336d);
  font-size: 22rpx; font-weight: 900; display: flex; align-items: center; justify-content: center;
}
.st-num.on { background: var(--fyt-primary, #e8336d); color: #fff; }
.st-txt { font-size: 24rpx; color: var(--fyt-primary-dark, #a31245); font-weight: 600; }
.st-arrow { color: var(--fyt-secondary, #ffaa1d); font-weight: 900; }

.input-box {
  margin-top: 24rpx; background: var(--fyt-bg, #fff6e9); border: 2rpx solid var(--fyt-primary, #e8336d); border-radius: 16rpx; padding: 20rpx;
}
.paste-area { width: 100%; height: 140rpx; font-size: 26rpx; color: #3d2530; line-height: 1.6; }
.paste-ph { color: #c9a7b3; }
.clear-row { display: flex; justify-content: flex-end; margin-top: 8rpx; }
.clear-t { font-size: 22rpx; color: var(--fyt-primary, #e8336d); font-weight: 700; }

.go-btn {
  margin-top: 24rpx; background: var(--fyt-primary, #e8336d); border-radius: 999rpx; padding: 22rpx 0;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6rpx 0 0 var(--fyt-primary-dark, #a31245);
}
.go-t { font-size: 30rpx; font-weight: 900; color: #fff; }

.sec { margin: 32rpx 32rpx 0; display: flex; flex-direction: column; gap: 18rpx; }
.sec-head { display: flex; align-items: center; justify-content: space-between; }
.sec-title { font-size: 28rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }
.sec-clear { font-size: 28rpx; }
.tags { display: flex; flex-wrap: wrap; gap: 16rpx; }
.tag {
  background: #fff; border: 2rpx solid #e8d9c5; border-radius: 999rpx;
  padding: 12rpx 30rpx; font-size: 24rpx; color: #6b5a4e; font-weight: 600;
}


/* 找券结果（同页直出） */
.empty-card { background: #fff; border: 2rpx dashed #f0d9c5; border-radius: 20rpx; padding: 48rpx 0; text-align: center; }
.empty-t { font-size: 26rpx; color: #b3a89a; }
.loading-t { color: var(--fyt-primary, #e8336d); font-weight: 800; animation: t-blink 1.1s ease-in-out infinite; }
@keyframes t-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
.r-grid { display: flex; flex-wrap: wrap; gap: 20rpx; }
.r-card {
  width: calc((100% - 20rpx) / 2); background: #fff; border: 2rpx solid #f0e3d0;
  border-radius: 20rpx; padding: 16rpx; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 10rpx;
}
.r-pic { width: 100%; height: 320rpx; border-radius: 14rpx; background: #faf6f0; }
.r-name { font-size: 26rpx; color: #333; font-weight: 600; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.r-price-row { display: flex; align-items: baseline; gap: 12rpx; }
.r-price { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.r-coupon { font-size: 20rpx; font-weight: 800; color: var(--fyt-primary-dark, #a31245); background: #ffe3ee; border-radius: 6rpx; padding: 2rpx 10rpx; }
.r-sales { font-size: 20rpx; color: #b3a89a; }
</style>
