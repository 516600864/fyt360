<template>
  <!-- admin-38 支付商户（画布「支付进件」版式落地）：四 KPI 卡 + 站点凭据明细 + 编辑弹窗。
       诚实偏差：无微信特约商户进件 API，功能 = site_payment 凭据配置管理（mchid/序列号/私钥/APIv3 key/佣金率）。 -->
  <div class="pay-page">
    <div class="head-row">
      <div>
        <h2 class="title">支付商户</h2>
        <p class="subtitle">微信支付站点级凭据 · 商户号/证书序列号/商户私钥/APIv3 密钥 · 佣金率按站点固定</p>
      </div>
      <button class="primary-btn" @click="onNew">
        <el-icon><Plus /></el-icon>
        配置凭据
      </button>
    </div>

    <!-- 四 KPI 卡（画布版式：标签 + 大数 + 小注） -->
    <div class="kpi-row">
      <div v-for="k in kpiCards" :key="k.label" class="kpi-card">
        <div class="kpi-label">{{ k.label }}</div>
        <div class="kpi-value" :style="{ color: k.color }">{{ k.value }}<span class="kpi-unit">{{ k.unit }}</span></div>
        <div class="kpi-note">{{ k.note }}</div>
      </div>
    </div>

    <!-- 配置明细 -->
    <div class="card">
      <div class="card-head">
        <h3 class="card-title">配置明细</h3>
        <span class="card-sub">凭据加密保存于服务端，永不回传原文；编辑时密钥留空即保留原值</span>
      </div>
      <el-table :data="list" v-loading="loading" style="width: 100%" :header-cell-style="headerStyle">
        <el-table-column label="站点" min-width="170">
          <template #default="{ row }">
            <div class="site-cell">
              <span class="site-name">{{ row.site_name }}</span>
              <span class="site-appid">{{ row.appid || '未配置 AppID' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="商户号" min-width="130">
          <template #default="{ row }">
            <span :class="row.configured ? 'mono' : 'muted'">{{ row.mch_masked || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="佣金率" width="90" align="center">
          <template #default="{ row }">
            <span v-if="row.configured">{{ (row.commission_rate * 100).toFixed(2).replace(/\.?0+$/, '') }}%</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="凭据" width="130">
          <template #default="{ row }">
            <span v-if="row.configured" class="cred-chips">
              <span class="cred-chip ok">序列号</span>
              <span class="cred-chip" :class="row.has_key ? 'ok' : 'miss'">APIv3</span>
              <span class="cred-chip" :class="row.has_cert ? 'ok' : 'miss'">私钥</span>
            </span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span class="st" :class="`st-${row.configured ? row.status : 'none'}`">
              <span class="st-dot"></span>{{ row.configured ? (row.status === 'active' ? '已配置' : '已停用') : '未配置' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="配置时间" width="110">
          <template #default="{ row }">{{ row.created_at ? String(row.created_at).slice(0, 10) : '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="right">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" class="op" @click="onEdit(row)">{{ row.configured ? '编辑' : '配置' }}</el-link>
            <template v-if="row.configured">
              <span class="op-sep">·</span>
              <el-link :type="row.status === 'active' ? 'danger' : 'primary'" :underline="false" class="op" @click="onToggle(row)">
                {{ row.status === 'active' ? '停用' : '启用' }}
              </el-link>
            </template>
          </template>
        </el-table-column>
      </el-table>
      <div class="foot-notice">
        回调地址：https://mk.fyt360.cn/api/trade/notify/wxpay —— 需在微信商户平台配置后回调方可送达；凭据保存即时生效，无需重启服务。
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="dlg.visible" :title="dlg.editing ? `编辑凭据 · ${dlg.site_name}` : '配置站点支付凭据'" width="560px" destroy-on-close>
      <el-form label-width="96px" label-position="left">
        <el-form-item label="站点" required>
          <el-select v-model="dlg.site_id" :disabled="dlg.editing" placeholder="选择站点" style="width: 100%">
            <el-option v-for="s in selectableSites" :key="s.site_id" :label="s.site_name" :value="s.site_id" />
          </el-select>
        </el-form-item>
        <el-form-item label="商户号" required>
          <el-input v-model="dlg.form.mch_id" placeholder="微信支付商户号（8~12 位数字）" maxlength="12" />
        </el-form-item>
        <el-form-item label="APIv3 密钥" :required="!dlg.editing">
          <el-input v-model="dlg.form.mch_key" placeholder="32 位；编辑时留空=保留原值" maxlength="32" show-password />
        </el-form-item>
        <el-form-item label="证书序列号" :required="!dlg.editing">
          <el-input v-model="dlg.form.serial_no" placeholder="商户 API 证书序列号；留空=保留原值" />
        </el-form-item>
        <el-form-item label="商户私钥" :required="!dlg.editing">
          <el-input v-model="dlg.form.cert" type="textarea" :rows="5" placeholder="apiclient_key.pem 文件内容（-----BEGIN PRIVATE KEY----- 开头）；留空=保留原值" />
        </el-form-item>
        <el-form-item label="佣金率%" required>
          <el-input-number v-model="dlg.ratePercent" :min="0" :max="100" :step="0.5" :precision="2" style="width: 160px" />
          <span class="rate-hint">到店团购佣金基数 = 实付金额 × 佣金率</span>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="dlg.form.status" active-value="active" inactive-value="disabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';

const loading = ref(false);
const list = ref([]);
const kpis = ref({ total: 0, active: 0, unconfigured: 0, disabled: 0 });

const headerStyle = { background: '#fff6e9', color: '#5c3a4a', fontWeight: 700 };

const kpiCards = computed(() => [
  { label: '站点总数', value: kpis.value.total, unit: '站', color: '#3d2530', note: '权限范围内站点' },
  { label: '已配置商户', value: kpis.value.active, unit: '户', color: '#1f9d61', note: '凭据启用 · 可收款' },
  { label: '未配置', value: kpis.value.unconfigured, unit: '站', color: '#d98b00', note: '待录入商户凭据' },
  { label: '已停用', value: kpis.value.disabled, unit: '站', color: '#d03050', note: '凭据保留 · 支付关闭' },
]);

const selectableSites = computed(() => list.value.filter((x) => !x.configured || x.site_id === dlg.site_id));
const currentRow = computed(() => list.value.find((x) => x.site_id === dlg.site_id));

async function api(path, opts = {}) {
  const headers = { Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token'), ...(opts.headers ?? {}) };
  const r = await fetch('/api' + path, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.message || '请求失败');
  return j.data;
}

async function load() {
  loading.value = true;
  try {
    const d = await api('/admin/payment/overview');
    kpis.value = d.kpis;
    list.value = d.list;
  } catch (e) {
    ElMessage.error(e.message ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

const dlg = reactive({
  visible: false, editing: false, saving: false,
  site_id: '', site_name: '', ratePercent: 20,
  form: { mch_id: '', mch_key: '', serial_no: '', cert: '', status: 'active' },
});

function onNew() {
  const first = list.value.find((x) => !x.configured);
  if (!first) { ElMessage.info('权限范围内站点均已配置'); return; }
  dlg.editing = false;
  dlg.site_id = first.site_id;
  dlg.site_name = first.site_name;
  dlg.ratePercent = 20;
  dlg.form = { mch_id: '', mch_key: '', serial_no: '', cert: '', status: 'active' };
  dlg.visible = true;
}

function onEdit(row) {
  dlg.editing = true;
  dlg.site_id = row.site_id;
  dlg.site_name = row.site_name;
  dlg.ratePercent = row.configured ? Math.round(row.commission_rate * 10000) / 100 : 20;
  dlg.form = {
    mch_id: row.mch_id ?? '',
    mch_key: '',
    serial_no: '',
    cert: '',
    status: row.status ?? 'active',
  };
  dlg.visible = true;
}

async function onToggle(row) {
  const next = row.status === 'active' ? 'disabled' : 'active';
  const action = next === 'disabled' ? '停用' : '启用';
  try {
    await ElMessageBox.confirm(`确认${action}「${row.site_name}」的微信支付？停用后该站团购订单将无法发起支付。`, `${action}支付`, { type: 'warning' });
  } catch { return; }
  try {
    await api(`/admin/payment/${row.site_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-fyt-site': row.site_code },
      body: JSON.stringify({ status: next }),
    });
    ElMessage.success(`已${action}`);
    load();
  } catch (e) {
    ElMessage.error(e.message ?? `${action}失败`);
  }
}

async function onSave() {
  const row = currentRow.value;
  const siteId = dlg.site_id;
  if (!siteId) { ElMessage.warning('请选择站点'); return; }
  if (!/^\d{8,12}$/.test(dlg.form.mch_id)) { ElMessage.warning('商户号须为 8~12 位数字'); return; }
  if (!dlg.editing || dlg.form.mch_key) {
    if (!/^[0-9A-Za-z]{32}$/.test(dlg.form.mch_key)) { ElMessage.warning('APIv3 密钥须为 32 位字母数字'); return; }
  }
  if ((!dlg.editing || dlg.form.serial_no) && !/^[0-9A-Za-z-]{8,64}$/.test(dlg.form.serial_no)) { ElMessage.warning('证书序列号格式不正确'); return; }
  if ((!dlg.editing || dlg.form.cert) && !dlg.form.cert.includes('PRIVATE KEY')) { ElMessage.warning('商户私钥须粘贴 apiclient_key.pem 原文'); return; }

  const body = {
    mch_id: dlg.form.mch_id,
    commission_rate: Math.round(dlg.ratePercent * 100) / 10000,
    status: dlg.form.status,
  };
  if (dlg.form.mch_key) body.mch_key = dlg.form.mch_key;
  if (dlg.form.serial_no) body.serial_no = dlg.form.serial_no;
  if (dlg.form.cert) body.cert = dlg.form.cert;

  dlg.saving = true;
  try {
    await api(`/admin/payment/${siteId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-fyt-site': row?.site_code ?? '' },
      body: JSON.stringify(body),
    });
    ElMessage.success(dlg.editing ? '凭据已更新' : '凭据已保存');
    dlg.visible = false;
    load();
  } catch (e) {
    ElMessage.error(e.message ?? '保存失败');
  } finally {
    dlg.saving = false;
  }
}

onMounted(load);
</script>

<style scoped>
.pay-page { display: flex; flex-direction: column; gap: 16px; }

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

/* —— 四 KPI 卡（画布版式） —— */
.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.kpi-card {
  background: #fff; border: 1.5px solid #f0dfc8; border-radius: 14px;
  padding: 14px 18px;
}
.kpi-label { font-size: 12px; color: #a08592; font-weight: 600; }
.kpi-value { margin-top: 6px; font-size: 26px; font-weight: 900; line-height: 1.1; }
.kpi-unit { font-size: 13px; font-weight: 700; margin-left: 3px; }
.kpi-note { margin-top: 5px; font-size: 11.5px; color: #c5b3a4; }

.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 16px 18px; }
.card-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; }
.card-title { margin: 0; font-size: 17px; font-weight: 900; color: #3d2530; }
.card-sub { font-size: 12px; color: #c5b3a4; }

.site-cell { display: flex; flex-direction: column; gap: 2px; }
.site-name { font-weight: 800; color: #3d2530; }
.site-appid { font-size: 11.5px; color: #a08592; font-family: Consolas, monospace; }
.mono { font-family: Consolas, monospace; font-weight: 700; color: #3d2530; }
.muted { color: #c5b3a4; }

.cred-chips { display: flex; gap: 4px; }
.cred-chip {
  font-size: 10.5px; font-weight: 800; border-radius: 6px; padding: 1px 7px; white-space: nowrap;
}
.cred-chip.ok { background: #e6f6ee; color: #1f9d61; }
.cred-chip.miss { background: #fde3ec; color: #d03050; }

.st { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
.st-dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
.st-active .st-dot { background: #1f9d61; }
.st-active { color: #1f9d61; }
.st-disabled .st-dot { background: #d03050; }
.st-disabled { color: #d03050; }
.st-none .st-dot { background: #c5b3a4; }
.st-none { color: #a08592; }

.op-sep { color: #d9c2ae; margin: 0 4px; }

.foot-notice {
  margin-top: 12px;
  background: #fff6e9; color: #a3691b; border-radius: 10px;
  font-size: 12px; padding: 10px 14px; line-height: 1.6;
}

.rate-hint { margin-left: 10px; font-size: 11.5px; color: #c5b3a4; }
</style>
