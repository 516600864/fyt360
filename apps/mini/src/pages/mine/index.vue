<template>
  <MineView :style="pageTheme" />
</template>

<script>
/** 我的页（画布 mini-06，M6）：内容在 components/builtin/MineView（ShellView builtin:mine 同源内嵌） */
import MineView from '@/components/builtin/MineView.vue';

export default {
  components: { MineView },
};
</script>
