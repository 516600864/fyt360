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
        :dataSource="floor.data_source"
        @goods-tap="$emit('goods-tap', $event)"
      />
      <!-- notice 公告栏 -->
      <FNotice v-else-if="floor.type === 'notice'" v-bind="floor.props" />
      <!-- divider 标题分隔 -->
      <FDivider v-else-if="floor.type === 'divider'" v-bind="floor.props" />
      <!-- rich-text 图文卡（纯文字段落版） -->
      <FRichText v-else-if="floor.type === 'rich-text'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- blank 间距 -->
      <FBlank v-else-if="floor.type === 'blank'" v-bind="floor.props" />
      <!-- ingot-entry 元宝入口 -->
      <FIngotEntry v-else-if="floor.type === 'ingot-entry'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- redeem-entry 权益直达（cid 直达蚂蚁积分兑换弹窗） -->
      <FRedeemEntry v-else-if="floor.type === 'redeem-entry'" v-bind="floor.props" />
      <!-- movie-box 影票热映（mayi-movie 插件嵌入，仅 MP-WEIXIN；他端 mock） -->
      <FMovieBox v-else-if="floor.type === 'movie-box'" v-bind="floor.props" />
      <!-- floor 通用楼层容器（整卡可点） -->
      <FFloor v-else-if="floor.type === 'floor'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- float-btn 悬浮按钮 -->
      <FFloatBtn v-else-if="floor.type === 'float-btn'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- category-nav 分类导航 -->
      <FCategoryNav v-else-if="floor.type === 'category-nav'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- member-card 会员权益卡 -->
      <FMemberCard v-else-if="floor.type === 'member-card'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- brand-matrix 品牌宫格 -->
      <FBrandMatrix v-else-if="floor.type === 'brand-matrix'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- activity-floor 活动楼层 -->
      <FActivityFloor v-else-if="floor.type === 'activity-floor'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- image-hotzone 图片热区 -->
      <FImageHotzone v-else-if="floor.type === 'image-hotzone'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- video-floor 视频楼层 -->
      <FVideoFloor v-else-if="floor.type === 'video-floor'" v-bind="floor.props" />
      <!-- countdown 倒计时 -->
      <FCountdown v-else-if="floor.type === 'countdown'" v-bind="floor.props" />
      <!-- popup-modal 进页弹窗 -->
      <FPopupModal v-else-if="floor.type === 'popup-modal'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- seckill 秒杀楼层（装修器配置数据；item 点击支持 goods-tap 上抛） -->
      <FSeckill v-else-if="floor.type === 'seckill'" v-bind="floor.props" @action="emitAction(floor, $event)" @goods-tap="$emit('goods-tap', $event)" />
      <!-- group-buy-floor 拼团楼层（装修器配置数据） -->
      <FGroupBuyFloor v-else-if="floor.type === 'group-buy-floor'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- coupon-wall 券墙中心（装修器配置数据） -->
      <FCouponWall v-else-if="floor.type === 'coupon-wall'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- invite-floor 邀请有礼 -->
      <FInviteFloor v-else-if="floor.type === 'invite-floor'" v-bind="floor.props" @action="emitAction(floor, $event)" />
      <!-- 未实现组件兜底（23 组件已全实现，此分支仅防御未知 type） -->
      <view v-else class="floor-placeholder">
        <text>[{{ floor.type }}]</text>
      </view>
    </view>
    <!-- popup Action：端内半屏弹层（渲染器内置处理，不上抛宿主） -->
    <view v-if="popupShow" class="popup-mask" @click="popupShow = false">
      <view class="popup-sheet" @click.stop>
        <text class="popup-txt">{{ popupText }}</text>
        <view class="popup-close" @click="popupShow = false"><text>知道了</text></view>
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
import FNotice from './components/f-notice.vue';
import FDivider from './components/f-divider.vue';
import FRichText from './components/f-rich-text.vue';
import FBlank from './components/f-blank.vue';
import FIngotEntry from './components/f-ingot-entry.vue';
import FRedeemEntry from './components/f-redeem-entry.vue';
import FMovieBox from './components/f-movie-box.vue';
import FFloor from './components/f-floor.vue';
import FFloatBtn from './components/f-float-btn.vue';
import FCategoryNav from './components/f-category-nav.vue';
import FMemberCard from './components/f-member-card.vue';
import FBrandMatrix from './components/f-brand-matrix.vue';
import FActivityFloor from './components/f-activity-floor.vue';
import FImageHotzone from './components/f-image-hotzone.vue';
import FVideoFloor from './components/f-video-floor.vue';
import FCountdown from './components/f-countdown.vue';
import FPopupModal from './components/f-popup-modal.vue';
import FSeckill from './components/f-seckill.vue';
import FGroupBuyFloor from './components/f-group-buy-floor.vue';
import FCouponWall from './components/f-coupon-wall.vue';
import FInviteFloor from './components/f-invite-floor.vue';

/**
 * SchemaPage（渲染器入口，§6.1）：
 * - 消费 page-v1 Schema（floors[]），v-if 分发到楼层组件（跨端显式分发，不用动态组件）
 * - 主题：约定③ 组件只读 var(--fyt-*)；theme prop（site.theme）以同名变量内联覆盖默认值
 * - fetcher：由宿主页注入（mini=request 封装 / H5=authFetch），组件不发裸请求
 * - 事件：goods-tap(item,platform) 转链由宿主接 core/link；action 统一上抛宿主路由
 */
export default {
  name: 'SchemaPage',
  components: { FSwiper, FSearchBar, FNav, FCouponStrip, FBrandChips, FGoodsFeed, FNotice, FDivider, FRichText, FBlank, FIngotEntry, FMovieBox, FRedeemEntry, FFloor, FFloatBtn, FCategoryNav, FMemberCard, FBrandMatrix, FActivityFloor, FImageHotzone, FVideoFloor, FCountdown, FPopupModal, FSeckill, FGroupBuyFloor, FCouponWall, FInviteFloor },
  props: {
    /** page-v1 Schema 对象（{floors:[...]}）；兼容直接传 floors 数组；空则整页不渲染 */
    schema: { type: [Object, Array], default: null },
    /** 站点主题覆盖：键为 --fyt-*（可含/不含前缀），值为 CSS 值 */
    theme: { type: Object, default: null },
    /** 网络注入：fetcher(path) → Promise<unwrapped data> */
    fetcher: { type: Function, default: null },
  },
  data() {
    return { popupShow: false, popupText: '' };
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
      // popup+checkin：聚宝盆签到弹层（决策#31）→ 上抛宿主页（index 挂 CheckinPopup）
      if (action?.type === 'popup' && action.target === 'checkin') {
        this.$emit('checkin', { floor_id: floor.floor_id, component_id: floor.component_id });
        return;
      }
      // popup：端内半屏弹层，渲染器内置处理（value=弹层文案）
      if (action?.type === 'popup') {
        this.popupText = action.value ?? '';
        this.popupShow = true;
        return;
      }
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
}

/* popup 半屏弹层（Action 协议 type=popup） */
.popup-mask {
  position: fixed; inset: 0; z-index: 999;
  background: rgba(30, 10, 20, 0.55);
  display: flex; align-items: flex-end;
}
.popup-sheet {
  width: 100%; box-sizing: border-box;
  background: var(--fyt-surface);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-lg) var(--fyt-radius-lg) 0 0;
  padding: var(--fyt-space-4);
  display: flex; flex-direction: column; gap: var(--fyt-space-3);
}
.popup-txt { color: var(--fyt-text); font-size: 28rpx; line-height: 1.6; white-space: pre-wrap; }
.popup-close {
  align-self: center;
  background: var(--fyt-primary); color: var(--fyt-on-primary, #fff);
  font-size: 26rpx; font-weight: 800;
  border-radius: var(--fyt-radius-full); padding: 14rpx 60rpx;
}
</style>
