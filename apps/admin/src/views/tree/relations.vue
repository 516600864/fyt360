<template>
  <!-- admin-39 分销关系树：4 KPI + 分销提示 + 三跳明细钻取（真数据 user.parent_id 链） -->
  <div class="dist-page">
    <div class="head-row">
      <div>
        <h2 class="title">分销关系树</h2>
        <p class="subtitle">绑定即锁链 · 防止链路改绑 · 解绑需申诉并人工审核</p>
      </div>
      <button class="primary-btn" @click="onExport">导出全量</button>
    </div>

    <div class="kpi-row">
      <div class="kpi"><span class="kpi-num">{{ sum.bound_total }}</span><span class="kpi-cap">累计绑定用户</span><span class="kpi-sub">覆盖全部站点</span></div>
      <div class="kpi"><span class="kpi-num">{{ sum.active_links }}</span><span class="kpi-cap">有效分销链路</span><span class="kpi-sub">近 30 天有佣金产生</span></div>
      <div class="kpi"><span class="kpi-num">{{ sum.bound_week }}</span><span class="kpi-cap">本周新增绑定</span><span class="kpi-sub">环比持续更新</span></div>
      <div class="kpi"><span class="kpi-num">{{ sum.appeals }}</span><span class="kpi-cap">处理解绑申诉</span><span class="kpi-sub">48 小时内须响应</span></div>
    </div>

    <div class="notice notice-pink">
      分销提示：粉丝下单 ¥100（L3 合伙人链路）→ 下单人自购返 60 元宝 + 直推上级得 ¥20 佣金 + 隔推上级得 ¥5 佣金；佣金现金可提现，元宝仅兑等级
    </div>

    <div class="card">
      <div class="drill-head">
        <span class="drill-title">关系明细{{ root ? ` · ${root.nickname ?? ('用户' + root.user_id)}（L3 合伙人）` : '' }}</span>
        <el-select v-model="rootId" filterable placeholder="选择根用户（按团队规模排序）" style="width: 300px" size="small">
          <el-option v-for="r in roots" :key="r.user_id" :value="r.user_id" :label="`${r.nickname ?? '用户' + r.user_id}（团队 ${r.team} 人）`" />
        </el-select>
      </div>
      <el-table :data="treeItems" v-loading="treeLoading" style="width: 100%" :header-cell-style="headerStyle">
        <el-table-column label="层级" width="110">
          <template #default="{ row }">
            <span class="hop" :class="'hop-' + row.hop">{{ hopLabel(row.hop) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="用户昵称" min-width="140">
          <template #default="{ row }">{{ mask(row.nickname) }}</template>
        </el-table-column>
        <el-table-column label="会员等级" width="130">
          <template #default="{ row }">
            <span class="lv" :class="'lv-' + row.level_code">{{ row.level_code }} {{ row.level_name }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="bound_by" label="绑定方式" width="130" />
        <el-table-column label="绑定时间" width="120">
          <template #default="{ row }">{{ (row.bound_at ?? '').slice(0, 10) }}</template>
        </el-table-column>
        <el-table-column label="团队" width="90">
          <template #default="{ row }">{{ row.team }} 人</template>
        </el-table-column>
        <el-table-column label="累计贡献佣金" align="right">
          <template #default="{ row }"><span class="comm">¥{{ row.commission.toFixed(2) }}</span></template>
        </el-table-column>
      </el-table>
      <div v-if="!treeLoading && root && !treeItems.length" class="empty-hint">该用户暂无下级绑定</div>
      <div v-if="!root" class="empty-hint">从右上角选择根用户查看其三跳链路</div>
      <div class="foot-note" v-if="root">
        该节点三跳链路本月合计分佣 ¥{{ monthSum }} · 佣金现金与元宝返利双轨记账互不干扰
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';

async function api(path) {
  const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token') } });
  const j = await r.json();
  if (!j.ok) throw new Error(j.message || '请求失败');
  return j.data;
}
const headerStyle = { background: '#fff6e9', color: '#5c3a4a', fontWeight: 700 };

const sum = ref({ bound_total: 0, active_links: 0, bound_week: 0, appeals: 0 });
const roots = ref([]);
const rootId = ref(null);
const root = ref(null);
const treeItems = ref([]);
const treeLoading = ref(false);

const hopLabel = (h) => ({ 1: 'Lv1 直推', 2: 'Lv2 间推', 3: 'Lv3 隔级' }[h] ?? `Lv${h}`);
const mask = (n) => (n && n.length > 1 ? n.slice(0, 1) + '**' : (n ?? '未命名'));
const monthSum = computed(() => treeItems.value.reduce((a, b) => a + (b.commission ?? 0), 0).toFixed(2));

async function loadSummary() {
  try { sum.value = await api('/admin/distribution/summary'); } catch (e) { ElMessage.error(e.message); }
}
async function loadRoots() {
  try {
    const d = await api('/admin/distribution/roots');
    roots.value = d.items;
    if (roots.value.length && !rootId.value) rootId.value = roots.value[0].user_id;
  } catch (e) { ElMessage.error(e.message); }
}
async function loadTree() {
  if (!rootId.value) { root.value = null; treeItems.value = []; return; }
  treeLoading.value = true;
  try {
    const d = await api(`/admin/distribution/tree?user_id=${rootId.value}`);
    root.value = d.root;
    treeItems.value = d.items;
  } catch (e) { ElMessage.error(e.message); } finally { treeLoading.value = false; }
}
function onExport() { ElMessage.info('全量导出随分销运营里程碑开放'); }

watch(rootId, loadTree);
onMounted(() => { loadSummary(); loadRoots(); });
</script>

<style scoped>
.dist-page { display: flex; flex-direction: column; gap: 16px; }
.head-row { display: flex; align-items: flex-start; }
.title { margin: 0; font-size: 22px; font-weight: 900; color: #3d2530; }
.subtitle { margin: 6px 0 0; font-size: 13px; color: #a08592; }
.primary-btn {
  margin-left: auto;
  display: inline-flex; align-items: center; gap: 4px;
  background: #e8336d; color: #fff; border: none; cursor: pointer;
  font-size: 13px; font-weight: 700; border-radius: 999px; padding: 9px 18px;
  box-shadow: 0 3px 0 rgba(163, 18, 69, 0.3);
}
.primary-btn:hover { background: #d0295f; }

.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.kpi { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 16px 18px; display: flex; flex-direction: column; gap: 2px; }
.kpi-num { font-size: 26px; font-weight: 900; color: #3d2530; }
.kpi-cap { font-size: 13px; font-weight: 700; color: #7a5c68; }
.kpi-sub { font-size: 11.5px; color: #c5b3a4; }

.notice { border-radius: 12px; padding: 10px 16px; font-size: 12.5px; }
.notice-pink { background: #fce8f0; color: #a31245; }

.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 8px 14px 14px; }
.drill-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 4px 12px; }
.drill-title { font-weight: 900; color: #3d2530; }
.hop { font-weight: 900; font-size: 13px; }
.hop-1 { color: #e8336d; }
.hop-2 { color: #ffaa1d; }
.hop-3 { color: #a08592; }
.lv { font-weight: 700; font-size: 13px; }
.lv-L3 { color: #e8336d; }
.lv-L2 { color: #ffaa1d; }
.lv-L1 { color: #a08592; }
.comm { color: #2fa36b; font-weight: 900; }
.empty-hint { text-align: center; color: #c5b3a4; font-size: 13px; padding: 20px 0; }
.foot-note { border-top: 1.5px dashed #f0dfc8; margin-top: 8px; padding: 10px 4px 2px; font-size: 12.5px; color: #a08592; }
</style>
