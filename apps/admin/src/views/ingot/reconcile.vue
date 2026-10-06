<template>
  <!-- admin-41 元宝对账：标题区 + 粉 notice + 4 KPI + 对账流水主表 + 汇总条（保留类型/佣金分布实面板） -->
  <div class="rec">
    <!-- 标题区 -->
    <div class="head-row">
      <div>
        <h2 class="page-title">元宝对账</h2>
        <p class="page-sub">蚂蚁星球积分按日由供应商流水核对 · T+1 漫展自动对账 · 差异自动生成调账单</p>
      </div>
      <div class="head-right">
        <span class="site-pill">站点：{{ isPlatform ? `全部站点（${sitesCount}）` : '我的站点' }}</span>
        <el-button type="primary" class="export-btn" :loading="exporting" @click="onExport">导出对账单</el-button>
      </div>
    </div>

    <!-- 双体系隔离 notice -->
    <div class="notice">
      双体系严格隔离：蚂蚁星球积分仅用于品牌权益兑换展示；本系统元宝（1 元 = 100 元宝）仅用于会员等级晋升。两账分记、互不结算、互不折算
    </div>

    <!-- KPI 四卡 -->
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-label">元宝余额合计</div>
        <div class="kpi-value">{{ fmt(account.balance) }}</div>
        <div class="kpi-sub">冻结 {{ fmt(account.frozen) }} · 账户 {{ fmt(account.accounts) }} 个</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">累计发放元宝</div>
        <div class="kpi-value">{{ fmt(account.total_earned) }}</div>
        <div class="kpi-sub">环比 {{ typeTotal ? Math.round((netRebated / typeTotal) * 100) : 0 }}%（发放/冲销合计）</div>
      </div>
      <div class="kpi-card" :class="recon.drift_ok ? '' : 'kpi-bad'">
        <div class="kpi-label">对账差异</div>
        <div class="kpi-value" :class="recon.drift_ok ? 'num-ok' : 'num-bad'">{{ recon.drift > 0 ? '+' : '' }}{{ fmt(recon.drift) }}</div>
        <div class="kpi-sub">{{ recon.drift_ok ? '连续自动对平 · 无差异' : '发放 − 应付 ≠ 0，需人工核查' }}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">已结算应付元宝</div>
        <div class="kpi-value">{{ fmt(recon.expect_ingot) }}</div>
        <div class="kpi-sub">已结算 {{ fmt(recon.settled_orders) }} 单 · 净发放 {{ fmt(recon.net_rebated) }}</div>
      </div>
    </div>

    <!-- 对账流水主表 -->
    <div class="panel main-panel">
      <div class="panel-head center">
        <span class="panel-title">对账流水 · 元宝明细</span>
      </div>
      <div class="toolbar">
        <el-select v-model="filterType" placeholder="全部类型" clearable size="default" style="width: 200px" @change="loadTx(1)">
          <el-option v-for="(label, key) in TYPE_LABEL" :key="key" :label="label" :value="key" />
        </el-select>
        <el-button @click="loadAll">刷新</el-button>
        <span class="toolbar-tip">按笔明细 · 与订单结算流水一一对账</span>
      </div>
      <el-table :data="items" size="large" v-loading="loading"
        :header-cell-style="{ background: '#fff6e9', color: '#a31245', fontWeight: 700 }">
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ new Date(row.created_at).toLocaleString('zh-CN') }}</template>
        </el-table-column>
        <el-table-column label="用户" width="140">
          <template #default="{ row }">{{ row.nickname || '#' + row.user_id }}</template>
        </el-table-column>
        <el-table-column label="类型" width="130">
          <template #default="{ row }">
            <span class="tx-tag" :class="'tx-' + (TX_CLS[row.type] ?? 'info')">{{ TYPE_LABEL[row.type] ?? row.type }}</span>
          </template>
        </el-table-column>
        <el-table-column label="关联订单" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.order_sn">{{ row.order_sn }}（{{ PROVIDER_LABEL[row.order_provider] ?? row.order_provider }} ¥{{ row.pay_price }}）</span>
            <span v-else class="dim">{{ row.ref_id || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="变动" width="110" align="right">
          <template #default="{ row }">
            <span :class="row.amount >= 0 ? 'num-plus' : 'num-minus'">{{ row.amount >= 0 ? '+' : '' }}{{ row.amount }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="balance_after" label="余额快照" width="110" align="right" />
        <el-table-column prop="remark" label="备注" show-overflow-tooltip />
      </el-table>
      <el-pagination
        class="pager"
        layout="prev, pager, next, total"
        :total="total"
        :page-size="size"
        :current-page="page"
        @current-change="loadTx"
      />
    </div>

    <!-- 汇总条 -->
    <div class="sum-bar">
      全平台累计结算 {{ fmt(recon.settled_orders) }} 单 · 应付 {{ fmt(recon.expect_ingot) }} 元宝 · 净发放 {{ fmt(recon.net_rebated) }} 元宝 ·
      差额 <b :class="recon.drift_ok ? 'num-ok' : 'num-bad'">{{ fmt(recon.drift) }}</b>
      （差额 = 发放 − 应付，≠0 自动告警）
    </div>

    <!-- 类型分布 + 佣金分布（实面板，随 DIY 里程碑前保留） -->
    <div class="dist-row">
      <div class="panel">
        <div class="panel-head"><span class="panel-title">元宝流水类型分布</span></div>
        <el-table :data="types" size="small" stripe>
          <el-table-column prop="type" label="类型" width="160" />
          <el-table-column label="含义">
            <template #default="{ row }">{{ TYPE_LABEL[row.type] ?? row.type }}</template>
          </el-table-column>
          <el-table-column prop="cnt" label="笔数" width="90" align="right" />
          <el-table-column label="元宝" width="110" align="right">
            <template #default="{ row }">
              <span :class="row.amount >= 0 ? 'num-plus' : 'num-minus'">{{ fmt(row.amount) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div class="panel">
        <div class="panel-head"><span class="panel-title">佣金三跳分布</span></div>
        <el-table :data="commission" size="small" stripe>
          <el-table-column label="跳位" width="90">
            <template #default="{ row }">{{ LEVEL_LABEL[row.level] ?? row.level }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="110" />
          <el-table-column prop="cnt" label="笔数" width="90" align="right" />
          <el-table-column prop="amount" label="佣金 ¥" align="right" />
        </el-table>
        <el-empty v-if="!commission.length" description="暂无佣金流水" :image-size="48" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';

const TYPE_LABEL = {
  ORDER_REBATE: '自购返元宝',
  INVITE_REWARD: '邀请奖励',
  LEVEL_EXCHANGE: '等级兑换',
  REFUND_DEDUCT: '退款冲销',
  ADMIN_ADJUST: '后台调整',
};
const TX_CLS = { ORDER_REBATE: 'ok', INVITE_REWARD: 'warn', LEVEL_EXCHANGE: 'primary', REFUND_DEDUCT: 'bad', ADMIN_ADJUST: 'info' };
const PROVIDER_LABEL = { self: '到店团购', mayixingqiu: '蚂蚁CPS', jd: '京东', tb: '淘宝', pdd: '拼多多', vip: '唯品会' };
const LEVEL_LABEL = { 1: '自购', 2: '直推', 3: '间推' };

const admin = JSON.parse(localStorage.getItem('fyt_admin_info') ?? 'null');
const isPlatform = admin?.role === 'platform_admin';

const account = ref({ balance: 0, frozen: 0, total_earned: 0, accounts: 0 });
const recon = ref({ settled_orders: 0, expect_ingot: 0, net_rebated: 0, drift: 0, drift_ok: true });
const types = ref([]);
const commission = ref([]);
const items = ref([]);
const total = ref(0);
const page = ref(1);
const size = 20;
const filterType = ref('');
const loading = ref(false);
const exporting = ref(false);
const sitesCount = ref(0);

const fmt = (n) => Number(n ?? 0).toLocaleString('zh-CN');
const typeTotal = ref(0);

async function api(path) {
  const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token') } });
  const j = await r.json();
  if (!j.ok) throw new Error(j.message || '请求失败');
  return j.data;
}

async function loadSummary() {
  const d = await api('/admin/ingot/summary');
  account.value = d.account;
  recon.value = d.recon;
  types.value = d.types;
  commission.value = d.commission;
  typeTotal.value = d.types.reduce((a, t) => a + Math.abs(Number(t.amount ?? 0)), 0);
  try {
    const dash = await api('/admin/dashboard/summary');
    sitesCount.value = dash.sites_count ?? 0;
  } catch {
    /* 站点数仅展示用，失败不阻塞 */
  }
}

async function loadTx(p = 1) {
  page.value = p;
  loading.value = true;
  try {
    const q = `?page=${p}&size=${size}` + (filterType.value ? `&type=${filterType.value}` : '');
    const d = await api('/admin/ingot/tx' + q);
    items.value = d.items;
    total.value = d.total;
  } finally {
    loading.value = false;
  }
}

/** 导出当前筛选流水 CSV（真实数据，最多 1000 笔） */
async function onExport() {
  exporting.value = true;
  try {
    const q = `?page=1&size=1000` + (filterType.value ? `&type=${filterType.value}` : '');
    const d = await api('/admin/ingot/tx' + q);
    const head = '时间,用户,类型,关联订单,平台,实付,变动,余额快照,备注';
    const lines = d.items.map((r) =>
      [
        new Date(r.created_at).toLocaleString('zh-CN'),
        r.nickname || '#' + r.user_id,
        TYPE_LABEL[r.type] ?? r.type,
        r.order_sn ?? '',
        PROVIDER_LABEL[r.order_provider] ?? r.order_provider ?? '',
        r.pay_price ?? '',
        r.amount,
        r.balance_after ?? '',
        (r.remark ?? '').replace(/[,\n]/g, ' '),
      ].join(',')
    );
    const blob = new Blob(['\ufeff' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `元宝对账_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    ElMessage.success(`已导出 ${lines.length} 笔`);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    exporting.value = false;
  }
}

function loadAll() {
  loadSummary().catch((e) => ElMessage.error(e.message));
  loadTx(1).catch((e) => ElMessage.error(e.message));
}

onMounted(loadAll);
</script>

<style scoped>
.head-row { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
.page-title { font-size: 22px; font-weight: 900; color: #3d2530; margin: 0 0 4px; }
.page-sub { font-size: 12.5px; color: #8a6b75; margin: 0; }
.head-right { display: flex; align-items: center; gap: 10px; }
.site-pill {
  background: #fff; border: 1.5px solid #f0dfc8; border-radius: 999px;
  font-size: 13px; font-weight: 600; color: #3d2530; padding: 7px 16px;
}
.export-btn { border-radius: 999px; font-weight: 700; }

.notice {
  background: #fdeef4; border-radius: 12px; padding: 10px 16px;
  font-size: 12.5px; font-weight: 600; color: #a31245; margin-bottom: 16px;
}

.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
.kpi-card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 14px; padding: 16px 18px; }
.kpi-bad { border-color: #e8336d; background: #fff5f8; }
.kpi-label { font-size: 13px; color: #8a6b75; font-weight: 600; }
.kpi-value { font-size: 25px; font-weight: 900; color: #3d2530; margin: 8px 0 4px; }
.kpi-sub { font-size: 11.5px; color: #b9a3ac; }
.num-ok { color: #18a058; }
.num-bad { color: #d03050; }

.panel { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 16px 18px; }
.main-panel { margin-bottom: 14px; }
.panel-head.center { justify-content: center; }
.panel-title { font-size: 15px; font-weight: 800; color: #3d2530; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.toolbar-tip { font-size: 12px; color: #b9a3ac; margin-left: auto; }
.num-plus { color: #e8336d; font-weight: 700; }
.num-minus { color: #18a058; font-weight: 700; }
.dim { color: #b9a3ac; }
.tx-tag { font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 12px; }
.tx-ok { background: #e8f6ee; color: #18a058; }
.tx-warn { background: #fff8ea; color: #d98c0a; }
.tx-primary { background: #fdeef4; color: #e8336d; }
.tx-bad { background: #fbecf0; color: #d03050; }
.tx-info { background: #f3eee6; color: #8a6b75; }
.pager { margin-top: 12px; justify-content: flex-end; }

.sum-bar {
  background: #fff8ea; border: 1.5px solid #f0dfc8; border-radius: 12px;
  padding: 10px 16px; font-size: 12.5px; color: #8a6b75; margin-bottom: 16px;
}
.sum-bar b { font-weight: 800; }

.dist-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
</style>
