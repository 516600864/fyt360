<template>
  <ShellView :item="item" @action="onAction" :style="pageTheme" />
</template>

<script>
/**
 * M4 壳页 s4（决策#28）：TabBar 第 4 位壳页。
 * 内容按 tabbar 配置解析（builtin / schema），选中态 onShow 强制同步。
 */
import ShellView from '@/components/shell/ShellView.vue';
import { syncTabBar, getTabbarConfig } from '../../core/tabbar';
import { handleAction } from '../../core/action';

export default {
  components: { ShellView },
  data() {
    return { item: null };
  },
  async onShow() {
    // 壳页基类约定：onShow 强制 setSelected 同步（ordinal=3）
    syncTabBar(this, 3, true);
    const items = (await getTabbarConfig()).items;
    this.item = items[3] ?? null;
  },
  methods: {
    onAction(action) {
      handleAction(action);
    },
  },
};
</script>
