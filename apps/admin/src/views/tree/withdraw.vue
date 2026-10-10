<template>
  <!-- admin-34 提现审核：佣金现金提现审核流（withdraw 真数据；打款通道随企业付款里程碑接通） -->
  <div class="wd-page">
    <div class="head-row">
      <div>
        <h2 class="title">提现审核</h2>
        <p class="subtitle">申请方发起 → 后台审核 → 企业付款到零钱 T+1 到账</p>
      </div>
      <div class="head-btns">
        <button class="ghost-btn" @click="filterPaid">打款记录</button>
        <button class="rose-btn" :disabled="!pendingCount" @click="onBatchPay">批量打款 ({{ pendingCount }})</button>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi hot-kpi">
        <span class="kpi-num">{{ sum.pending_count }} 笔 / ¥{{ fmt(sum.pending_amount) }}</span>
        <span class="kpi-cap">待审核提现申请</span>
      </div>
      <div class="kpi">
        <span class="kpi-num">¥{{ fmt(sum.available_amount) }}</span>
        <span class="kpi-cap">可提现总额 · 可提现用户 {{ sum.available_users }} 名</span>
      </div>
      <div class="kpi">
        <span class="kpi-num">¥{{ fmt(sum.paid_amount) }}</span>
        <span class="kpi-cap">累计打款 {{ sum.paid_count }} 笔 · 单笔限 ¥{{ fmt(rule.per_txn_limit) }}</span>
      </div>
    </div>

    <div class="card">
      <el-table :data="items" v-loading="loading" style="width: 100%" :header-cell-style="headerStyle" empty-text="暂无提现申请">
        <el-table-column label="申请人" min-width="190">
          <template #default="{ row }">
            <div class="who">
              <span class="who-name">{{ row.user.nickname }}</span>
              <span class="who-sub">ID:{{ row.user.user_id }}<i v-if="row.user.invite_code"> · 邀请码 {{ row.user.invite_code }}</i> · 累计佣金 ¥{{ fmt(row.user.total_commission) }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="提现金额" width="110">
          <template #default="{ row }"><span class="amt">¥{{ fmt(row.amount) }}</span></template>
        </el-table-column>
        <el-table-column label="所属站点" width="90">
          <template #default="{ row }">{{ row.site.name }}</template>
        </el-table-column>
        <el-table-column label="收款方式" width="140">
          <template #default="{ row }">{{ row.channel_label }}<span class="muted"> · 尾号{{ tail(row.user.user_id) }}</span></template>
        </el-table-column>
        <el-table-column label="申请时间" width="110">
          <template #default="{ row }">{{ shortTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="130">
          <template #default="{ row }"><span :class="['st', row.status]">{{ statusText(row) }}</span></template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <template v-if="row.status === 'pending'">
              <a class="op ok" @click.prevent="onApprove(row)">✓ 通过打款</a>
              <a class="op bad" @click.prevent="onReject(row)">✗ 驳回</a>
            </template>
            <a v-else-if="row.status === 'paid'" class="op" @click.prevent="onVoucher">凭证</a>
            <a v-else-if="row.status === 'rejected'" class="op" @click.prevent="onDetail(row)">详情</a>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="notice">
      ⓘ {{ rule.min_amount > 0 ? `起提 ¥${fmt(rule.min_amount)}` : '无起提门槛' }} / {{ rule.fee_rate ? (rule.fee_rate * 100).toFixed(1) + '%' : '0 费率' }} / 单笔限 ¥{{ fmt(rule.per_txn_limit) }} 可在「分销管理 → 佣金与元宝结算配置」调整（决策 6）；C 端提现即时到账（申请即打款），佣金与元宝账户分离，元宝不可提现
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const headerStyle = { background: '#fff6e9', color: '#3d2530', fontWeight: 700 };
const loading = ref(false);
const items = ref([]);
const sum = ref({ pending_count: 0, pending_amount: 0, available_amount: 0, available_users: 0, paid_amount: 0, paid_count: 0 });
const rule = ref({ min_amount: 0, fee_rate: 0, per_txn_limit: 5000 });
const paidOnly = ref(false);

const fmt = (n) => Number(n ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tail = (id) => String(id).slice(-4);
// 2026-10-02 与营销中心券有效期对齐：补年份，避免跨年记录看不出哪年
const shortTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

function statusText(row) {
  if (row.status === 'pending') return '待审核';
  if (row.status === 'paid') return '已打款 · 到账中';
  if (row.status === 'rejected') return `已驳回 · ${row.reject_reason ?? ''}`;
  if (row.status === 'failed') return '打款失败';
  return row.status;
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(body.message ?? '请求失败');
  return body.data;
}

async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams();
    if (paidOnly.value) q.set('status', 'paid');
    const [d, s] = await Promise.all([
      api('/admin/withdraw?' + q.toString()),
      api('/admin/withdraw/summary'),
    ]);
    items.value = d.items;
    sum.value = s;
    rule.value = s.rule ?? rule.value;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function filterPaid() {
  paidOnly.value = !paidOnly.value;
  load();
}

async function onApprove(row) {
  try {
    await ElMessageBox.confirm(`确认向 ${row.user.nickname} 打款 ¥${fmt(row.amount)}？打款通道接通前将标记为已打款。`, '通过打款', { type: 'warning' });
  } catch { return; }
  try {
    await api(`/admin/withdraw/${row.id}/approve`, { method: 'POST' });
    ElMessage.success('已通过并标记打款');
    await load();
  } catch (e) { ElMessage.error(e.message); }
}

async function onReject(row) {
  let reason = '';
  try {
    ({ value: reason } = await ElMessageBox.prompt(`驳回 ${row.user.nickname} 的提现申请（¥${fmt(row.amount)}）`, '驳回', {
      inputPlaceholder: '请填写驳回原因（必填）',
      inputValidator: (v) => (v && v.trim() ? true : '驳回原因不能为空'),
    }));
  } catch { return; }
  try {
    await api(`/admin/withdraw/${row.id}/reject`, { method: 'POST', body: { reason } });
    ElMessage.success('已驳回');
    await load();
  } catch (e) { ElMessage.error(e.message); }
}

async function onBatchPay() {
  const ids = items.value.filter((x) => x.status === 'pending').map((x) => x.id);
  if (!ids.length) return;
  try {
    await ElMessageBox.confirm(`确认批量打款 ${ids.length} 笔待审核申请？`, '批量打款', { type: 'warning' });
  } catch { return; }
  try {
    const d = await api('/admin/withdraw/batch-pay', { method: 'POST', body: { ids } });
    ElMessage.success(`已批量打款 ${d.paid} 笔`);
    await load();
  } catch (e) { ElMessage.error(e.message); }
}

function onVoucher() { ElMessage.info('打款凭证随企业付款到零钱里程碑开放'); }
function onDetail(row) { ElMessage.info(`驳回原因：${row.reject_reason ?? '—'}`); }

onMounted(load);
</script>

<style scoped>
.wd-page { display: flex; flex-direction: column; gap: 14px; }
.head-row { display: flex; align-items: flex-start; justify-content: space-between; }
.title { font-size: 20px; font-weight: 900; color: #3d2530; margin: 0 0 4px; }
.subtitle { font-size: 12px; color: #b08a96; margin: 0; }
.head-btns { display: flex; gap: 10px; }
.ghost-btn {
  background: #fff; border: 1.5px solid #e8b7c8; color: #a31245; cursor: pointer;
  font-size: 12.5px; font-weight: 700; border-radius: 999px; padding: 8px 16px;
}
.ghost-btn:hover { background: #fff6e9; }
.rose-btn {
  background: #e8336d; color: #fff; border: none; cursor: pointer;
  font-size: 12.5px; font-weight: 800; border-radius: 999px; padding: 8px 18px;
}
.rose-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.kpi-row { display: flex; gap: 12px; }
.kpi { flex: 1; background: #fff; border: 1.5px solid #f0dfc8; border-radius: 14px; padding: 14px 18px; }
.kpi.hot-kpi { background: #fbdde9; border-color: #ef9ab8; }
.kpi-num { font-size: 18px; font-weight: 900; color: #3d2530; display: block; margin-bottom: 4px; }
.kpi-cap { font-size: 11.5px; color: #b08a96; }
.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 8px 18px 14px; }
.who { display: flex; flex-direction: column; gap: 2px; }
.who-name { font-weight: 800; color: #3d2530; font-size: 13.5px; }
.who-sub { font-size: 11px; color: #b99aa4; }
.who-sub i { font-style: normal; }
.amt { font-weight: 800; color: #3d2530; }
.muted { color: #b99aa4; }
.st { font-size: 12.5px; font-weight: 700; }
.st.pending { color: #e8336d; }
.st.paid { color: #1a9d5c; }
.st.rejected { color: #999; }
.st.failed { color: #d92648; }
.op { font-size: 12.5px; font-weight: 700; margin-right: 10px; cursor: pointer; color: #a35b76; }
.op.ok { color: #1a9d5c; }
.op.bad { color: #d92648; }
.notice {
  background: #fbdde9; color: #a31245; font-size: 12px; font-weight: 600;
  border-radius: 10px; padding: 9px 14px;
}
</style>
