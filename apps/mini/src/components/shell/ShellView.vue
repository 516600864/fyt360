<template>
  <view class="shell-view">
    <!-- builtin：内嵌内置页组件（M6：mine/orders/rights 已是真页面，同源双挂载） -->
    <template v-if="mode === 'builtin'">
      <MineView v-if="builtinKey === 'mine'" />
      <OrdersView v-else-if="builtinKey === 'orders'" />
      <RightsHome v-else-if="builtinKey === 'rights'" />
      <RightsCategory v-else-if="builtinKey === 'life'" :embedded="true" />
      <Placeholder v-else :emoji="builtinMeta.emoji" :title="builtinMeta.title" :desc="builtinMeta.desc" />
    </template>
    <view v-else-if="mode === 'home'" class="placeholder">
      <text class="title">首页在左侧</text>
    </view>
    <!-- schema：拉取该页面 published Schema → 渲染器渲染 -->
    <view v-else-if="mode === 'schema'" class="schema-holder">
      <view v-if="schemaLoading" class="tip"><text>装修加载中…</text></view>
      <view v-else-if="!schema" class="tip">
        <text class="title">页面未发布</text>
        <text class="desc">该装修页面尚未发布，请在后台发布后重试</text>
      </view>
      <SchemaPage v-else :schema="schema" :theme="theme" :fetcher="request" @action="onAction" @goods-tap="onGoodsTap" />
    </view>
    <!-- 序号越界（配置项少于 5）或 target 非法 -->
    <view v-else class="tip">
      <text class="desc">此位置未配置内容</text>
    </view>
  </view>
</template>

<script>
import SchemaPage from '@/renderer/index.vue';
import defaultHome from '@/renderer/schema/default-home.json';
import { request } from '../../utils/request';
import { onGoodsTap as cpsTap } from '../../core/link';
import Placeholder from '../builtin/Placeholder.vue';
import MineView from '../builtin/MineView.vue';
import OrdersView from '../builtin/OrdersView.vue';
import RightsHome from '../../pages/rights/index.vue';
import RightsCategory from '../../pages/rights/category.vue';

/** builtin 目标 → 占位组件文案（与 pages/rights 等独立页保持同源文案） */
const BUILTIN_META = {
  rights: { emoji: '🎁', title: '会员权益', desc: '6 大类 83 品牌直充权益，马上就来' },
  life: { emoji: '🧭', title: '生活服务', desc: '到店美食 / 休闲娱乐 / 便捷生活一站直达' },
  orders: { emoji: '📋', title: '我的订单', desc: '订单状态与元宝明细，即将开放' },
  mine: { emoji: '👤', title: '我的', desc: '元宝、等级与邀请好友，即将开放' },
};

/**
 * M4 壳页内容解析器（决策#28）：Tab2~5 按 tabbar 配置渲染
 * - target.type='builtin' → 内嵌内置组件
 * - target.type='schema'  → GET /api/site/page-schema 拉 published Schema → SchemaPage
 * 首页（Tab1）不走本组件（pages/index/index 自持 Schema 渲染）。
 */
export default {
  components: { SchemaPage, Placeholder, MineView, OrdersView, RightsHome, RightsCategory },
  props: {
    /** tabbar 配置项：{ key, name, target: { type, value } } */
    item: { type: Object, default: null },
  },
  data() {
    return { mode: 'empty', schema: null, schemaLoading: false, theme: null };
  },
  computed: {
    builtinKey() {
      return this.item?.target?.value ?? '';
    },
    builtinMeta() {
      return BUILTIN_META[this.item?.target?.value] ?? { emoji: '🚧', title: this.item?.name ?? '', desc: '页面建设中' };
    },
  },
  watch: {
    item: { handler: 'resolve', immediate: true },
  },
  methods: {
    // fetcher 注入：模板可见性必须挂 methods（Options API 铁律，2026-09-23 教训）
    request,
    resolve() {
      const t = this.item?.target;
      if (!t || !t.type) { this.mode = 'empty'; return; }
      if (t.type === 'builtin') {
        this.mode = t.value === 'home' ? 'home' : 'builtin';
        return;
      }
      if (t.type === 'schema' && /^page-[a-z0-9]{2,10}$/.test(String(t.value ?? ''))) {
        this.loadSchema(t.value);
        return;
      }
      this.mode = 'empty';
    },
    async loadSchema(pageKey) {
      this.mode = 'schema';
      this.schemaLoading = true;
      try {
        const d = await request(`/api/site/page-schema?code=site-a&page=${encodeURIComponent(pageKey)}`);
        this.schema = d.published ? d.schema : null;
        this.theme = this.schema?.theme ?? null;
      } catch (e) {
        this.schema = null;
      } finally {
        this.schemaLoading = false;
      }
    },
    onGoodsTap({ item, platform }) {
      cpsTap({ ...item, platform });
    },
    onAction(action) {
      // Action 协议同首页（jump/plugin-launch），壳页内命中即透传
      this.$emit('action', action);
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.shell-view { min-height: 100vh; }
.tip {
  display: flex; flex-direction: column; align-items: center; gap: $fyt-space-4;
  padding: 200rpx 40rpx; color: $fyt-text-secondary; text-align: center;
}
.title { font-size: 36rpx; font-weight: 900; color: $fyt-primary; }
.desc { font-size: 26rpx; color: $fyt-text-secondary; }
.placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 200rpx 0; }
</style>
