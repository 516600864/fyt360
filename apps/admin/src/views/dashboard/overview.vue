<template>
  <!-- admin-29 数据看板（重构版）：净收益主卡 + 毛收入/现金支出两个账房 + 4KPI + 趋势 + 来源占比 + 成交额灰行 + 最近订单 -->
  <div class="ov">
    <!-- 顶行：问候 + 时间区间 -->
    <div class="head-row">
      <h2 class="greet">{{ greeting }}，{{ admin?.username ?? '管理员' }}</h2>
      <div class="head-right">
        <span class="scope-pill">数据范围：{{ isPlatform ? `全部站点（${data.sites_count}）` : '我的站点' }}</span>
        <div class="range-tabs">
          <button
            v-for="r in RANGES" :key="r.key"
            class="range-tab" :class="{ active: range === r.key }"
            @click="onRange(r.key)"
          >{{ r.label }}</button>
        </div>
        <el-date-picker
          v-if="range === 'custom'"
          v-model="customRange"
          type="daterange" range-separator="至"
          start-placeholder="开始" end-placeholder="结束"
          value-format="YYYY-MM-DD" size="small" style="width: 220px" :clearable="false"
        />
      </div>
    </div>

    <!-- 主卡：净收益（平台留存） -->
    <div class="hero">
      <div class="hero-label">
        {{ rangeLabel }}净收益（平台留存）
        <span class="hero-tip" :class="deltaCls(headline.net_delta)">{{ deltaText(headline.net_delta) }}</span>
      </div>
      <div class="hero-value">¥ {{ money(headline.net_income) }}</div>
      <div class="hero-sub">
        毛收入 ¥{{ money(headline.gross_income) }}
        <b>−</b> 现金支出 ¥{{ money(headline.cash_expense) }}
        <template v-if="headline.margin_rate !== null && headline.margin_rate !== undefined">
          <b>=</b> 净利率 {{ headline.margin_rate }}%
        </template>
      </div>
    </div>

    <!-- 4 KPI -->
    <div class="kpi-row">
      <div v-for="c in kpiCards" :key="c.key" class="kpi-card">
        <div class="kpi-head">
          <span class="kpi-label">{{ c.label }}</span>
          <span v-if="c.delta !== null && c.delta !== undefined" class="trend" :class="deltaCls(c.delta, true)">{{ deltaText(c.delta) }}</span>
        </div>
        <div class="kpi-value">
          {{ c.unit === '单' ? c.value : `¥ ${money(c.value)}` }}<i v-if="c.unit === '单'"> 单</i>
        </div>
        <div class="kpi-sub">{{ c.sub }}</div>
      </div>
    </div>

    <!-- 两个账房 -->
    <div class="ledger-row">
      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">毛收入业务线账房</span>
          <span class="panel-total">毛收入合计 <b>¥{{ money(gross.total) }}</b></span>
        </div>
        <div v-for="it in gross.items" :key="it.key" class="ledger-item">
          <div class="li-main">
            <span class="li-label">{{ it.label }}</span>
            <span v-if="warnText(it)" class="li-warn" :title="warnTitle(it)">{{ warnText(it) }}</span>
          </div>
          <div class="li-amount">¥{{ money(it.amount) }}</div>
          <div class="li-bar"><span :style="{ width: clampPct(it.share) }" /></div>
          <div class="li-desc">
            {{ it.desc }}
            <template v-if="it.key === 'self_goods' && it.orders">
              · 收款 ¥{{ money(it.receipt) }} − 成本 ¥{{ money(it.cost) }} − 佣金 ¥{{ money(it.commission) }} − 手续费 ¥{{ money(it.fee) }}
            </template>
          </div>
        </div>
        <p v-if="grossIncomplete" class="ledger-warn">
          到店团购有 {{ grossCostMissing }} 单未录商家成本，毛利口径不完整 —— 请到「商品与品牌 → 到店团购管理」补录成本价。
        </p>
      </div>

      <div class="panel">
        <div class="panel-head">
          <span class="panel-title">现金支出账房（真金白银流出）</span>
          <span class="panel-total">现金支出合计 <b>¥{{ money(expense.total) }}</b></span>
        </div>
        <div v-for="it in expense.items" :key="it.key" class="ledger-item" :class="{ 'li-excluded': it.excluded }">
          <div class="li-main">
            <span class="li-label">{{ it.label }}</span>
            <span v-if="it.orders" class="li-cnt">{{ it.orders }} 单</span>
            <span v-if="warnText(it)" class="li-warn" :title="warnTitle(it)">{{ warnText(it) }}</span>
          </div>
          <div class="li-amount">{{ it.excluded ? '不计支出' : `¥${money(it.amount)}` }}</div>
          <div class="li-bar"><span class="out" :style="{ width: clampPct(it.share) }" /></div>
          <div class="li-desc">
            {{ it.desc }}
            <template v-if="it.levels && it.levels.some((l) => l.amount > 0)">
              ·
              <span v-for="(l, li) in it.levels" :key="l.label">{{ l.label }} ¥{{ money(l.amount) }}<span v-if="li < it.levels.length - 1"> / </span></span>
            </template>
          </div>
        </div>
        <!-- 元宝：灰显单列，绝不计入合计（元宝非现金，铁律） -->
        <div class="ingot-row">
          <span class="ingot-label">元宝发放（不计支出）</span>
          <span class="ingot-amt">{{ expense.ingot_issued }} 元宝</span>
        </div>
        <p class="ledger-note">{{ expense.note }}</p>
      </div>
    </div>

    <!-- 趋势 + 来源占比 -->
    <div class="chart-row">
      <div class="panel chart-panel">
        <div class="panel-head">
          <span class="panel-title">收益趋势</span>
          <div class="legend-inline">
            <span><i class="sw sw-gross" />毛收入</span>
            <span><i class="sw sw-out" />现金支出</span>
          </div>
        </div>
        <div class="bars">
          <div v-for="(b, i) in bars" :key="i" class="bar-col" :title="barTitle(b)">
            <div class="bar-stack">
              <div class="bar gross" :style="{ height: pct(b.gross) + '%' }" />
              <div class="bar out" :style="{ height: pct(b.expense) + '%' }" />
            </div>
            <span class="bar-label">{{ b.label }}</span>
          </div>
        </div>
        <p class="chart-foot">
          区间合计：毛收入 ¥{{ money(sumTrend('gross')) }} · 现金支出 ¥{{ money(sumTrend('expense')) }} · 净收益 ¥{{ money(sumTrend('net')) }}
        </p>
      </div>

      <div class="panel donut-panel">
        <div class="panel-head"><span class="panel-title">毛收入来源占比</span></div>
        <div class="donut-wrap">
          <div class="donut" :style="{ background: donutCss }">
            <div class="donut-hole">
              <span class="donut-num">¥{{ money(cpsTotal) }}</span>
              <span class="donut-cap">CPS 佣金</span>
            </div>
          </div>
          <div class="legend">
            <div v-for="(c, i) in sourceLegend" :key="c.key" class="legend-item">
              <span class="dot" :style="{ background: DONUT_COLORS[i % DONUT_COLORS.length] }" />
              <span class="legend-name">{{ c.label }}</span>
              <span class="legend-pct">{{ c.pct }}%</span>
            </div>
            <p v-if="!sources.length" class="legend-empty">该区间暂无 CPS 佣金</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 成交额（灰行：非平台收入，不可与收益混算） -->
    <div class="gmv-row">
      <span class="gmv-title">成交额（蚂蚁星球平台口径） ¥{{ money(gmv.total) }}</span>
      <span v-if="gmv.delta !== null && gmv.delta !== undefined" class="gmv-delta" :class="deltaCls(gmv.delta)">{{ deltaText(gmv.delta) }}</span>
      <p class="gmv-note">{{ gmv.note }}</p>
    </div>

    <!-- 最近订单 -->
    <div class="panel orders-panel">
      <div class="panel-head">
        <span class="panel-title">最近订单</span>
        <el-link type="primary" :underline="false" @click="onAllOrders">查看全部 &gt;</el-link>
      </div>
      <el-table :data="data.recent_orders" size="large" :header-cell-style="{ background: '#fff6e9', color: '#a31245', fontWeight: 700 }">
        <el-table-column prop="order_sn" label="订单号" width="200" show-overflow-tooltip />
        <el-table-column label="商品" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">{{ row.title || '—' }}</template>
        </el-table-column>
        <el-table-column label="站点" width="105" show-overflow-tooltip>
          <template #default="{ row }">{{ row.site_name }}</template>
        </el-table-column>
        <el-table-column label="渠道" width="95">
          <template #default="{ row }">{{ providerLabel(row.provider) }}</template>
        </el-table-column>
        <el-table-column label="成交额" width="95" align="right">
          <template #default="{ row }"><span class="money-muted">¥{{ money(row.pay_price) }}</span></template>
        </el-table-column>
        <!-- 决策#38：收益一律显示佣金口径，成交额单独一列且弱化 -->
        <el-table-column label="佣金" width="95" align="right">
          <template #default="{ row }"><span class="money">¥{{ money(row.commission) }}</span></template>
        </el-table-column>
        <el-table-column label="下单时间" width="140">
          <template #default="{ row }"><span class="otime">{{ fmtTime(row.paid_at ?? row.settled_at) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="95" align="center">
          <template #default="{ row }">
            <span class="st" :class="statusCls(row)">{{ statusText(row) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!data.recent_orders.length" description="暂无订单" :image-size="60" />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { adminApi } from '../../lib/api';

const emit = defineEmits(['kpi', 'go']);
const admin = JSON.parse(localStorage.getItem('fyt_admin_info') ?? 'null');
const isPlatform = admin?.role === 'platform_admin';

const RANGES = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: '7d', label: '近 7 日' },
  { key: '30d', label: '近 30 日' },
  { key: 'custom', label: '自定义' },
];
const RANGE_LABEL = { today: '今日', yesterday: '昨日', '7d': '近 7 日', '30d': '近 30 日', custom: '区间' };

const range = ref('today');
const customRange = ref([]);

const data = reactive({
  sites_count: 0, range: {}, headline: {},
  gross: { items: [], total: 0 }, expense: { items: [], total: 0, ingot_issued: 0, note: '' },
  kpi: [], trend: [], sources: [], gmv_reference: { total: 0, delta: null, note: '' },
  ingot: {}, recent_orders: [],
});

const gross = computed(() => data.gross ?? { items: [], total: 0 });
const expense = computed(() => data.expense ?? { items: [], total: 0, ingot_issued: 0, note: '' });
const headline = computed(() => data.headline ?? {});
const gmv = computed(() => data.gmv_reference ?? { total: 0, delta: null, note: '' });
const trend = computed(() => data.trend ?? []);
const sources = computed(() => data.sources ?? []);

const rangeLabel = computed(() => RANGE_LABEL[range.value] ?? '区间');
const cpsTotal = computed(() => sources.value.reduce((a, s) => a + Number(s.amount || 0), 0));
const grossIncomplete = computed(() => gross.value.items.some((i) => i.key === 'self_goods' && !i.ready));
const grossCostMissing = computed(() => gross.value.items.find((i) => i.key === 'self_goods')?.cost_missing ?? 0);

const hour = new Date().getHours();
const greeting = hour < 6 ? '凌晨好' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

const DONUT_COLORS = ['#e8336d', '#ffaa1d', '#a31245', '#5DCAA5', '#85B7EB', '#F0997B'];
const PROVIDER_LABEL = {
  self: '到店团购', jd: '京东', tb: '淘宝', pdd: '拼多多', vip: '唯品会', fzy: '飞猪', ks: '快手',
  meituan: '美团', local: '本地生活', didi: '滴滴', eleme: '饿了么',
  dc: '点餐', movie: '电影票', recharge: '权益直充', liucard: '流量卡', other: '其他', pf: '其他',
};

const money = (n) => Number(n ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const providerLabel = (p) => PROVIDER_LABEL[p] ?? p ?? '—';
const clampPct = (v) => `${Math.max(0, Math.min(100, Number(v ?? 0)))}%`;

/** 环比：null = 基期为 0（显示「新增」，不显示 +∞）；inverse=true 用于支出类（涨=不好） */
function deltaCls(v, inverse = false) {
  if (v === null || v === undefined) return 'flat';
  const up = Number(v) >= 0;
  return (inverse ? !up : up) ? 'good' : 'bad';
}
function deltaText(v) {
  if (v === null || v === undefined) return '新增';
  return `${Number(v) >= 0 ? '↑' : '↓'} ${Math.abs(Number(v))}%`;
}

/** 未就绪行的原因（都是真实情况，不是占位符） */
function warnText(item) {
  if (item.key === 'dist_commission' && !item.ready) return '待接入';
  if (item.key === 'withdraw' && !item.ready) return '待接入';
  if (item.key === 'pay_fee' && !item.ready) return '无实收';
  if (item.key === 'self_goods' && !item.ready) return '成本待录';
  return '';
}
function warnTitle(item) {
  if (item.key === 'dist_commission') return 'commission_flow 三级拆分明细表当前 0 行，此金额是真实 0，不是没算';
  if (item.key === 'withdraw') return 'withdraw 表当前 0 行，此金额是真实 0，不是没算';
  if (item.key === 'pay_fee') return '该区间内自营单无微信支付流水（CPS 钱不经我手），金额为真实 0';
  if (item.key === 'self_goods') return `${item.cost_missing} 单自营订单未录商家成本，毛利口径不完整`;
  return '';
}

const kpiCards = computed(() => (data.kpi ?? []).map((c) => ({ ...c, value: Number(c.value ?? 0) })));

/** 双柱（毛收入 / 现金支出）同轴；净收益以区间合计与 tooltip 呈现 */
const bars = computed(() => trend.value.map((x) => ({
  label: String(x.label),
  gross: Number(x.gross ?? 0),
  expense: Number(x.expense ?? 0),
  net: Number(x.net ?? 0),
})));
const trendMax = computed(() => Math.max(...bars.value.map((b) => Math.max(b.gross, b.expense)), 1));
function pct(v) {
  return Math.max(2, Math.min(100, (Math.abs(Number(v)) / trendMax.value) * 100));
}
function barTitle(b) {
  return `${b.label}\n毛收入 ¥${money(b.gross)}\n现金支出 ¥${money(b.expense)}\n净收益 ¥${money(b.net)}`;
}
function sumTrend(field) {
  return bars.value.reduce((a, x) => a + Number(x[field] ?? 0), 0);
}

const sourceLegend = computed(() => {
  const total = cpsTotal.value || 1;
  return sources.value.map((s) => ({ ...s, pct: Math.round((Number(s.amount || 0) / total) * 100) }));
});
const donutCss = computed(() => {
  const total = cpsTotal.value || 1;
  let acc = 0;
  const stops = sources.value.map((s, i) => {
    const from = (acc / total) * 100;
    acc += Number(s.amount || 0);
    return `${DONUT_COLORS[i % DONUT_COLORS.length]} ${from}% ${(acc / total) * 100}%`;
  });
  return stops.length ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(#f0dfc8 0% 100%)';
});

function statusText(row) {
  if (row.refund_status === 'refunded') return '已退款';
  if (row.fulfill_status === 'verified' || row.fulfill_status === 'used') return '已核销';
  return { created: '待付款', paid: '结算中', settled: '已结算', closed: '已关闭' }[row.platform_status] ?? row.platform_status ?? '—';
}
function statusCls(row) {
  if (row.refund_status === 'refunded') return 'st-refund';
  if (row.fulfill_status === 'verified' || row.fulfill_status === 'used') return 'st-ok';
  if (row.platform_status === 'settled') return 'st-ok';
  if (row.platform_status === 'closed') return 'st-closed';
  return 'st-wait';
}

/** 下单时间：YYYY-MM-DD HH:mm */
function fmtTime(t) {
  if (!t) return '—';
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function load() {
  try {
    const qs = new URLSearchParams({ range: range.value });
    if (range.value === 'custom' && customRange.value?.length === 2) {
      qs.set('from', customRange.value[0]);
      qs.set('to', customRange.value[1]);
    }
    const d = await adminApi(`/admin/dashboard/summary?${qs}`);
    Object.assign(data, d);
    // 侧栏「订单管理」角标：待结算单数（口径与看板一致）
    const unsettled = (d.kpi ?? []).find((c) => c.key === 'unsettled');
    emit('kpi', { pending_orders: Number(unsettled?.value ?? 0) });
  } catch (e) {
    ElMessage.error(e.message ?? '看板数据加载失败');
  }
}

function onRange(key) {
  range.value = key;
  if (key === 'custom' && customRange.value.length !== 2) {
    // 默认给近 7 天，避免面对空选择器
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const t = new Date();
    const f = new Date(t);
    f.setDate(t.getDate() - 6);
    customRange.value = [ymd(f), ymd(t)];
  }
  load();
}

function onAllOrders() {
  emit('go', 'orderlist');
}

onMounted(load);
</script>

<style scoped>
.ov { display: flex; flex-direction: column; gap: 14px; }

/* 顶行 */
.head-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.greet { font-size: 20px; font-weight: 900; color: #3d2530; margin: 0; }
.head-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.scope-pill {
  background: #fff; border: 1.5px solid #f0dfc8; border-radius: 999px;
  font-size: 12.5px; font-weight: 600; color: #3d2530; padding: 5px 12px;
}
.range-tabs { display: flex; gap: 4px; background: #fff; border: 1.5px solid #f0dfc8; border-radius: 999px; padding: 3px; }
.range-tab {
  border: none; background: transparent; cursor: pointer;
  font-size: 12.5px; font-weight: 700; color: #8a6b75;
  border-radius: 999px; padding: 5px 12px;
}
.range-tab.active { background: #e8336d; color: #fff; }

/* 主卡 */
.hero { background: linear-gradient(100deg, #c01c50 0%, #a31245 60%, #8e0f3c 100%); border-radius: 18px; padding: 22px 26px; color: #fff; }
.hero-label { font-size: 13.5px; font-weight: 700; opacity: 0.92; display: flex; align-items: center; gap: 10px; }
.hero-tip { font-size: 12px; font-weight: 800; border-radius: 999px; padding: 2px 10px; }
.hero-tip.good { background: rgba(255, 255, 255, 0.24); }
.hero-tip.bad { background: rgba(0, 0, 0, 0.26); }
.hero-tip.flat { background: rgba(255, 255, 255, 0.18); }
.hero-value { font-size: 38px; font-weight: 900; margin: 8px 0 6px; letter-spacing: -0.5px; }
.hero-sub { font-size: 13px; opacity: 0.9; }
.hero-sub b { margin: 0 6px; font-weight: 900; }

/* KPI */
.kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.kpi-card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 14px; padding: 13px 15px; }
.kpi-head { display: flex; align-items: center; justify-content: space-between; }
.kpi-label { font-size: 12.5px; color: #8a6b75; font-weight: 700; }
.trend { font-size: 11.5px; font-weight: 800; border-radius: 999px; padding: 2px 9px; }
.trend.good { background: #fdeef4; color: #e8336d; }
.trend.bad { background: #e8f6ee; color: #18a058; }
.trend.flat { background: #f3eee6; color: #8a6b75; }
.kpi-value { font-size: 23px; font-weight: 900; color: #3d2530; margin: 7px 0 3px; }
.kpi-value i { font-size: 13px; font-weight: 700; font-style: normal; color: #8a6b75; }
.kpi-sub { font-size: 11.5px; color: #b9a3ac; }

/* 账房 */
.ledger-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.panel { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 15px 17px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.panel-title { font-size: 14.5px; font-weight: 800; color: #3d2530; }
.panel-total { font-size: 12.5px; color: #8a6b75; }
.panel-total b { color: #e8336d; font-size: 14px; margin-left: 4px; }
.ledger-item { padding: 9px 0; border-top: 1px dashed #f0e4d4; }
.ledger-item:first-of-type { border-top: none; padding-top: 0; }
.li-main { display: flex; align-items: center; gap: 8px; }
.li-label { font-size: 13.5px; font-weight: 700; color: #3d2530; }
.li-warn {
  font-size: 10.5px; font-weight: 800; color: #8a6b75;
  border: 1px dashed #dcc9b4; border-radius: 999px; padding: 1px 8px; cursor: help;
}
.li-amount { font-size: 19px; font-weight: 900; color: #3d2530; margin: 3px 0 5px; font-variant-numeric: tabular-nums; }
.li-bar { height: 6px; background: #f6efe6; border-radius: 999px; overflow: hidden; }
.li-bar span { display: block; height: 100%; background: #e8336d; border-radius: 999px; }
.li-bar span.out { background: #ffaa1d; }
.li-desc { font-size: 11.5px; color: #a08592; margin-top: 5px; }
/* 不计入合计的行（第三方退款 / 灰行）：整行降透明度，金额位改为文字 */
.li-excluded { opacity: 0.62; }
.li-excluded .li-label { color: #8a6b75; }
.li-excluded .li-amount { font-size: 13px; font-weight: 800; color: #8a6b75; }
.li-excluded .li-bar { display: none; }
.li-cnt { font-size: 10.5px; color: #a08592; background: #f6efe6; border-radius: 999px; padding: 1px 7px; font-weight: 700; }
.ledger-warn { margin: 10px 0 0; font-size: 11.5px; color: #a31245; background: #fdeef4; border-radius: 10px; padding: 8px 10px; }
.ledger-note { margin: 10px 0 0; font-size: 11.5px; color: #a08592; }
.ingot-row {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 10px; padding: 8px 10px;
  background: #f6efe6; border-radius: 10px; border: 1px dashed #ddd0c0;
}
.ingot-label { font-size: 12px; color: #8a6b75; font-weight: 700; }
.ingot-amt { font-size: 13px; color: #8a6b75; font-weight: 800; }

/* 图表 */
.chart-row { display: grid; grid-template-columns: 1fr 330px; gap: 12px; }
.legend-inline { display: flex; gap: 14px; font-size: 11.5px; color: #8a6b75; }
.legend-inline span { display: flex; align-items: center; gap: 5px; }
.sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.sw-gross { background: #f8c7d8; }
.sw-out { background: #ffaa1d; }
.bars { display: flex; align-items: flex-end; gap: 8px; height: 175px; padding-top: 8px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; min-width: 0; }
.bar-stack { display: flex; flex-direction: column; justify-content: flex-end; width: 100%; max-width: 30px; height: 100%; }
.bar { width: 100%; }
.bar.gross { background: #f8c7d8; border-radius: 5px 5px 0 0; }
.bar.out { background: #ffaa1d; border-radius: 0 0 5px 5px; }
.bar-label { font-size: 10px; color: #b9a3ac; margin-top: 6px; white-space: nowrap; }
.chart-foot { margin: 10px 0 0; font-size: 11.5px; color: #8a6b75; }

.donut-wrap { display: flex; align-items: center; gap: 16px; }
.donut { width: 128px; height: 128px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.donut-hole {
  width: 76px; height: 76px; border-radius: 50%; background: #fff;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.donut-num { font-size: 14px; font-weight: 900; color: #3d2530; }
.donut-cap { font-size: 10px; color: #b9a3ac; }
.legend { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.legend-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.dot { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
.legend-name { color: #3d2530; font-weight: 600; }
.legend-pct { margin-left: auto; color: #8a6b75; font-weight: 700; }
.legend-empty { font-size: 11.5px; color: #b9a3ac; margin: 0; }

/* 成交额灰行：非平台收入，不可与收益混算 */
.gmv-row { background: #f3eee6; border: 1.5px dashed #ddd0c0; border-radius: 14px; padding: 13px 18px; color: #8a6b75; }
.gmv-title { font-size: 14px; font-weight: 800; }
.gmv-delta { font-size: 12px; font-weight: 800; margin-left: 10px; }
.gmv-delta.good { color: #1D9E75; }
.gmv-delta.bad { color: #993C1D; }
.gmv-delta.flat { color: #8a6b75; }
.gmv-note { margin: 6px 0 0; font-size: 11.5px; line-height: 1.5; }

/* 最近订单 */
.money { color: #e8336d; font-weight: 800; font-variant-numeric: tabular-nums; }
.money-muted { color: #a08592; font-weight: 600; font-variant-numeric: tabular-nums; }
.otime { font-size: 12px; color: #8a6b75; font-variant-numeric: tabular-nums; white-space: nowrap; }
.st { font-size: 11.5px; font-weight: 700; border-radius: 999px; padding: 3px 11px; }
.st-ok { background: #e8f6ee; color: #18a058; }
.st-wait { background: #fff8ea; color: #d98c0a; }
.st-closed { background: #f3eee6; color: #8a6b75; }
.st-refund { background: #fbecf0; color: #d03050; }
</style>
