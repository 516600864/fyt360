<template>
  <OrdersView :init-tab="tab" :style="pageTheme" />
</template>

<script>
/** 我的订单页（M6）：内容在 components/builtin/OrdersView（ShellView builtin:orders 同源内嵌）；支持 ?tab= 定位 */
import OrdersView from '@/components/builtin/OrdersView.vue';

export default {
  components: { OrdersView },
  data() {
    return { tab: 'all' };
  },
  onLoad(q) {
    const t = String(q?.tab ?? 'all');
    if (['all', 'pending', 'paid', 'completed', 'refund'].includes(t)) this.tab = t;
  },
};
</script>
