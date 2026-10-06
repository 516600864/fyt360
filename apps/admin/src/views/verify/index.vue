<template>
  <!-- admin-36 团购核销管理：核销记录（verify_log 真数据）+ 核销员（verify_agent） -->
  <div class="vf-page">
    <div class="head-row">
      <div>
        <h2 class="title">到店团购核销</h2>
        <p class="subtitle">到店团购核销记录 · 核销员权限管理</p>
      </div>
      <button class="rose-btn" @click="onAddAgent">＋ 新增核销员</button>
    </div>

    <div class="stat-row">
      <div class="stat hot">
        <span class="stat-num">{{ sum.today_count }} 张</span>
        <span class="stat-cap">今日核销 · ¥{{ fmt(sum.today_amount) }} 交易额</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ sum.unverified }} 张</span>
        <span class="stat-cap">用户手中未核销团购券</span>
      </div>
      <div class="stat">
        <span class="stat-num">{{ sum.expired_count }} 张</span>
        <span class="stat-cap">过期未核销 · 涉及 ¥{{ fmt(sum.expired_amount) }}</span>
      </div>
    </div>

    <div class="grid">
      <div class="card main-card">
        <el-table :data="logs" v-loading="loading" style="width: 100%" :header-cell-style="headerStyle" empty-text="暂无核销记录">
          <el-table-column label="券码" width="170">
            <template #default="{ row }"><span class="code">{{ row.code }}</span></template>
          </el-table-column>
          <el-table-column label="团购商品" min-width="150">
            <template #default="{ row }">{{ row.goods_title }} <span class="muted">¥{{ fmt(row.pay_price) }}</span></template>
          </el-table-column>
          <el-table-column prop="site_name" label="核销站点" width="120" />
          <el-table-column label="核销员" width="130">
            <template #default="{ row }">{{ row.verifier.name }}<span class="muted"> · ID{{ row.verifier.id }}</span></template>
          </el-table-column>
          <el-table-column label="时间" width="140">
            <template #default="{ row }">{{ hm(row.verified_at) }}</template>
          </el-table-column>
          <el-table-column label="结果" width="90">
            <template #default="{ row }">
              <span :class="row.result === 'success' ? 'ok' : 'bad'">{{ row.result === 'success' ? `成功 ×${row.times}` : '失败' }}</span>
              <div v-if="row.fail_reason" class="muted">{{ row.fail_reason }}</div>
            </template>
          </el-table-column>
        </el-table>
        <div class="foot-bar">
          <span>今日 {{ sum.today_count }} 张 · 核销率 {{ sum.rate }}% · 平均核销时长（出票→到店）{{ sum.avg_days }} 天 · 在编核销员 {{ sum.agent_count }} 名</span>
          <a class="export" @click.prevent="onExport">导出记录</a>
        </div>
      </div>

      <div class="side">
        <div class="card">
          <div class="card-head">
            <span class="card-title">核销员管理</span>
            <button class="mini-btn" @click="onAddAgent">＋ 新增</button>
          </div>
          <div v-if="!agents.length" class="empty-tip">暂无核销员 · 通过邀请码添加 C 端用户（决策 #25④）</div>
          <div v-for="a in agents" :key="a.id" class="agent-row">
            <div>
              <div class="agent-name">{{ a.user.nickname }}<span class="muted">（ID{{ a.user.user_id }}）</span></div>
              <div class="agent-sub">今日 {{ a.today_count }} 张</div>
            </div>
            <div class="agent-right">
              <span class="role-tag" :class="a.role">{{ a.role === 'manager' ? '核销 + 退款' : '仅核销' }}</span>
              <a class="op" @click.prevent="toggleAgent(a)">{{ a.status === 'active' ? '停用' : '启用' }}</a>
            </div>
          </div>
        </div>
        <div class="notice">核销经由进件商户打款 · 短信提醒商家 · 销售可开票说明（决策 #25）</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const headerStyle = { background: '#fff6e9', color: '#3d2530', fontWeight: 700 };
const loading = ref(false);
const sum = ref({ today_count: 0, today_amount: 0, unverified: 0, expired_count: 0, expired_amount: 0, rate: 100, avg_days: 0, agent_count: 0 });
const logs = ref([]);
const agents = ref([]);

const fmt = (n) => Number(n ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 核销时间：YYYY-MM-DD HH:mm（含日期，D先生 指正 2026-10-01） */
const hm = (t) => {
  if (!t) return '—';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

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
    const [s, l, a] = await Promise.all([
      api('/admin/verify/summary'),
      api('/admin/verify/logs'),
      api('/admin/verify/agents'),
    ]);
    sum.value = s;
    logs.value = l.items;
    agents.value = a.agents;
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function onAddAgent() {
  let invite = '';
  let role = 'verifier';
  try {
    ({ value: invite } = await ElMessageBox.prompt('输入核销员邀请码（C 端用户「我的」页可查）', '新增核销员', {
      inputPlaceholder: '如 FYT1a2b3c',
      inputValidator: (v) => (v && v.trim() ? true : '邀请码不能为空'),
    }));
    ({ value: role } = await ElMessageBox.prompt('角色：verifier=仅核销 / manager=核销+退款', '选择角色', {
      inputValue: 'verifier',
      inputValidator: (v) => (['verifier', 'manager'].includes(v.trim()) ? true : 'verifier 或 manager'),
    }));
  } catch { return; }
  try {
    await api('/admin/verify/agents', { method: 'POST', body: { invite_code: invite.trim(), role: role.trim() } });
    ElMessage.success('核销员已添加');
    await load();
  } catch (e) { ElMessage.error(e.message); }
}

async function toggleAgent(a) {
  try {
    await api(`/admin/verify/agents/${a.id}`, { method: 'PATCH', body: { status: a.status === 'active' ? 'disabled' : 'active' } });
    ElMessage.success(a.status === 'active' ? '已停用' : '已启用');
    await load();
  } catch (e) { ElMessage.error(e.message); }
}

async function onExport() {
  try {
    const res = await fetch('/api/admin/verify/logs?size=100');
    const body = await res.json();
    if (!body.ok) throw new Error(body.message);
    const rows = [['券码', '团购商品', '实付', '核销站点', '核销员', '时间', '结果'], ...body.data.items.map((x) => [x.code, x.goods_title, x.pay_price, x.site_name, x.verifier.name, new Date(x.verified_at).toLocaleString('zh-CN'), x.result])];
    const csv = '\ufeff' + rows.map((r) => r.join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const aEl = document.createElement('a');
    aEl.href = url;
    aEl.download = `核销记录-${new Date().toISOString().slice(0, 10)}.csv`;
    aEl.click();
    URL.revokeObjectURL(url);
  } catch (e) { ElMessage.error(e.message); }
}

onMounted(load);
</script>

<style scoped>
.vf-page { display: flex; flex-direction: column; gap: 14px; }
.head-row { display: flex; align-items: flex-start; justify-content: space-between; }
.title { font-size: 20px; font-weight: 900; color: #3d2530; margin: 0 0 4px; }
.subtitle { font-size: 12px; color: #b08a96; margin: 0; }
.rose-btn {
  background: #e8336d; color: #fff; border: none; cursor: pointer;
  font-size: 12.5px; font-weight: 800; border-radius: 999px; padding: 8px 18px;
}
.stat-row { display: flex; gap: 12px; }
.stat { flex: 1; background: #fff; border: 1.5px solid #f0dfc8; border-radius: 14px; padding: 14px 18px; }
.stat.hot { background: #fbdde9; border-color: #ef9ab8; }
.stat-num { font-size: 18px; font-weight: 900; color: #3d2530; display: block; margin-bottom: 4px; }
.stat-cap { font-size: 11.5px; color: #b08a96; }
.grid { display: grid; grid-template-columns: 1fr 320px; gap: 14px; align-items: start; }
@media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 16px 18px; }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.card-title { font-size: 14px; font-weight: 800; color: #3d2530; }
.mini-btn {
  background: #fff; border: 1.5px solid #e8b7c8; color: #a31245; cursor: pointer;
  font-size: 11.5px; font-weight: 700; border-radius: 999px; padding: 4px 12px;
}
.code { font-family: Consolas, monospace; font-weight: 700; color: #a31245; letter-spacing: 0.5px; }
.muted { color: #b99aa4; font-size: 11px; }
.ok { color: #1a9d5c; font-weight: 700; font-size: 12.5px; }
.bad { color: #d92648; font-weight: 700; font-size: 12.5px; }
.foot-bar {
  display: flex; align-items: center; justify-content: space-between;
  background: #fff6e9; border-radius: 10px; padding: 9px 14px; margin-top: 10px;
  font-size: 12px; color: #8a6b50; font-weight: 600;
}
.export { color: #a31245; font-weight: 800; cursor: pointer; }
.side { display: flex; flex-direction: column; gap: 14px; }
.empty-tip { font-size: 12px; color: #b99aa4; padding: 12px 0; }
.agent-row { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px dashed #f3e6d8; }
.agent-row:last-child { border-bottom: none; }
.agent-name { font-size: 13px; font-weight: 700; color: #3d2530; }
.agent-sub { font-size: 11px; color: #b99aa4; margin-top: 2px; }
.agent-right { display: flex; align-items: center; gap: 8px; }
.role-tag { font-size: 10.5px; font-weight: 800; border-radius: 999px; padding: 2px 8px; }
.role-tag.manager { background: #f7c9d8; color: #a31245; }
.role-tag.verifier { background: #eee; color: #888; }
.op { color: #a35b76; font-size: 12px; cursor: pointer; }
.notice { background: #fbdde9; color: #a31245; font-size: 11.5px; font-weight: 600; border-radius: 10px; padding: 9px 14px; }
</style>
