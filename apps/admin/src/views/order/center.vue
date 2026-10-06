<template>
  <!-- admin-32 订单中心：标题区 + 状态胶囊 tab + 聚合订单表 + CPS 佣金口径 notice -->
  <div class="order-center">
    <div class="head-row">
      <div>
        <h2 class="title">订单中心</h2>
        <p class="subtitle">全平台聚合 · 可按站点筛选 · CPS 供应链各平台同步展示（含归因脱敏）</p>
      </div>
      <div class="head-actions">
        <button class="ghost-btn" @click="onExport">
          <el-icon><Download /></el-icon>
          导出对账单
        </button>
      </div>
    </div>

    <!-- ========== admin-32B 筛选台：三行常驻展开（不再藏进下拉） ==========
         设计稿 6 条诊断的落点：
         ① 可视性：5 个筛选全藏下拉 → 三行常驻，页面默认可见
         ② 条件回显：筛完不知道生效了什么 → chip 逐条回显 + 单条 ✕
         ③ 类型粒度：4 组 13 项 → 6 组 15 项多选（带当前范围单数角标）
         ④ 死选项：待发货/已发货恒 0 条 → 移除，状态按支付/履约/退款 3 段
         ⑤ 时间：没说筛哪个时间 → 三口径并列 + 默认下单时间（决策 #42）
         ⑥ 生效方式：必须点「应用」 → 即时生效，取消该按钮
    -->
    <div class="filter-bar">
      <!-- 第 1 行：时间 -->
      <div class="fb-row">
        <span class="fb-label">时间</span>
        <div class="time-quick">
          <button
            v-for="q in TIME_QUICK"
            :key="q.key"
            class="q-pill"
            :class="{ active: quick === q.key }"
            @click="onQuick(q.key)"
          >
            {{ q.label }}
          </button>
        </div>
        <el-date-picker
          v-model="filterDate"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          value-format="YYYY-MM-DD"
          size="small"
          style="width: 230px"
          :disabled="quick !== 'custom'"
          @change="onDateChange"
        />
        <span class="fb-hint">{{ TIME_FIELDS[filterTimeField].hint }}</span>
      </div>

      <!-- 第 2 行：口径 + 维度 -->
      <div class="fb-row">
        <span class="fb-label">口径</span>
        <div class="time-quick">
          <button
            v-for="t in TIME_FIELD_LIST"
            :key="t.key"
            class="q-pill"
            :class="{ active: filterTimeField === t.key }"
            :title="t.hint"
            @click="onTimeField(t.key)"
          >
            {{ t.label }}
          </button>
        </div>

        <span class="fb-label fb-label-gap">维度</span>
        <el-select v-if="isPlatform" v-model="filterSite" placeholder="站点：全部" size="small" style="width: 140px" @change="reload">
          <el-option v-for="s in siteOptions" :key="s.code" :label="s.name" :value="s.code" />
        </el-select>
        <el-select
          v-model="filterPay"
          multiple
          collapse-tags
          collapse-tags-tooltip
          placeholder="支付：全部"
          size="small"
          style="width: 150px"
          @change="reload"
        >
          <el-option v-for="p in PAY_OPTIONS" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
        <el-input
          v-model="filterKeyword"
          placeholder="订单号 / 供应商单号 / 商品 / 用户"
          size="small"
          style="width: 230px"
          clearable
          @keyup.enter="reload"
          @clear="reload"
        />
      </div>

      <!-- 第 3 行：类型多选（6 组）+ 状态多选（3 段），均在面板内常驻展开 -->
      <div class="fb-row fb-row-panel">
        <!-- 类型 -->
        <div class="fb-block">
          <div class="fb-block-head">
            <span class="fb-label fb-label-plain">类型</span>
            <span class="fb-sub">已选 {{ filterTypes.length }} 项</span>
            <div class="fb-head-actions">
              <button class="link-btn" @click="selectAllTypes">全选</button>
              <span class="link-sep">/</span>
              <button class="link-btn" @click="filterTypes = []; reload()">清空</button>
            </div>
          </div>
          <div class="type-groups">
            <div v-for="g in visibleTypeGroups" :key="g.key" class="type-group">
              <p class="tg-label">{{ g.label }}<span class="tg-count">{{ g.items.length }}</span></p>
              <div class="tg-items">
                <button
                  v-for="it in g.items"
                  :key="it.value"
                  class="opt-chip"
                  :class="{ active: filterTypes.includes(it.value), dead: !it.count }"
                  :title="it.count ? '' : '当前范围无数据'"
                  @click="toggleType(it.value)"
                >
                  {{ it.label }}
                  <span class="opt-count">{{ it.count.toLocaleString() }}</span>
                </button>
              </div>
            </div>
          </div>
          <p class="fb-note">
            分组仅用于定位，勾选项即实际筛选值
            <template v-if="TAB_EXCLUDE_GROUP[tab]?.length">
              · 「{{ tabDefs.find(t => t.key === tab)?.label }}」页签已隐藏 {{ TAB_EXCLUDE_GROUP[tab].length }} 个分组
            </template>
          </p>
        </div>

        <!-- 状态 -->
        <div class="fb-block">
          <div class="fb-block-head">
            <span class="fb-label fb-label-plain">状态</span>
            <span class="fb-sub">已选 {{ filterStatuses.length }} 项</span>
            <div class="fb-head-actions">
              <button class="link-btn" @click="selectAllStatuses">全选</button>
              <span class="link-sep">/</span>
              <button class="link-btn" @click="filterStatuses = []; reload()">清空</button>
            </div>
          </div>
          <div class="status-segments">
            <div v-for="s in statusSegments" :key="s.key" class="st-segment">
              <p class="sg-label">
                {{ s.label }}<span class="sg-hint">{{ s.hint }}</span>
                <span class="sg-count">{{ s.count.toLocaleString() }}</span>
              </p>
              <div class="sg-items">
                <button
                  v-for="it in s.items"
                  :key="it.label"
                  class="opt-chip st-chip"
                  :class="{ active: filterStatuses.includes(it.label), dead: !it.count }"
                  @click="toggleStatus(it.label)"
                >
                  {{ it.label }}
                  <span class="opt-count">{{ it.count.toLocaleString() }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 条件回显：chip 逐条 + 单条 ✕ -->
      <div class="fb-row fb-chips">
        <span class="fb-label fb-label-plain">已选</span>
        <template v-if="activeChips.length">
          <button v-for="c in activeChips" :key="c.key" class="chip" @click="removeChip(c)">
            {{ c.text }}
            <el-icon><Close /></el-icon>
          </button>
        </template>
        <span v-else class="fb-empty">未设置条件 · 共 {{ filteredTotal.toLocaleString() }} 单</span>
        <button v-if="activeChips.length" class="reset-btn" @click="resetFilter">重置</button>
        <span class="fb-total">
          命中 <strong>{{ filteredTotal.toLocaleString() }}</strong> 单
          <template v-if="totalScope !== filteredTotal">（当前范围共 {{ totalScope.toLocaleString() }}）</template>
        </span>
      </div>
    </div>

    <!-- 状态胶囊 tab -->
    <div class="tabs">
      <button
        v-for="t in tabDefs"
        :key="t.key"
        class="tab-pill"
        :class="{ active: tab === t.key }"
        @click="switchTab(t.key)"
      >
        {{ t.label }}
        <span class="tab-count">{{ tabs[t.key] ?? 0 }}</span>
        <span v-if="t.key === 'after' && (tabs.after ?? 0) > 0" class="tab-dot">{{ tabs.after > 9 ? '9+' : tabs.after }}</span>
      </button>
    </div>

    <!-- 主表 -->
    <div class="table-card">
      <el-table :data="items" v-loading="loading" style="width: 100%" :header-cell-style="headerStyle">
        <el-table-column label="订单号" min-width="170">
          <template #default="{ row }">
            <span class="sn">{{ row.order_sn }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型 / 渠道" width="140">
          <template #default="{ row }">
            <div class="type-cell">
              <span class="type-tag" :class="`type-${typeClass(row)}`">{{ typeLabel(row.type) }}</span>
              <span v-if="row.biz_channel" class="biz-channel">{{ row.biz_channel }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="站点" width="72">
          <template #default="{ row }">
            <span class="site-code">{{ row.site_code }}</span>
          </template>
        </el-table-column>
        <el-table-column label="商品" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.goods_title }}</template>
        </el-table-column>
        <el-table-column label="金额" width="100">
          <template #default="{ row }">
            <span class="amount">¥{{ row.pay_price }}</span>
          </template>
        </el-table-column>
        <el-table-column label="用户" width="96">
          <template #default="{ row }">{{ row.buyer }}</template>
        </el-table-column>
        <el-table-column label="下单时间" width="145">
          <template #default="{ row }">
            <span class="order-time">{{ fmtTime(row.paid_at || row.created_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="完成时间" width="145">
          <template #default="{ row }">
            <span class="order-time">{{ fmtTime(row.settled_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态更新" width="145">
          <template #default="{ row }">
            <span class="order-time muted-time" :title="row.platform_updated_at ? '' : '上游未提供'">
              {{ row.platform_updated_at ? fmtTime(row.platform_updated_at) : '—' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态 / 账单" min-width="150">
          <template #default="{ row }">
            <div class="status-cell">
              <span class="status-text" :class="statusClass(row)">{{ row.status }}</span>
              <span v-if="row.provider_sn" class="provider-sn">{{ row.provider_sn }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="佣金" width="90">
          <template #default="{ row }">
            <span v-if="!row.commission_visible" class="muted">—</span>
            <span v-else-if="row.refund_status === 'refunded'" class="frozen">已冻结</span>
            <span v-else-if="row.commission > 0" class="commission">¥{{ row.commission }}</span>
            <span v-else class="pending">待结算</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="onDetail(row)">详情</el-link>
          </template>
        </el-table-column>
      </el-table>

      <div class="pager">
        <el-pagination
          layout="prev, pager, next"
          :total="tabs[tab] ?? 0"
          :page-size="size"
          :current-page="page"
          @current-change="onPage"
        />
      </div>
    </div>

    <!-- 订单详情弹窗（行数据回显） -->
    <el-dialog v-model="detailVisible" title="订单详情" width="480px">
      <el-descriptions v-if="detailRow" :column="1" border size="small">
        <el-descriptions-item label="订单号"><span class="sn">{{ detailRow.order_sn }}</span></el-descriptions-item>
        <el-descriptions-item label="类型">
          {{ typeLabel(detailRow.type) }}
          <span v-if="detailRow.biz_channel" class="muted">· {{ detailRow.biz_channel }}</span>
          <span v-if="detailRow.biz_category" class="muted">· {{ BIZ_CATEGORY_LABEL[detailRow.biz_category] ?? detailRow.biz_category }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="站点">{{ detailRow.site_name }}（{{ detailRow.site_code }}）</el-descriptions-item>
        <el-descriptions-item label="商品">{{ detailRow.goods_title }}</el-descriptions-item>
        <el-descriptions-item label="实付金额"><span class="amount">¥{{ detailRow.pay_price }}</span></el-descriptions-item>
        <el-descriptions-item v-if="detailRow.coupon" label="优惠券">
          {{ detailRow.coupon.name }}（券ID {{ detailRow.coupon.user_coupon_id }}）· 抵扣 ¥{{ detailRow.coupon.discount }}
          <span v-if="detailRow.goods_amount" class="muted">· 商品金额 ¥{{ detailRow.goods_amount }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="状态">{{ detailRow.status }}</el-descriptions-item>
        <el-descriptions-item label="用户">{{ detailRow.buyer }}</el-descriptions-item>
        <el-descriptions-item label="供应商单号">
          <span v-if="detailRow.provider_sn" class="provider-sn">{{ detailRow.provider_sn }}</span>
          <span v-else class="muted">—</span>
        </el-descriptions-item>
        <el-descriptions-item label="佣金">
          <span v-if="!detailRow.commission_visible" class="muted">—（积分兑换单不参与佣金）</span>
          <span v-else-if="detailRow.commission > 0">¥{{ detailRow.commission }}</span>
          <span v-else>待结算</span>
        </el-descriptions-item>
        <el-descriptions-item label="下单时间">{{ fmtTime(detailRow.paid_at || detailRow.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="完成时间">
          <span v-if="detailRow.settled_at">{{ fmtTime(detailRow.settled_at) }}</span>
          <span v-else class="muted">—（未完成/未结算）</span>
        </el-descriptions-item>
        <el-descriptions-item label="状态更新时间">
          <span v-if="detailRow.platform_updated_at">{{ fmtTime(detailRow.platform_updated_at) }}</span>
          <span v-else class="muted">—（上游未提供）</span>
        </el-descriptions-item>
      </el-descriptions>

      <!-- 佣金三级分配明细（仅 CPS/自营单；平台盈余 = 佣金 − Σ有效分配） -->
      <div v-if="detailRow && detailRow.commission_visible" class="commission-block">
        <p class="cb-title">佣金三级分配</p>
        <el-table v-if="detailRow.commissions.length" :data="detailRow.commissions" size="small" border>
          <el-table-column label="层级" width="70">
            <template #default="{ row }">{{ LEVEL_NAMES[row.level] ?? `L${row.level}` }}</template>
          </el-table-column>
          <el-table-column label="受益人" min-width="110">
            <template #default="{ row }">
              {{ row.nickname || `用户#${row.user_id}` }}
              <span v-if="row.level_name" class="cb-level">{{ row.level_name }}</span>
            </template>
          </el-table-column>
          <el-table-column label="金额" width="90" align="right">
            <template #default="{ row }">¥{{ row.amount }}</template>
          </el-table-column>
          <el-table-column label="状态" width="86">
            <template #default="{ row }">
              <span :class="{ 'cb-invalid': row.status === 'invalid' }">{{ FLOW_STATUS[row.status] ?? row.status }}</span>
            </template>
          </el-table-column>
        </el-table>
        <p v-else class="cb-empty">暂无分配记录（佣金到账结算时自动生成三级分配）</p>
        <p class="cb-surplus">
          平台盈余：<strong>¥{{ surplusOf(detailRow) }}</strong>
          <span class="cb-formula">= 佣金 ¥{{ detailRow.commission }} − 有效分配 ¥{{ validPaid(detailRow) }}</span>
        </p>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 底部口径 notice -->
    <div class="notice">
      CPS 订单佣金在平台实际结算到账后发放（佣金基数 = 平台实际到手金额）；蚂蚁星球积分兑换订单只读展示，与元宝体系无关。
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Close, Download } from '@element-plus/icons-vue';

const admin = JSON.parse(localStorage.getItem('fyt_admin_info') ?? 'null');
const isPlatform = admin?.role === 'platform_admin';
const siteOptions = ref(admin?.sites ?? []);

async function api(path) {
  const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token') } });
  const j = await r.json();
  if (!j.ok) throw new Error(j.message || '请求失败');
  return j.data;
}

const tabDefs = [
  { key: 'all', label: '全部' },
  { key: 'self', label: '到店团购订单' },
  { key: 'cps', label: 'CPS 订单' },
  { key: 'ingot', label: '积分兑换(蚂蚁星球)' },
  { key: 'after', label: '售后处理' },
];

/** 页签管大类、下拉管细类（admin-32B）。映射的是"这一页签天然排除哪些类型组"，
 *  用于前端隐藏而非后端过滤 —— 后端仍以 tab 参数独立生效，两处口径必须一致。 */
const TAB_EXCLUDE_GROUP = { cps: ['self'], ingot: ['self'], self: [], after: [], all: [] };

const tab = ref('all');
const tabs = ref({});
const items = ref([]);
const loading = ref(false);
const page = ref(1);
const size = 20;

// ---------------- 筛选状态（即时生效，applied* 已废除） ----------------
const filterSite = ref('');
const filterKeyword = ref('');
const filterDate = ref([]);
const quick = ref('7d');
const filterTimeField = ref('paid_at'); // 决策 #42：默认下单时间
const filterTypes = ref([]);
const filterStatuses = ref([]);
const filterPay = ref([]);

/** 角标数据（类型 6 组 / 状态 3 段 + 当前范围总数） */
const typeGroups = ref([]);
const statusSegments = ref([]);
const totalScope = ref(0);

// ---------------- 时间口径与快捷键 ----------------
const TIME_FIELDS = {
  paid_at: { label: '下单时间', hint: '按用户下单时刻筛 · 找单习惯锚点（默认）' },
  settled_at: { label: '结算时间', hint: '按佣金结算时刻筛 · 对账场景常用' },
  platform_updated_at: { label: '上游更新', hint: '按平台状态变更筛 · 查跟单延迟' },
};
const TIME_FIELD_LIST = Object.entries(TIME_FIELDS).map(([key, v]) => ({ key, ...v }));
const TIME_QUICK = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: 'custom', label: '自定义' },
];

/** 支付方式：真实库只有自营单有线上流水（CPS 钱不经我手），口径必须写清楚，否则筛出 0 条会被当成 bug。 */
const PAY_OPTIONS = [
  { value: 'online', label: '线上支付' },
  { value: 'offline', label: '无支付流水' },
];

const detailVisible = ref(false);
const detailRow = ref(null);

const headerStyle = { background: '#fff6e9', color: '#5c3a4a', fontWeight: 700 };

/** 佣金三级分配展示常量与盈余计算（与 ordersync.ts 口径一致） */
const LEVEL_NAMES = { 1: '自购', 2: '直推', 3: '间推' };
const FLOW_STATUS = { estimated: '预计', available: '可提现', withdrawn: '已提现', invalid: '已作废' };
const validPaid = (row) =>
  (row.commissions ?? []).filter((c) => c.status !== 'invalid').reduce((s, c) => s + Number(c.amount || 0), 0).toFixed(2);
const surplusOf = (row) => (Number(row.commission || 0) - Number(validPaid(row))).toFixed(2);

/** 当前命中的单数（tabs[tab] 已在后端按同一套筛选算好，这里直接用）。 */
const filteredTotal = computed(() => tabs.value[tab.value] ?? 0);

/** 时间展示：YYYY-MM-DD HH:mm */
function fmtTime(t) {
  if (!t) return '—';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 订单类型标签（D先生 2026-10-04：「订单类型也请列出详细而不是仅为 CPS 供应链」）。
 *
 * 之前只有 3 档（self/cps/ingot），17 个 provider 桶全被压成「CPS 供应链」一个标签，
 * 后台完全看不出这条单到底是电商返佣、本地生活、点餐、影票还是充值。
 * 现在按 provider 逐个给中文名，并按大类上色（type-* CSS class）。
 */
const PROVIDER_TYPE_LABEL = {
  self: '到店团购',
  jd: '京东',
  pdd: '拼多多',
  tb: '淘宝',
  vip: '唯品会',
  fzy: '飞猪',
  ks: '快手',
  meituan: '美团',
  local: '本地生活',
  didi: '滴滴',
  eleme: '饿了么',
  dc: '点餐',
  movie: '电影票',
  recharge: '权益充值',
  liucard: '流量卡',
  other: '其他',
  pf: '其他',
};
/** 一级分类（用于详情页分组说明 + 颜色档） */
const BIZ_CATEGORY_LABEL = {
  self: '自营到店',
  ecommerce: '电商返佣',
  local: '本地生活',
  dining: '点餐',
  movie: '影视票务',
  recharge: '权益充值',
  other: '其他',
};
const typeLabel = (t) => {
  if (t === 'cps') return 'CPS 供应链';
  if (t === 'ingot') return '积分兑换';
  return PROVIDER_TYPE_LABEL[t] ?? t ?? '—';
};
/** 归到 3 个视觉档：self / 业务细分 / 其他 */
function typeClass(row) {
  if (row.type === 'self') return 'self';
  if (row.type === 'ingot') return 'ingot';
  if (row.biz_category) return row.biz_category;
  return 'other';
}

function statusClass(row) {
  if (row.status === '退款审核中') return 'st-refund';
  if (row.status === '已退款') return 'st-refunded';
  if (['已发货', '已收货', '已核销'].includes(row.status)) return 'st-ok';
  return 'st-wait';
}

/** 筛选值 → query串（列表 / 导出 / 角标三处共用同一份，避免口径漂移） */
function buildQuery(extra = {}) {
  const [from, to] = filterDate.value ?? [];
  return new URLSearchParams({
    tab: tab.value,
    site: filterSite.value,
    keyword: filterKeyword.value.trim(),
    types: filterTypes.value.join(','),
    statuses: filterStatuses.value.join(','),
    pay: filterPay.value.join(','),
    time_field: filterTimeField.value,
    from: from ?? '',
    to: to ?? '',
    ...extra,
  });
}

async function load() {
  loading.value = true;
  try {
    const qs = buildQuery({ page: String(page.value), size: String(size) });
    const d = await api(`/admin/orders?${qs}`);
    tabs.value = d.tabs;
    items.value = d.items;
  } catch (e) {
    ElMessage.error(e.message ?? '订单加载失败');
  } finally {
    loading.value = false;
  }
}

/** 角标：与列表同 tab/site/时间口径，但不含 types/statuses/pay —— 否则勾一项全归零无法横向比较。 */
async function loadFilterOptions() {
  try {
    const d = await api(`/admin/orders/filter-options?${buildQuery()}`);
    typeGroups.value = d.groups ?? [];
    statusSegments.value = d.segments ?? [];
    totalScope.value = d.total ?? 0;
  } catch (e) {
    // 角标失败不阻塞主列表，只提示一次
    ElMessage.warning('筛选选项角标加载失败：' + (e.message ?? ''));
  }
}

/** 即时生效的唯一入口（替代原「应用」按钮） */
function reload() {
  page.value = 1;
  load();
  loadFilterOptions();
}

/** 本地日期字符串（不能用 toISOString，那是 UTC，会差8 小时导致「今日」算错） */
function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function onQuick(key) {
  quick.value = key;
  const today = new Date();
  if (key === 'today') {
    filterDate.value = [ymd(today), ymd(today)];
  } else if (key === 'yesterday') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    filterDate.value = [ymd(y), ymd(y)];
  } else if (key === '7d' || key === '30d') {
    const s = new Date(today);
    s.setDate(s.getDate() - (key === '7d' ? 6 : 29));
    filterDate.value = [ymd(s), ymd(today)];
  } else {
    filterDate.value = [];
  }
  reload();
}

function onDateChange() {
  // 手动改日期即视为自定义区间
  if (filterDate.value?.length) quick.value = 'custom';
  reload();
}

function onTimeField(key) {
  filterTimeField.value = key;
  reload();
}

/** 联动规则（admin-32B）：点「CPS」页签隐藏自营组；勾「到店团购」页签自动跳「团购」。 */
const visibleTypeGroups = computed(() => {
  const hide = TAB_EXCLUDE_GROUP[tab.value] ?? [];
  return typeGroups.value.filter((g) => !hide.includes(g.key));
});

function toggleType(value) {
  const i = filterTypes.value.indexOf(value);
  if (i >= 0) filterTypes.value.splice(i, 1);
  else filterTypes.value.push(value);
  // 双向联动：勾到「到店团购」→ 页签跳「团购」；页签在 CPS/积分兑换时自营组已隐藏，不会有歧义
  if (value === 'self' && !filterTypes.value.includes('self') && tab.value !== 'self') tab.value = 'self';
  reload();
}

function selectAllTypes() {
  filterTypes.value = visibleTypeGroups.value.flatMap((g) => g.items.map((i) => i.value));
  reload();
}

function toggleStatus(label) {
  const i = filterStatuses.value.indexOf(label);
  if (i >= 0) filterStatuses.value.splice(i, 1);
  else filterStatuses.value.push(label);
  reload();
}

function selectAllStatuses() {
  filterStatuses.value = statusSegments.value.flatMap((s) => s.items.map((i) => i.label));
  reload();
}

/** chip 回显：把当前所有生效条件拍平成可单独✕ 的条目（admin-32B 诊断②）。 */
const activeChips = computed(() => {
  const out = [];
  const quickLabel = TIME_QUICK.find((q) => q.key === quick.value)?.label ?? '';
  if (filterDate.value?.length) {
    out.push({ key: 'date', text: `${quickLabel && quick.value !== 'custom' ? quickLabel + ' ' : ''}${filterDate.value[0]} ~ ${filterDate.value[1]}` });
  }
  if (filterTimeField.value !== 'paid_at') out.push({ key: 'time_field', text: `口径:${TIME_FIELDS[filterTimeField.value].label}` });
  if (filterSite.value) out.push({ key: 'site', text: `站点:${siteOptions.value.find((s) => s.code === filterSite.value)?.name ?? filterSite.value}` });
  for (const v of filterTypes.value) out.push({ key: `type:${v}`, text: `类型:${typeItemLabel(v)}` });
  for (const s of filterStatuses.value) out.push({ key: `status:${s}`, text: `状态:${s}` });
  for (const p of filterPay.value) out.push({ key: `pay:${p}`, text: `支付:${PAY_OPTIONS.find((x) => x.value === p)?.label ?? p}` });
  if (filterKeyword.value.trim()) out.push({ key: 'keyword', text: `关键词:${filterKeyword.value.trim()}` });
  return out;
});

function typeItemLabel(value) {
  for (const g of typeGroups.value) {
    const hit = g.items.find((i) => i.value === value);
    if (hit) return hit.label;
  }
  return value;
}

function removeChip(chip) {
  if (chip.key === 'date') { filterDate.value = []; quick.value = ''; }
  else if (chip.key === 'time_field') filterTimeField.value = 'paid_at';
  else if (chip.key === 'site') filterSite.value = '';
  else if (chip.key === 'keyword') filterKeyword.value = '';
  else if (chip.key.startsWith('type:')) {
    const v = chip.key.slice(5);
    filterTypes.value = filterTypes.value.filter((x) => x !== v);
    if (v === 'self' && tab.value === 'self') tab.value = 'all';
  } else if (chip.key.startsWith('status:')) {
    const s = chip.key.slice(7);
    filterStatuses.value = filterStatuses.value.filter((x) => x !== s);
  } else if (chip.key.startsWith('pay:')) {
    const p = chip.key.slice(4);
    filterPay.value = filterPay.value.filter((x) => x !== p);
  }
  reload();
}

function resetFilter() {
  filterSite.value = '';
  filterKeyword.value = '';
  filterTypes.value = [];
  filterStatuses.value = [];
  filterPay.value = [];
  filterTimeField.value = 'paid_at';
  quick.value = '7d';
  onQuick('7d');
}

function switchTab(key) {
  tab.value = key;
  // 页签切到 CPS/积分兑换时，若已勾了自营类型会造成 0 结果矛盾 → 自动摘掉
  if ((key === 'cps' || key === 'ingot') && filterTypes.value.includes('self')) {
    filterTypes.value = filterTypes.value.filter((v) => v !== 'self');
  }
  reload();
}
function onPage(p) {
  page.value = p;
  load();
}

async function onExport() {
  try {
    const r = await fetch('/api/admin/orders/export?' + buildQuery(), {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token') },
    });
    const ct = r.headers.get('content-type') ?? '';
    if (!r.ok || ct.includes('application/json')) {
      const j = await r.json().catch(() => null);
      throw new Error(j?.message ?? `导出失败(${r.status})`);
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const tfLabel = TIME_FIELDS[filterTimeField.value].label;
    a.download = `订单中心-${tfLabel}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    ElMessage.error(e.message ?? '导出失败');
  }
}

function onDetail(row) {
  detailRow.value = row ?? null;
  detailVisible.value = true;
}

onMounted(() => {
  onQuick('7d'); // 默认近 7 天，页面进来就有数据可看
  if (isPlatform) {
    api('/admin/orders/sites').then((d) => { siteOptions.value = d.sites ?? []; }).catch(() => {});
  }
});
</script>

<style scoped>
.order-center { display: flex; flex-direction: column; gap: 16px; }

.head-row { display: flex; align-items: flex-start; }
.title { margin: 0; font-size: 22px; font-weight: 900; color: #3d2530; }
.subtitle { margin: 6px 0 0; font-size: 13px; color: #a08592; }
.head-actions { margin-left: auto; display: flex; gap: 10px; align-items: center; }
.ghost-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; border: 1.5px solid #3d2030; color: #3d2030;
  font-size: 13px; font-weight: 700; border-radius: 999px; padding: 8px 16px; cursor: pointer;
}
.ghost-btn:hover { background: #fff6e9; }
.primary-btn {
  display: inline-flex; align-items: center; gap: 4px;
  background: #e8336d; color: #fff; border: none; cursor: pointer;
  font-size: 13px; font-weight: 700; border-radius: 999px; padding: 9px 18px;
  box-shadow: 0 3px 0 rgba(163, 18, 69, 0.35);
}
.primary-btn:hover { background: #d0295f; }

.filter-panel { padding: 10px 14px; min-width: 280px; }
.filter-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.filter-label { font-size: 12px; color: #8a6b75; width: 44px; flex-shrink: 0; }
.filter-actions { display: flex; justify-content: flex-end; gap: 8px; }

/* ========== admin-32B 筛选台 ==========
   设计稿诊断①「5 个筛选全藏在下拉里」→ 三行常驻展开，页面默认可见。
   视觉沿用波普风 VI：奶油白底 + 玫红描边 + 鎏金强调，不引入新色系。 */
.filter-bar {
  background: #fffdf8; border: 1.5px solid #f0dfc8; border-radius: 16px;
  padding: 14px 18px; display: flex; flex-direction: column; gap: 12px;
}
.fb-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.fb-label {
  font-size: 12px; font-weight: 800; color: #a31245;
  background: #fde3ec; border-radius: 999px; padding: 3px 11px; flex-shrink: 0;
}
.fb-label-plain { background: transparent; padding-left: 0; }
.fb-label-gap { margin-left: 6px; }
.fb-hint { font-size: 11.5px; color: #a8968a; }
.fb-sub { font-size: 11.5px; color: #a8968a; }
.fb-empty { font-size: 12px; color: #b8a89c; }

/* 时间快捷键 */
.time-quick { display: flex; gap: 6px; }
.q-pill {
  background: #fff; border: 1.5px solid #f0dfc8; color: #5c3a4a;
  font-size: 12.5px; font-weight: 700; border-radius: 999px; padding: 5px 13px; cursor: pointer;
  font-family: inherit;
}
.q-pill:hover { border-color: #e8b88a; }
.q-pill.active { background: #e8336d; border-color: #e8336d; color: #fff; box-shadow: 0 2px 0 rgba(163, 18, 69, 0.28); }

/* 类型 / 状态 分块 */
.fb-row-panel { align-items: flex-start; gap: 22px; }
.fb-block { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.fb-block-head { display: flex; align-items: center; gap: 8px; }
.fb-head-actions { margin-left: auto; display: flex; align-items: center; gap: 5px; }
.link-btn {
  background: none; border: none; cursor: pointer; font-family: inherit;
  font-size: 12px; font-weight: 700; color: #e8336d; padding: 0;
}
.link-btn:hover { text-decoration: underline; }
.link-sep { color: #d8c8bc; font-size: 12px; }

.type-groups { display: flex; flex-wrap: wrap; gap: 14px; }
.type-group { display: flex; flex-direction: column; gap: 6px; }
.tg-label {
  margin: 0; font-size: 11px; font-weight: 800; color: #8a6b75;
  letter-spacing: 0.5px; display: flex; align-items: center; gap: 5px;
}
.tg-count {
  background: #eee6ea; color: #7a6570; border-radius: 999px;
  font-size: 10px; padding: 0 5px; font-weight: 700;
}
.tg-items { display: flex; flex-wrap: wrap; gap: 6px; }

/* 类型选项：单数角标常驻（设计稿：不用筛完才知道有没有数据） */
.opt-chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: #fff; border: 1.5px solid #f0dfc8; color: #5c3a4a;
  font-size: 12.5px; font-weight: 700; border-radius: 8px; padding: 5px 9px;
  cursor: pointer; font-family: inherit;
}
.opt-chip:hover { border-color: #e8336d; }
.opt-chip.active {
  background: #e8336d; border-color: #e8336d; color: #fff;
  box-shadow: 0 2px 0 rgba(163, 18, 69, 0.28);
}
.opt-chip.dead { opacity: 0.45; }
.opt-chip.dead.active { opacity: 0.75; }
.opt-count {
  font-size: 10.5px; font-weight: 800; font-variant-numeric: tabular-nums;
  color: #b3541e; background: #fff1e0; border-radius: 999px; padding: 1px 6px;
}
.opt-chip.active .opt-count { background: rgba(255, 255, 255, 0.28); color: #fff; }

.status-segments { display: flex; flex-direction: column; gap: 9px; }
.st-segment { display: flex; flex-direction: column; gap: 5px; }
.sg-label {
  margin: 0; font-size: 11px; font-weight: 800; color: #8a6b75;
  display: flex; align-items: center; gap: 6px;
}
.sg-hint { font-weight: 600; color: #b8a89c; font-size: 10.5px; }
.sg-count { font-variant-numeric: tabular-nums; color: #b3541e; }
.sg-items { display: flex; flex-wrap: wrap; gap: 6px; }
.st-chip { padding: 4px 9px; }
.fb-note { margin: 0; font-size: 11px; color: #b8a89c; }

/* chip 回显（设计稿诊断②：筛完不知道生效了什么 → 逐条回显 + 单条 ✕） */
.fb-chips { border-top: 1.5px dashed #f0dfc8; padding-top: 12px; }
.chip {
  display: inline-flex; align-items: center; gap: 5px;
  background: #fff1e0; border: 1.5px solid #ffc78f; color: #b3541e;
  font-size: 12px; font-weight: 700; border-radius: 999px; padding: 4px 11px;
  cursor: pointer; font-family: inherit;
}
.chip:hover { background: #ffe2c2; }
.chip .el-icon { font-size: 12px; }
.reset-btn {
  margin-left: 6px; background: #fff; border: 1.5px solid #3d2030; color: #3d2030;
  font-size: 12px; font-weight: 800; border-radius: 999px; padding: 4px 14px;
  cursor: pointer; font-family: inherit;
}
.reset-btn:hover { background: #fff6e9; }
.fb-total { margin-left: auto; font-size: 12.5px; color: #8a6b75; }
.fb-total strong { color: #e8336d; font-size: 14px; font-weight: 900; }

.tabs { display: flex; gap: 10px; flex-wrap: wrap; }
.tab-pill {
  display: inline-flex; align-items: center; gap: 8px; position: relative;
  background: #fff; border: 1.5px solid #f0dfc8; color: #5c3a4a;
  font-size: 13.5px; font-weight: 700; border-radius: 999px; padding: 9px 18px; cursor: pointer;
}
.tab-pill:hover { border-color: #e8b88a; }
.tab-pill.active { background: #e8336d; border-color: #e8336d; color: #fff; box-shadow: 0 3px 0 rgba(163, 18, 69, 0.3); }
.tab-count { font-weight: 900; }
.tab-pill.active .tab-count { color: #ffd9e6; }
.tab-dot {
  position: absolute; top: -7px; right: -4px;
  background: #e8336d; color: #fff; font-size: 10.5px; font-weight: 800;
  border-radius: 999px; padding: 1px 6px; border: 2px solid #fff;
}
.tab-pill.active .tab-dot { background: #ffaa1d; color: #5c3200; }

.table-card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 8px 14px 14px; }
.sn { font-family: 'JetBrains Mono', Consolas, monospace; font-size: 12.5px; color: #5c3a4a; }
.order-time { font-size: 12.5px; color: #8a6b75; font-variant-numeric: tabular-nums; white-space: nowrap; }
.type-tag {
  font-size: 11.5px; font-weight: 800; border-radius: 6px; padding: 3px 8px; white-space: nowrap;
}
/* 业务分类配色（2026-10-04 新增：原先只有 self/cps/ingot 三档，17 个provider 桶全压成「CPS 供应链」） */
.type-self { background: #fde3ec; color: #a31245; }
.type-cps { background: #ffe9c9; color: #9a5b00; }
.type-ingot { background: #eee6ea; color: #7a6570; }
.type-ecommerce { background: #fff1e0; color: #b3541e; }
.type-local { background: #e4f7ec; color: #1f7a4d; }
.type-dining { background: #e6f2ff; color: #1b5fa8; }
.type-movie { background: #f0e8fb; color: #6b32b5; }
.type-recharge { background: #fff6d9; color: #8a6a00; }
.type-other { background: #eee6ea; color: #7a6570; }
.type-cell { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
.biz-channel { font-size: 11px; color: #8a6b75; }
.site-code { font-weight: 700; color: #8a6b75; }
.amount { color: #e8336d; font-weight: 900; }
.status-cell { display: flex; flex-direction: column; gap: 2px; }
.status-text { font-size: 13px; font-weight: 700; }
.st-ok { color: #1f9d61; }
.st-wait { color: #b07f2a; }
.st-refund { color: #e8336d; }
.st-refunded { color: #8a6b75; }
.provider-sn { font-size: 11.5px; color: #4a7fb5; font-family: Consolas, monospace; }
.commission { color: #1f9d61; font-weight: 800; }
.pending { color: #b07f2a; font-weight: 600; }
.frozen { color: #8a6b75; }
.muted { color: #c5b3a4; }
.muted-time { color: #a8968a; }

/* 佣金三级分配明细 */
.commission-block { margin-top: 12px; }
.cb-title { font-size: 13px; font-weight: 800; color: #5c3a4a; margin: 0 0 8px; }
.cb-level {
  font-size: 10.5px; color: #a31245; background: #fff0f5;
  border-radius: 999px; padding: 1px 7px; margin-left: 4px;
}
.cb-invalid { color: #c5b3a4; text-decoration: line-through; }
.cb-empty { font-size: 12px; color: #8c8577; margin: 0 0 6px; }
.cb-surplus { font-size: 13px; color: #2b2b33; margin: 8px 0 0; }
.cb-surplus strong { color: #e8336d; }
.cb-formula { font-size: 11.5px; color: #8c8577; margin-left: 6px; }

.pager { display: flex; justify-content: flex-end; padding-top: 12px; }

.notice {
  background: #fde3ec; color: #a31245; border-radius: 12px;
  font-size: 12.5px; padding: 12px 18px; line-height: 1.6;
}

</style>
