<template>
  <!-- admin-33/34/39 分销管理容器：tab 由侧栏「分销管理」子菜单驱动（commission/withdraw/tree） -->
  <div class="dist-wrap">
    <Commission v-if="tab === 'commission'" />
    <Withdraw v-else-if="tab === 'withdraw'" />
    <Relations v-else />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import Commission from './commission.vue';
import Withdraw from './withdraw.vue';
import Relations from './relations.vue';

/** tab 由侧栏「分销管理」子菜单驱动：commission=佣金结算配置 / withdraw=提现审核 / tree=分销关系树 */
const props = defineProps({ tab: { type: String, default: 'commission' } });
const tab = computed(() => props.tab);
</script>

<style scoped>
.dist-wrap { display: flex; flex-direction: column; gap: 14px; }
</style>
