<template>
  <ShellView :item="item" @action="onAction" :style="pageTheme" />
</template>

<script>
/**
 * M4 壳页 s3（决策#28）：TabBar 第 3 位壳页。
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
    // 壳页基类约定：onShow 强制 setSelected 同步（ordinal=2）
    syncTabBar(this, 2, true);
    const items = (await getTabbarConfig()).items;
    this.item = items[2] ?? null;
  },
  methods: {
    onAction(action) {
      handleAction(action);
    },
  },
};
</script>
