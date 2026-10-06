<template>
  <div class="page">
    <div class="head">
      <div>
        <h2 class="title">会员管理</h2>
        <p class="sub">全站用户 360 视图：等级 / 元宝 / 订单 / 佣金 / 核销员</p>
      </div>
      <div class="head-badges">
        <span class="verifier-chip" :class="{ on: filterVerifier }" @click="toggleVerifier">
          <el-icon><Stamp /></el-icon>核销员 {{ meta.verifiers }} 人
        </span>
      </div>
    </div>

    <!-- 筛选行 -->
    <div class="filter-card">
      <div class="filter-row">
        <span class="filter-label">搜索</span>
        <el-input
          v-model="filterQ"
          placeholder="用户ID / 昵称 / openid / 邀请码"
          size="small"
          style="width: 240px"
          clearable
          @keyup.enter="applyFilter"
        />
        <span class="filter-label">状态</span>
        <el-select v-model="filterStatus" placeholder="全部" size="small" style="width: 110px" clearable>
          <el-option label="正常" value="active" />
          <el-option label="已禁用" value="banned" />
        </el-select>
        <span class="filter-label">等级</span>
        <el-select v-model="filterLevel" placeholder="全部" size="small" style="width: 150px" clearable>
          <el-option v-for="l in LEVELS" :key="l.code" :label="`${l.code} ${l.name}`" :value="l.code" />
        </el-select>
        <el-button size="small" type="primary" @click="applyFilter">查询</el-button>
        <el-button size="small" @click="resetFilter">重置</el-button>
      </div>
    </div>

    <!-- 用户表（8 列） -->
    <div class="table-card">
      <el-table :data="items" v-loading="loading" :header-cell-style="headerStyle" size="default">
        <el-table-column label="用户" min-width="170">
          <template #default="{ row }">
            <div class="user-cell">
              <span class="avatar">{{ (row.nickname || '?').slice(0, 1) }}</span>
              <div class="user-meta">
                <span class="nick">{{ row.nickname }}</span>
                <span class="uid">ID {{ row.user_id }}<template v-if="row.invite_code"> · {{ row.invite_code }}</template></span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="等级" width="110">
          <template #default="{ row }">
            <span class="lv" :class="`lv-${row.level}`">{{ row.level }} {{ row.level_name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="站点" width="120">
          <template #default="{ row }">{{ row.site_name }}</template>
        </el-table-column>
        <el-table-column label="元宝" width="90" align="right">
          <template #default="{ row }"><span class="ingot">{{ fmt(row.ingot_balance) }}</span></template>
        </el-table-column>
        <el-table-column label="订单" width="70" align="right">
          <template #default="{ row }">{{ row.order_count }}</template>
        </el-table-column>
        <el-table-column label="佣金" width="90" align="right">
          <template #default="{ row }">¥{{ fmt2(row.commission_total) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <span class="st" :class="{ banned: row.status === 'banned' }">{{ row.status === 'banned' ? '已禁用' : '正常' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="openDrawer(row)">详情</el-link>
            <el-link
              v-if="row.status === 'banned'"
              type="success" :underline="false" style="margin-left: 12px"
              @click="toggleBan(row, 'active')"
            >启用</el-link>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          layout="prev, pager, next"
          :total="total"
          :page-size="size"
          :current-page="page"
          @current-change="onPage"
        />
      </div>

      <!-- 红线汇总条（钉死表尾） -->
      <div class="redline">
        <el-icon><WarningFilled /></el-icon>
        <span>红线：元宝调账一律走「流水补记」留痕（ADMIN_ADJUST + 审计日志），<strong>禁止直接改余额</strong>；禁用即时拦截静默登录。</span>
      </div>
    </div>

    <!-- ============ 39B 用户详情抽屉 ============ -->
    <el-drawer v-model="drawer" size="640px" :with-header="false" destroy-on-close>
      <div v-if="detail" class="dw">
        <!-- 头部 -->
        <div class="dw-head">
          <span class="dw-avatar">{{ (detail.nickname || '?').slice(0, 1) }}</span>
          <div class="dw-id">
            <p class="dw-nick">
              {{ detail.nickname }}
              <span class="lv" :class="`lv-${detail.level}`">{{ detail.level }} {{ detail.level_name }}</span>
              <span v-if="detail.is_verifier" class="vbadge"><el-icon><Stamp /></el-icon>核销员</span>
            </p>
            <p class="dw-ids">ID {{ detail.user_id }} · 邀请码 {{ detail.invite_code || '—' }}</p>
            <p class="dw-ids dim">openid {{ detail.openid || '—' }}</p>
            <p class="dw-ids dim">unionid {{ detail.unionid || '—' }}</p>
          </div>
        </div>

        <!-- 标签行 -->
        <div class="dw-tags">
          <span class="tag">{{ detail.site_name }}</span>
          <span class="tag">注册 {{ fmtDay(detail.created_at) }}</span>
          <span class="tag" :class="{ warn: detail.status === 'banned' }">{{ detail.status === 'banned' ? '已禁用' : '正常' }}</span>
        </div>

        <!-- 统计四宫格 -->
        <div class="dw-stats">
          <div class="stat"><p class="v">{{ fmt(detail.stats.ingot_balance) }}</p><p class="k">元宝余额</p></div>
          <div class="stat"><p class="v">{{ detail.stats.order_count }}</p><p class="k">累计订单</p></div>
          <div class="stat"><p class="v">¥{{ fmt2(detail.stats.commission_total) }}</p><p class="k">累计佣金</p></div>
          <div class="stat"><p class="v">{{ detail.stats.team_size }}</p><p class="k">团队规模</p></div>
        </div>

        <!-- 四域页签 -->
        <el-tabs v-model="dwTab" class="dw-tabs" @tab-change="onDwTab">
          <el-tab-pane label="订单" name="orders">
            <div v-for="o in domain.orders" :key="o.order_sn" class="line-item">
              <div class="li-main">
                <p class="li-title">{{ o.goods_title || '—' }}</p>
                <p class="li-sub">{{ o.order_sn }} · {{ fmtDay(o.created_at) }}</p>
              </div>
              <div class="li-side">
                <p class="li-amount">¥{{ fmt2(o.pay_price) }}</p>
                <p class="li-st">{{ orderStatus(o) }}</p>
              </div>
            </div>
            <el-button v-if="domain.orders.length >= domainOrders.size" link size="small" @click="loadOrders(detail.user_id, true)">加载更多</el-button>
            <p v-if="!domain.orders.length" class="empty">暂无订单</p>
          </el-tab-pane>

          <el-tab-pane label="元宝流水" name="txs">
            <div v-for="t in domain.txs" :key="t.tx_id ?? t.ref_id + t.created_at" class="line-item">
              <div class="li-main">
                <p class="li-title">{{ txLabel(t.type) }}<template v-if="t.remark"> · {{ t.remark }}</template></p>
                <p class="li-sub">{{ fmtDay(t.created_at) }}</p>
              </div>
              <div class="li-side">
                <p class="li-amount" :class="{ plus: t.amount > 0 }">{{ t.amount > 0 ? '+' : '' }}{{ t.amount }}</p>
                <p class="li-st">余 {{ t.balance_after }}</p>
              </div>
            </div>
            <el-button v-if="domain.txs.length >= domainTxs.size" link size="small" @click="loadTxs(detail.user_id, true)">加载更多</el-button>
            <p v-if="!domain.txs.length" class="empty">暂无流水</p>
          </el-tab-pane>

          <el-tab-pane label="券包" name="coupons">
            <div v-for="c in domain.coupons" :key="c.id" class="line-item">
              <div class="li-main">
                <p class="li-title">{{ c.name }}</p>
                <p class="li-sub">领取 {{ fmtDay(c.received_at) }}<template v-if="c.used_order_id"> · 已用于订单</template></p>
              </div>
              <div class="li-side">
                <p class="li-amount">¥{{ fmt2(c.amount) }}</p>
                <p class="li-st">{{ couponStatus(c.status) }}</p>
              </div>
            </div>
            <el-button v-if="domain.coupons.length >= domainCoupons.size" link size="small" @click="loadCoupons(detail.user_id, true)">加载更多</el-button>
            <p v-if="!domain.coupons.length" class="empty">暂无券</p>
          </el-tab-pane>

          <el-tab-pane label="核销记录" name="verifies">
            <div v-for="v in domain.verifies" :key="v.id" class="line-item">
              <div class="li-main">
                <p class="li-title">核销 #{{ v.order_id }} × {{ v.times }}</p>
                <p class="li-sub">{{ fmtDay(v.verified_at) }}<template v-if="v.fail_reason"> · {{ v.fail_reason }}</template></p>
              </div>
              <div class="li-side">
                <p class="li-st" :class="{ warn: v.result !== 'success' }">{{ v.result === 'success' ? '成功' : '失败' }}</p>
              </div>
            </div>
            <el-button v-if="domain.verifies.length >= domainVerifies.size" link size="small" @click="loadVerifies(detail.user_id, true)">加载更多</el-button>
            <p v-if="!domain.verifies.length" class="empty">暂无核销记录</p>
          </el-tab-pane>
        </el-tabs>

        <!-- 风控与运营操作区 -->
        <div class="dw-ops">
          <p class="ops-title">风控与运营操作</p>
          <div class="ops-row">
            <el-button size="small" type="primary" plain @click="openAdjust">元宝调账</el-button>
            <el-button size="small" plain @click="openCodes">重发券码</el-button>
            <el-button size="small" type="warning" plain @click="onDeregister">处理注销</el-button>
            <el-button
              size="small" :type="detail.status === 'banned' ? 'success' : 'danger'" plain
              @click="toggleBan(detail, detail.status === 'banned' ? 'active' : 'banned')"
            >{{ detail.status === 'banned' ? '启用账号' : '禁用账号' }}</el-button>
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- 元宝调账弹窗 -->
    <el-dialog v-model="adjustVisible" title="元宝调账（流水补记留痕）" width="420px">
      <el-form label-width="86px" size="small">
        <el-form-item label="调整额度">
          <el-input-number v-model="adjustAmount" :step="100" :max="1000000" :min="-1000000" style="width: 100%" />
          <p class="form-hint">正数发放，负数扣减；扣减不可超过当前余额（{{ detail ? fmt(detail.stats.ingot_balance) : 0 }}）</p>
        </el-form-item>
        <el-form-item label="调账原因">
          <el-input v-model="adjustRemark" type="textarea" :rows="2" placeholder="必填，将写入元宝流水与操作审计日志" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="adjustVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="busy" @click="submitAdjust">确认调账</el-button>
      </template>
    </el-dialog>

    <!-- 重发券码弹窗 -->
    <el-dialog v-model="codesVisible" title="核销券码（重发）" width="520px">
      <p class="codes-hint">券码由系统确定性生成（GC+订单号），码值不变；用户丢失时把下方码重新告知即可复制重发。</p>
      <div v-for="c in codes" :key="c.coupon_id" class="code-row">
        <div class="li-main">
          <p class="li-title"><span class="sn">{{ c.code }}</span> {{ c.goods_title }}</p>
          <p class="li-sub">核销 {{ c.used_times }}/{{ c.total_times }} · 有效至 {{ fmtDay(c.expire_at) }}</p>
        </div>
        <el-button size="small" link type="primary" @click="copyCode(c.code)">复制</el-button>
      </div>
      <p v-if="!codes.length" class="empty">该用户暂无团购核销券码</p>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Stamp, WarningFilled } from '@element-plus/icons-vue';

const LEVELS = [
  { code: 'L1', name: '省心会员' },
  { code: 'L2', name: '返利会员' },
  { code: 'L3', name: '合伙人' },
];
const TX_LABELS = {
  ORDER_REBATE: '订单返元宝', INVITE_REWARD: '邀请奖励', LEVEL_EXCHANGE: '等级兑换',
  REFUND_DEDUCT: '退款扣回', ADMIN_ADJUST: '管理员调账',
};
const headerStyle = { background: '#fff6e9', color: '#5c3a4a', fontWeight: 700 };

const items = ref([]);
const total = ref(0);
const meta = ref({ verifiers: 0, banned_cnt: 0 });
const loading = ref(false);
const page = ref(1);
const size = 20;
const filterQ = ref('');
const filterStatus = ref('');
const filterLevel = ref('');
const filterVerifier = ref(false);
const applied = reactive({ q: '', status: '', level: '', verifier: false });

const drawer = ref(false);
const detail = ref(null);
const dwTab = ref('orders');
const domain = reactive({ orders: [], txs: [], coupons: [], verifies: [] });
const domainOrders = reactive({ page: 0, size: 10 });
const domainTxs = reactive({ page: 0, size: 10 });
const domainCoupons = reactive({ page: 0, size: 10 });
const domainVerifies = reactive({ page: 0, size: 10 });
const adjustVisible = ref(false);
const adjustAmount = ref(0);
const adjustRemark = ref('');
const codesVisible = ref(false);
const codes = ref([]);
const busy = ref(false);

async function api(path, opts) {
  const r = await fetch('/api' + path, {
    headers: { Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token'), 'Content-Type': 'application/json' },
    ...opts,
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.message || '请求失败');
  return j.data;
}

const fmt = (n) => Number(n ?? 0).toLocaleString('zh-CN');
const fmt2 = (n) => Number(n ?? 0).toFixed(2);
const fmtDay = (t) => (t ? new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const txLabel = (t) => TX_LABELS[t] ?? t;
const couponStatus = (s) => ({ unused: '未使用', used: '已使用', expired: '已过期' }[s] ?? s);

function orderStatus(o) {
  if (o.refund_status === 'applying') return '退款审核中';
  if (o.refund_status === 'refunded') return '已退款';
  if (o.fulfill_status === 'verified') return '已核销';
  if (o.platform_status === 'settled') return '已结算';
  if (o.platform_status === 'paid') return '已付款';
  if (o.platform_status === 'closed') return '已关闭';
  return '待支付';
}

function buildQuery(extra = {}) {
  const qs = new URLSearchParams({
    page: String(page.value), size: String(size),
    q: applied.q, status: applied.status, level: applied.level,
    verifier: applied.verifier ? '1' : '', ...extra,
  });
  return qs.toString().replace(/&[a-z]+=&/g, '&').replace(/[?&]+$/, '');
}

async function load() {
  loading.value = true;
  try {
    const d = await api(`/admin/members?${buildQuery()}`);
    items.value = d.items;
    total.value = d.total;
    meta.value = { verifiers: d.verifiers, banned_cnt: d.banned_cnt };
  } catch (e) {
    ElMessage.error(e.message ?? '会员加载失败');
  } finally {
    loading.value = false;
  }
}

function applyFilter() {
  applied.q = filterQ.value.trim();
  applied.status = filterStatus.value ?? '';
  applied.level = filterLevel.value ?? '';
  page.value = 1;
  load();
}
function resetFilter() {
  filterQ.value = ''; filterStatus.value = ''; filterLevel.value = ''; filterVerifier.value = false;
  applyFilter();
}
function toggleVerifier() {
  filterVerifier.value = !filterVerifier.value;
  applyFilter();
}
function onPage(p) { page.value = p; load(); }

/* ---------- 39B 抽屉 ---------- */
async function openDrawer(row) {
  try {
    detail.value = await api(`/admin/members/${row.user_id}`);
    drawer.value = true;
    dwTab.value = 'orders';
    domain.orders = []; domain.txs = []; domain.coupons = []; domain.verifies = [];
    domainOrders.page = 0; domainTxs.page = 0; domainCoupons.page = 0; domainVerifies.page = 0;
    loadOrders(row.user_id);
  } catch (e) { ElMessage.error(e.message); }
}

/** 四域页签懒加载：首次切到某页签才拉数据 */
function onDwTab(tab) {
  if (!detail.value) return;
  const uid = detail.value.user_id;
  if (tab === 'orders' && !domainOrders.page) loadOrders(uid);
  else if (tab === 'txs' && !domainTxs.page) loadTxs(uid);
  else if (tab === 'coupons' && !domainCoupons.page) loadCoupons(uid);
  else if (tab === 'verifies' && !domainVerifies.page) loadVerifies(uid);
}

async function loadOrders(uid, more = false) {
  try {
    const p = more ? domainOrders.page + 1 : 1;
    const d = await api(`/admin/members/${uid}/orders?page=${p}&size=${domainOrders.size}`);
    domain.orders = more ? domain.orders.concat(d.items) : d.items;
    domainOrders.page = p;
  } catch (e) { ElMessage.error(e.message); }
}
async function loadTxs(uid, more = false) {
  try {
    const p = more ? domainTxs.page + 1 : 1;
    const d = await api(`/admin/members/${uid}/txs?page=${p}&size=${domainTxs.size}`);
    domain.txs = more ? domain.txs.concat(d.items) : d.items;
    domainTxs.page = p;
  } catch (e) { ElMessage.error(e.message); }
}
async function loadCoupons(uid, more = false) {
  try {
    const p = more ? domainCoupons.page + 1 : 1;
    const d = await api(`/admin/members/${uid}/coupons?page=${p}&size=${domainCoupons.size}`);
    domain.coupons = more ? domain.coupons.concat(d.items) : d.items;
    domainCoupons.page = p;
  } catch (e) { ElMessage.error(e.message); }
}
async function loadVerifies(uid, more = false) {
  try {
    const p = more ? domainVerifies.page + 1 : 1;
    const d = await api(`/admin/members/${uid}/verifies?page=${p}&size=${domainVerifies.size}`);
    domain.verifies = more ? domain.verifies.concat(d.items) : d.items;
    domainVerifies.page = p;
  } catch (e) { ElMessage.error(e.message); }
}

async function openAdjust() {
  adjustAmount.value = 0;
  adjustRemark.value = '';
  adjustVisible.value = true;
}
async function submitAdjust() {
  if (!adjustRemark.value.trim()) { ElMessage.warning('调账原因必填（留痕）'); return; }
  if (!adjustAmount.value) { ElMessage.warning('调整额度不能为 0'); return; }
  busy.value = true;
  try {
    const d = await api(`/admin/members/${detail.value.user_id}/adjust`, {
      method: 'POST',
      body: JSON.stringify({ amount: adjustAmount.value, remark: adjustRemark.value.trim() }),
    });
    ElMessage.success(`调账成功，余额 ${fmt(d.balance_after)}`);
    adjustVisible.value = false;
    detail.value = await api(`/admin/members/${detail.value.user_id}`);
    load();
  } catch (e) { ElMessage.error(e.message); } finally { busy.value = false; }
}

async function openCodes() {
  try {
    const d = await api(`/admin/members/${detail.value.user_id}/codes`);
    codes.value = d.items;
    codesVisible.value = true;
  } catch (e) { ElMessage.error(e.message); }
}
function copyCode(code) {
  navigator.clipboard?.writeText(code);
  ElMessage.success(`已复制 ${code}`);
}

async function onDeregister() {
  try {
    await ElMessageBox.confirm(
      '注销 = 匿名化资料（昵称置「已注销用户」、清空 openid/unionid）并禁用账号，不可恢复。确定？',
      '处理注销', { type: 'warning', confirmButtonText: '确认注销', cancelButtonText: '取消' },
    );
  } catch { return; }
  busy.value = true;
  try {
    await api(`/admin/members/${detail.value.user_id}/deregister`, { method: 'POST', body: JSON.stringify({}) });
    ElMessage.success('已注销并禁用');
    detail.value = await api(`/admin/members/${detail.value.user_id}`);
    load();
  } catch (e) { ElMessage.error(e.message); } finally { busy.value = false; }
}

async function toggleBan(row, status) {
  const toBan = status === 'banned';
  try {
    await ElMessageBox.confirm(
      toBan ? '禁用后该账号静默登录将被即时拦截。确定？' : '解除禁用，恢复正常登录。确定？',
      toBan ? '禁用账号' : '启用账号', { type: 'warning' },
    );
  } catch { return; }
  try {
    await api(`/admin/members/${row.user_id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    ElMessage.success(toBan ? '已禁用' : '已启用');
    if (detail.value && detail.value.user_id === row.user_id) detail.value.status = status;
    row.status = status;
    load();
  } catch (e) { ElMessage.error(e.message); }
}

onMounted(load);
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 14px; }
.head { display: flex; justify-content: space-between; align-items: flex-end; }
.title { font-size: 20px; font-weight: 900; color: #2b2b33; margin: 0; }
.sub { font-size: 12.5px; color: #8c8577; margin: 4px 0 0; }
.verifier-chip {
  display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
  font-size: 12.5px; font-weight: 700; color: #8c8577;
  background: #fff; border: 1.5px solid #e8b88a; border-radius: 999px; padding: 6px 14px;
}
.verifier-chip.on { color: #fff; background: #e8336d; border-color: #e8336d; }

.filter-card, .table-card {
  background: #fff; border: 2px solid #2b2420; border-radius: 14px; padding: 14px 16px;
  box-shadow: 4px 4px 0 rgba(43, 36, 32, 0.12);
}
.filter-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.filter-label { font-size: 12.5px; font-weight: 700; color: #5c3a4a; }

.user-cell { display: flex; align-items: center; gap: 9px; }
.avatar {
  width: 32px; height: 32px; border-radius: 50%; flex: none;
  background: linear-gradient(145deg, #e8336d, #c21a56); color: #fff;
  font-size: 14px; font-weight: 800; display: flex; align-items: center; justify-content: center;
}
.user-meta { display: flex; flex-direction: column; min-width: 0; }
.nick { font-weight: 700; color: #2b2b33; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uid { font-size: 11px; color: #b9b0a0; }

.lv { font-size: 11px; font-weight: 800; border-radius: 999px; padding: 2px 9px; }
.lv-L1 { background: #f2f0eb; color: #8c8577; }
.lv-L2 { background: #fff0f5; color: #e8336d; }
.lv-L3 { background: linear-gradient(120deg, #ffaa1d, #e8336d); color: #fff; }
.ingot { color: #e8336d; font-weight: 800; }
.st { color: #3d9a50; font-weight: 700; font-size: 12.5px; }
.st.banned { color: #c5b3a4; text-decoration: line-through; }

.pager { display: flex; justify-content: flex-end; padding: 12px 0 0; }
.redline {
  margin-top: 12px; display: flex; align-items: center; gap: 8px;
  background: #fff6e9; border: 1.5px dashed #e8b88a; border-radius: 10px;
  padding: 9px 14px; font-size: 12.5px; color: #8c5a2b;
}
.redline strong { color: #a31245; }

/* ---------- 抽屉（39B） ---------- */
.dw { display: flex; flex-direction: column; height: 100%; gap: 14px; }
.dw-head { display: flex; gap: 14px; }
.dw-avatar {
  width: 56px; height: 56px; border-radius: 50%; flex: none;
  background: linear-gradient(145deg, #e8336d, #c21a56); color: #fff;
  font-size: 24px; font-weight: 900; display: flex; align-items: center; justify-content: center;
}
.dw-nick { font-size: 17px; font-weight: 900; color: #2b2b33; margin: 0; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.dw-ids { font-size: 12px; color: #5c3a4a; margin: 3px 0 0; font-family: Consolas, monospace; word-break: break-all; }
.dw-ids.dim { color: #b9b0a0; }
.vbadge {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; font-weight: 800; color: #fff; background: #ffaa1d;
  border-radius: 999px; padding: 2px 9px;
}
.dw-tags { display: flex; gap: 7px; flex-wrap: wrap; }
.tag { font-size: 11.5px; background: #fff0f5; color: #a31245; border-radius: 999px; padding: 3px 11px; font-weight: 700; }
.tag.warn { background: #fdf0e9; color: #c25a1a; }
.dw-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; }
.stat {
  background: #fff6e9; border: 2px solid #2b2420; border-radius: 12px;
  padding: 11px 8px; text-align: center; box-shadow: 3px 3px 0 rgba(43, 36, 32, 0.12);
}
.stat .v { font-size: 16px; font-weight: 900; color: #e8336d; margin: 0; }
.stat .k { font-size: 11px; color: #8c8577; margin: 3px 0 0; }
.dw-tabs { flex: 1; min-height: 0; }
.line-item {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  padding: 9px 2px; border-bottom: 1px dashed #f2ddc0;
}
.li-main { min-width: 0; }
.li-title { font-size: 13px; font-weight: 700; color: #2b2b33; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.li-sub { font-size: 11.5px; color: #b9b0a0; margin: 3px 0 0; }
.li-side { text-align: right; flex: none; }
.li-amount { font-size: 13px; font-weight: 800; color: #2b2b33; margin: 0; }
.li-amount.plus { color: #3d9a50; }
.li-st { font-size: 11px; color: #8c8577; margin: 3px 0 0; }
.li-st.warn { color: #c25a1a; }
.empty { text-align: center; color: #c5b3a4; font-size: 12.5px; padding: 26px 0; }

.dw-ops { border-top: 2px dashed #f2ddc0; padding-top: 12px; }
.ops-title { font-size: 13px; font-weight: 800; color: #5c3a4a; margin: 0 0 9px; }
.ops-row { display: flex; gap: 9px; flex-wrap: wrap; }
.form-hint { font-size: 11.5px; color: #b9b0a0; margin: 4px 0 0; }
.codes-hint { font-size: 12px; color: #8c8577; margin: 0 0 10px; }
.code-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 2px; border-bottom: 1px dashed #f2ddc0; }
.sn { font-family: Consolas, monospace; font-weight: 800; color: #a31245; margin-right: 6px; }
</style>
