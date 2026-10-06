<template>
  <!-- 消息中心 · 铃铛面板（决策 #37 三态之二）
       三源=订单异动/审计回执/系统公告；未读=玫红圆点，已读=浅底；底部仅显示最近 30 天 -->
  <div class="np">
    <div class="np-head">
      <span class="np-title">消息中心</span>
      <button class="np-readall" :disabled="!hasUnread || busy" @click="markAll">
        全部已读
      </button>
    </div>

    <div class="np-tabs">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="np-tab"
        :class="{ active: tab === t.key }"
        @click="tab = t.key"
      >
        {{ t.label }}<span v-if="counts[t.key]" class="np-tab-n">{{ counts[t.key] }}</span>
      </button>
    </div>

    <div class="np-list">
      <p v-if="loading" class="np-tip">加载中…</p>
      <p v-else-if="err" class="np-tip err">{{ err }}</p>
      <p v-else-if="!list.length" class="np-tip">暂无消息</p>
      <button
        v-for="n in list"
        :key="n.id"
        class="np-item"
        :class="{ unread: !n.read }"
        @click="onItem(n)"
      >
        <span class="np-dot" />
        <span class="np-body">
          <span class="np-item-title">{{ n.title }}</span>
          <span class="np-item-desc">{{ n.desc }}</span>
        </span>
        <span class="np-at">{{ relTime(n.at) }}</span>
      </button>
    </div>

    <p class="np-foot">仅显示最近 30 天</p>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { adminApi, relTime } from '../lib/api';

const props = defineProps({ site: { type: String, default: '' } });
const emit = defineEmits(['navigate']);

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'order', label: '订单异动' },
  { key: 'audit', label: '审计回执' },
  { key: 'system', label: '系统公告' },
];

const tab = ref('all');
const loading = ref(false);
const busy = ref(false);
const err = ref('');
const items = ref([]);
const counts = ref({ all: 0, order: 0, audit: 0, system: 0 });
const hasUnread = computed(() => items.value.some((n) => !n.read));
const list = computed(() => (tab.value === 'all' ? items.value : items.value.filter((n) => n.source === tab.value)));

async function load(force) {
  loading.value = true;
  err.value = '';
  try {
    const q = props.site ? `?site=${encodeURIComponent(props.site)}` : '';
    const d = await adminApi(`/admin/account/notifications${q}${q ? '&' : ''}${force ? 'fresh=1' : ''}`);
    items.value = d.items ?? [];
    counts.value = d.counts ?? { all: 0, order: 0, audit: 0, system: 0 };
  } catch (e) {
    err.value = e.message || '消息加载失败';
  } finally {
    loading.value = false;
  }
}

async function markAll() {
  const ids = items.value.filter((n) => !n.read).map((n) => n.id);
  if (!ids.length) return;
  busy.value = true;
  try {
    await adminApi('/admin/account/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) });
    await load();
  } catch (e) {
    err.value = e.message || '操作失败';
  } finally {
    busy.value = false;
  }
}

async function onItem(n) {
  if (!n.read) {
    // 乐观置已读，失败不回滚（消息中心非关键路径）
    n.read = true;
    adminApi('/admin/account/notifications/read', { method: 'POST', body: JSON.stringify({ ids: [n.id] }) }).catch(() => {});
  }
  if (n.nav_key === 'account') emit('navigate', 'account', { tab: 'audit' });
  else emit('navigate', n.nav_key);
}

onMounted(() => load());
defineExpose({ reload: load });
</script>

<style scoped>
.np {
  width: 340px;
  background: #fff;
  border: 1.5px solid #f0dfc8;
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(122, 45, 82, 0.16);
  overflow: hidden;
}
.np-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px 10px; border-bottom: 1.5px solid #f7ece2;
}
.np-title { font-size: 14px; font-weight: 800; color: #3d2530; }
.np-readall {
  border: none; background: none; cursor: pointer;
  font-size: 12px; font-weight: 700; color: #e8336d;
}
.np-readall:disabled { color: #c9b2bb; cursor: default; }

.np-tabs { display: flex; gap: 4px; padding: 8px 10px; border-bottom: 1.5px solid #f7ece2; }
.np-tab {
  border: none; background: none; cursor: pointer; border-radius: 999px;
  padding: 4px 10px; font-size: 12px; font-weight: 700; color: #8a6b75;
}
.np-tab.active { background: #fdeaf1; color: #a31245; }
.np-tab-n { margin-left: 3px; font-size: 11px; opacity: 0.75; }

.np-list { max-height: 300px; overflow-y: auto; }
.np-tip { margin: 0; padding: 22px 14px; text-align: center; font-size: 12.5px; color: #9a7a86; }
.np-tip.err { color: #c0392b; }
.np-item {
  display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left;
  border: none; background: none; cursor: pointer; padding: 10px 12px;
  border-bottom: 1px solid #faf3ee;
}
.np-item:hover { background: #fdf7f2; }
.np-item.unread { background: #fffafc; }
.np-dot {
  flex-shrink: 0; width: 7px; height: 7px; border-radius: 50%;
  background: transparent; margin-top: 5px;
}
.np-item.unread .np-dot { background: #e8336d; }
.np-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.np-item-title { font-size: 12.5px; font-weight: 700; color: #3d2530; }
.np-item.unread .np-item-title { color: #a31245; }
.np-item-desc { font-size: 11.5px; color: #9a7a86; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-at { flex-shrink: 0; font-size: 11px; color: #b8a0aa; }
.np-foot { margin: 0; padding: 8px; text-align: center; font-size: 11px; color: #b8a0aa; background: #fdfaf7; }
</style>
