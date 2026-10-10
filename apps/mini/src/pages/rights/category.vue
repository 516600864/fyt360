<template>
  <view class="cat-page" :style="pageTheme">
    <!-- 玫红渐变头 + 搜索框（画布 13） -->
    <view class="hero">
      <view class="hero-title-row">
        <text v-if="!embedded" class="hero-back" @click="goBack">‹</text>
        <text class="hero-title">生活服务</text>
      </view>
      <view class="search-bar" @click="goSearch">
        <text class="sb-icon">🔍</text>
        <text class="sb-placeholder">输入品牌或权益名称搜索</text>
      </view>
    </view>

    <view class="body" v-if="!loading">
      <!-- 左侧锚点导航 -->
      <scroll-view scroll-y class="anchor-col">
        <view
          v-for="(g, idx) in groups"
          :key="g.key"
          class="anchor-item"
          :class="{ active: current === idx }"
          @click="scrollTo(idx)"
        >
          <text class="anchor-text">{{ g.name }}</text>
          <text class="anchor-count">{{ g.count }}</text>
        </view>
      </scroll-view>

      <!-- 右侧分类卡片流 -->
      <scroll-view scroll-y class="content-col" :scroll-into-view="intoId" scroll-with-animation>
        <view v-for="g in groups" :id="'sec-' + g.key" :key="g.key" class="sec-card">
          <view class="sec-head">
            <text class="sec-name">{{ g.name }}</text>
            <text class="sec-count">{{ g.count }} 项权益</text>
          </view>
          <view class="chip-flow">
            <view v-for="it in g.items" :key="it.brand_code" class="r-chip" @click="launch(it)">
              <text class="rc-name">{{ it.name }}</text>
            </view>
          </view>
        </view>
        <view class="foot-pad">
          <text class="footnote">点击品牌卡直达 · 点餐/出行半屏呼起 · 电商类复制链接后打开对应 App</text>
        </view>
      </scroll-view>
    </view>

    <view v-else class="empty"><text>权益加载中…</text></view>
  </view>
</template>

<script>
/**
 * 画布 13 生活服务分类页（28:192 v2 左锚点 + chips 流，M7；2026-09-30 D先生 定稿改版）：
 * 数据源 = /api/rights/brands（brand_action_cfg 落库配置，10 分类 148 品牌全量，比 fasttype 透传快）；
 * 左锚点 scroll-into-view 定位；chip 直点 → handleAction(plugin-launch) 三轨呼起
 * （act 实时转链 / halfscreen 半屏 / plugin 插件 / h5url 复制链接，分发复用 core/action.js）。
 */
import { request } from '../../utils/request';
import { handleAction } from '../../core/action';

export default {
  props: {
    /** 壳页内嵌模式：隐藏返回钮（tab 内无返回语义） */
    embedded: { type: Boolean, default: false },
  },
  data() {
    return { loading: true, groups: [], current: 0, intoId: '', _reqInFlight: false };
  },
  onLoad() {
    // 独立页场景触发（内嵌壳页时 onLoad 不执行，由 mounted 兜底；防双请求锁）
    this.load();
  },
  mounted() {
    if (!this._reqInFlight && !this.groups.length) this.load();
  },
  methods: {
    goBack() {
      uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/shell/s2' }) });
    },
    goSearch() {
      // 搜索入口统一 07B 全站搜索（D先生 规则 2026-09-30：系统内搜索默认入口均为 search-result）
      uni.navigateTo({ url: '/pkg-goods/pages/goods/search-result' });
    },
    async load() {
      if (this._reqInFlight) return;
      this._reqInFlight = true;
      this.loading = true;
      try {
        const d = await request('/api/rights/brands');
        this.groups = d.groups ?? [];
      } catch (e) {
        uni.showToast({ title: e.message ?? '权益加载失败', icon: 'none' });
      }
      this.loading = false;
      this._reqInFlight = false;
    },
    scrollTo(idx) {
      this.current = idx;
      this.intoId = '';
      this.$nextTick(() => {
        this.intoId = 'sec-' + this.groups[idx]?.key;
      });
    },
    /** 品牌直达呼起：brand-launch?code=<brand_code>，三轨分发复用统一 Action 协议 */
    launch(it) {
      handleAction({ type: 'plugin-launch', value: it.brand_code });
    },
  },
};
</script>

<style scoped>
.cat-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--fyt-bg, #fff6e9);
}
.hero {
  background: linear-gradient(160deg, #f0568b 0%, var(--fyt-primary, #e8336d) 55%, #c9225a 100%);
  padding: 24rpx 32rpx 28rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  flex-shrink: 0;
}
.hero-title-row { display: flex; align-items: center; gap: 16rpx; }
.hero-back {
  font-size: 52rpx;
  font-weight: 900;
  color: #ffffff;
  width: 56rpx;
  height: 56rpx;
  line-height: 52rpx;
  text-align: center;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 50%;
}
.hero-title { font-size: 40rpx; font-weight: 900; color: #ffffff; letter-spacing: 2rpx; }
.search-bar {
  background: #fffdf7;
  border-radius: 999rpx;
  padding: 16rpx 28rpx;
  display: flex;
  align-items: center;
  gap: 14rpx;
  border: 3rpx solid var(--fyt-secondary, #ffaa1d);
}
.sb-icon { font-size: 28rpx; }
.sb-placeholder { font-size: 26rpx; color: #b3a89a; }

.body { flex: 1; display: flex; min-height: 0; }
.anchor-col {
  width: 168rpx;
  flex-shrink: 0;
  background: #fdeef4;
  height: 100%;
}
.anchor-item {
  padding: 30rpx 16rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
  border-left: 6rpx solid transparent;
}
.anchor-item.active {
  background: var(--fyt-bg, #fff6e9);
  border-left-color: var(--fyt-primary, #e8336d);
}
.anchor-text { font-size: 24rpx; font-weight: 600; color: #6b5a4e; text-align: center; }
.anchor-item.active .anchor-text { color: var(--fyt-primary, #e8336d); font-weight: 900; }
.anchor-count {
  font-size: 20rpx;
  color: #b3a89a;
  background: var(--fyt-bg, #fff6e9);
  border-radius: 999rpx;
  padding: 0 12rpx;
  line-height: 28rpx;
}
.anchor-item.active .anchor-count { background: var(--fyt-primary, #e8336d); color: #ffffff; }

.content-col { flex: 1; min-width: 0; height: 100%; }
.sec-card {
  margin: 24rpx 24rpx 0;
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  padding: 24rpx;
}
.sec-head { display: flex; align-items: baseline; gap: 14rpx; margin-bottom: 20rpx; }
.sec-name {
  font-size: 30rpx;
  font-weight: 900;
  color: var(--fyt-primary, #e8336d);
  padding-left: 16rpx;
  border-left: 8rpx solid var(--fyt-primary, #e8336d);
  line-height: 1.2;
}
.sec-count { font-size: 22rpx; color: #b3a89a; }
.chip-flow { display: flex; flex-wrap: wrap; gap: 16rpx; }
.r-chip {
  width: calc((100% - 32rpx) / 3);
  background: #fdeef4;
  border: 2rpx solid #f7c2d6;
  border-radius: 14rpx;
  padding: 14rpx 8rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
  box-sizing: border-box;
}
.rc-name {
  font-size: 24rpx;
  font-weight: 700;
  color: #2b2b2b;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.foot-pad { padding: 28rpx 32rpx 48rpx; }
.footnote { font-size: 22rpx; color: #b3a89a; text-align: center; line-height: 1.6; }
.empty {
  margin: 48rpx 32rpx;
  background: #fffdf7;
  border: 2rpx dashed #e8d9c5;
  border-radius: 16rpx;
  padding: 48rpx 0;
  text-align: center;
  color: var(--fyt-text-2, #8c8577);
  font-size: 26rpx;
}
</style>
