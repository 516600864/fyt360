<template>
  <view class="schema-page" :style="themeStyle">
    <view v-for="floor in floors" :key="floor.floor_id" class="floor">
      <!-- swiper-轮播（banner） -->
      <FSwiper
        v-if="floor.type === 'swiper'"
        v-bind="floor.props"
        @action="emitAction(floor, $event)"
      />
      <!-- search-bar（含签到有礼） -->
      <FSearchBar
        v-else-if="floor.type === 'search-bar'"
        v-bind="floor.props"
        @action="emitAction(floor, $event)"
      />
      <!-- nav-金刚区 -->
      <FNav
        v-else-if="floor.type === 'nav'"
        v-bind="floor.props"
        @action="emitAction(floor, $event)"
      />
      <!-- coupon-strip 优惠券横条 -->
      <FCouponStrip
        v-else-if="floor.type === 'coupon-strip'"
        v-bind="floor.props"
        @action="emitAction(floor, $event)"
      />
      <!-- brand-chips 品牌补贴日 -->
      <FBrandChips
        v-else-if="floor.type === 'brand-chips'"
        v-bind="floor.props"
        @action="emitAction(floor, $event)"
      />
      <!-- goods-feed 商品流（CPS 实时透传） -->
      <FGoodsFeed
        v-else-if="floor.type === 'goods-feed'"
        v-bind="floor.props"
        :data-source="floor.data_source"
        @goods-tap="$emit('goods-tap', $event)"
      />
      <!-- 未实现组件兜底（23 组件库其余随 DIY 里程碑补齐） -->
      <view v-else class="floor-placeholder">
        <text>[{{ floor.type }}]</text>
      </view>
    </view>
  </view>
</template>

<script>
import FSwiper from './components/f-swiper.vue';
import FSearchBar from './components/f-search-bar.vue';
import FNav from './components/f-nav.vue';
import FCouponStrip from './components/f-coupon-strip.vue';
import FBrandChips from './components/f-brand-chips.vue';
import FGoodsFeed from './components/f-goods-feed.vue';

/**
 * SchemaPage（渲染器入口，§6.1）：
 * - 消费 page-v1 Schema（floors[]），v-if 分发到楼层组件（跨端显式分发，不用动态组件）
 * - 主题：约定③ 组件只读 var(--fyt-*)；theme prop（site.theme）以同名变量内联覆盖默认值
 * - fetcher：由宿主页注入（mini=request 封装 / H5=authFetch），组件不发裸请求
 * - 事件：goods-tap(item,platform) 转链由宿主接 core/link；action 统一上抛宿主路由
 */
export default {
  name: 'SchemaPage',
  components: { FSwiper, FSearchBar, FNav, FCouponStrip, FBrandChips, FGoodsFeed },
  props: {
    /** page-v1 Schema 对象（{floors:[...]}）；兼容直接传 floors 数组；空则整页不渲染 */
    schema: { type: [Object, Array], default: null },
    /** 站点主题覆盖：键为 --fyt-*（可含/不含前缀），值为 CSS 值 */
    theme: { type: Object, default: null },
    /** 网络注入：fetcher(path) → Promise<unwrapped data> */
    fetcher: { type: Function, default: null },
  },
  provide() {
    return { fytFetcher: this.fetcher };
  },
  computed: {
    floors() {
      if (Array.isArray(this.schema)) return this.schema;
      return this.schema?.floors ?? [];
    },
    themeStyle() {
      if (!this.theme) return '';
      return Object.entries(this.theme)
        .map(([k, v]) => `${k.startsWith('--') ? k : '--fyt-' + k}:${v}`)
        .join(';');
    },
  },
  methods: {
    emitAction(floor, action) {
      this.$emit('action', { floor_id: floor.floor_id, component_id: floor.component_id, action });
    },
  },
};
</script>

<style>
/* 渲染器全局样式入口：默认主题变量（组件内全部 var() 引用） */
@import './styles/theme.css';

.schema-page {
  min-height: 100vh;
  background: var(--fyt-bg);
  box-sizing: border-box;
  padding: var(--fyt-space-2);
}
.floor + .floor {
  margin-top: var(--fyt-space-2);
}
.floor-placeholder {
  background: var(--fyt-surface-alt);
  border: var(--fyt-border-thick) dashed var(--fyt-border-default);
  border-radius: var(--fyt-radius-lg);
  padding: var(--fyt-space-6);
  text-align: center;
  color: var(--fyt-text-3);
  font-size: 26rpx;
}
</style>
