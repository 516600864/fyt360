<template>
  <ShellView :item="item" @action="onAction" :style="pageTheme" />
</template>

<script>
/**
 * 活动壳页（决策#33）：DIY 装修 page-xxxx 的通用 C 端渲染入口。
 * 复用 ShellView schema 模式（与 Tab 壳页同款渲染器），onLoad 接 ?page=page-xxx；
 * 跳转统一走「活动页」动作（core/action.js activity 分支），零独立业务逻辑。
 */
import ShellView from '@/components/shell/ShellView.vue';
import { handleAction } from '@/core/action';

export default {
  components: { ShellView },
  data() {
    return { item: null };
  },
  onLoad(q) {
    const pageKey = String(q?.page ?? '');
    if (/^page-[a-z0-9]{2,10}$/.test(pageKey)) {
      this.item = { key: pageKey, name: q?.title ? decodeURIComponent(q.title) : '活动页', target: { type: 'schema', value: pageKey } };
    }
    if (q?.title) uni.setNavigationBarTitle({ title: decodeURIComponent(q.title) });
  },
  methods: {
    onAction(action) {
      handleAction(action);
    },
  },
};
</script>
