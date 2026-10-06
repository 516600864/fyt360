<template>
  <!-- 合作品牌墙：固定静态展示（无动画），按品牌去重，分组带标题 -->
  <div class="pw-wrap">
    <div v-for="g in PARTNER_BRAND_GROUPS" :key="g.title" class="pw-group">
      <span class="pw-group-title">{{ g.title }}</span>
      <div class="pw-chips">
        <span v-for="b in g.brands" :key="b" class="pw-chip">{{ b }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { PARTNER_BRAND_GROUPS } from '../data/partnerBrands';
</script>

<style scoped>
.pw-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.pw-group { display: flex; align-items: baseline; gap: 8px; }
.pw-group-title {
  flex-shrink: 0;
  width: 52px;
  font-size: 11.5px;
  font-weight: 800;
  opacity: 0.8;
  letter-spacing: 0.5px;
}
.pw-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 6px;
  min-width: 0;
}
.pw-chip {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 3px 11px;
  font-size: 11.5px;
  font-weight: 800;
  line-height: 1.5;
  white-space: nowrap;
  background: var(--pm-chip-bg, rgba(255, 255, 255, 0.92));
  color: var(--pm-chip-fg, #a31245);
}
</style>
