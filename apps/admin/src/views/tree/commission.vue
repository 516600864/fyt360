<template>
  <!-- admin-33 佣金与元宝结算配置：等级比例（member_level 真数据）+ 元宝规则/不分配/提现门槛（platform_config） -->
  <div class="comm-page">
    <div class="head-row">
      <div>
        <h2 class="title">佣金与元宝结算配置</h2>
        <p class="subtitle">等级 / 比例 / 提现 / 激励开关 · 改动实时生效并下发各租户</p>
      </div>
    </div>

    <div class="grid">
      <div class="col-main">
        <div class="card">
          <div class="card-head">
            <span class="card-title">🏅 会员等级管理<span class="muted">（元宝兑换 · 永久有效）</span></span>
            <button class="gold-btn" :disabled="!isPlatform" @click="onAddLevel">＋ 新增等级</button>
          </div>
          <el-table :data="levels" v-loading="loading" style="width: 100%" :header-cell-style="headerStyle">
            <el-table-column label="等级" min-width="170">
              <template #default="{ row }">
                <span class="lv">{{ row.code }} {{ row.name }}</span>
                <span v-if="row.code === 'L1'" class="lv-badge grey">注册即得</span>
                <span v-else-if="row.code === 'L2'" class="lv-badge pink">当前用户主力</span>
                <span v-else-if="row.code === 'L3'" class="lv-badge deep">最高权益</span>
              </template>
            </el-table-column>
            <el-table-column label="兑换价" width="130">
              <template #default="{ row }">
                <template v-if="editing === row.code">
                  <el-input-number v-model="draft.ingot_price" :min="0" :step="500" size="small" controls-position="right" style="width: 110px" />
                </template>
                <template v-else>{{ row.ingot_price ? row.ingot_price.toLocaleString() + ' 元宝' : '—' }}</template>
              </template>
            </el-table-column>
            <el-table-column label="自购" width="110">
              <template #default="{ row }">
                <template v-if="editing === row.code"><el-input-number v-model="draft.self_rate" :min="0" :max="1" :step="0.05" size="small" controls-position="right" style="width: 96px" /></template>
                <span v-else :class="{ hot: row.self_rate > 0 }">{{ pct(row.self_rate) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="直推" width="110">
              <template #default="{ row }">
                <template v-if="editing === row.code"><el-input-number v-model="draft.direct_rate" :min="0" :max="1" :step="0.05" size="small" controls-position="right" style="width: 96px" /></template>
                <span v-else :class="{ hot: row.direct_rate > 0 }">{{ pct(row.direct_rate) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="间推" width="110">
              <template #default="{ row }">
                <template v-if="editing === row.code"><el-input-number v-model="draft.team_rate" :min="0" :max="1" :step="0.05" size="small" controls-position="right" style="width: 96px" /></template>
                <span v-else :class="{ hot: row.team_rate > 0 }">{{ row.team_rate > 0 ? pct(row.team_rate) : '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90">
              <template #default="{ row }">
                <template v-if="editing === row.code">
                  <a class="op save" @click.prevent="saveLevel(row)">保存</a>
                  <a class="op" @click.prevent="cancelEdit">取消</a>
                </template>
                <a v-else class="op" :class="{ disabled: !isPlatform }" @click.prevent="startEdit(row)">编辑</a>
              </template>
            </el-table-column>
          </el-table>
          <p class="tiny-note">微信支付 · 实名约束：佣金现金发放仅支持已实名账户；比例按受益人等级计算，基数=平台到手佣金。</p>

          <div class="stat-row">
            <div class="stat"><span class="stat-num">{{ stats.ingot_granted_total.toLocaleString() }}</span><span class="stat-cap">累计发放元宝</span></div>
            <div class="stat"><span class="stat-num">{{ stats.levels_active }}级</span><span class="stat-cap">可用等级档</span></div>
            <div class="stat"><span class="stat-num gold">¥{{ stats.today_estimate.toLocaleString() }}</span><span class="stat-cap">今日预估结算</span></div>
          </div>
          <div class="path-bar">分销路径：用户下单 → 平台实时划账 → 按上级等级三级分配 → 佣金到账（现金可提现）</div>
        </div>
      </div>

      <div class="col-side">
        <div class="card">
          <div class="card-title">◉ 元宝规则</div>
          <div class="rule-row">
            <span class="rule-label">自购元宝返还比例</span>
            <el-input-number v-model="ingotRule.self_return" :min="1" :step="10" size="small" controls-position="right" style="width: 128px" />
            <span class="rule-unit">元宝 / ¥1</span>
          </div>
          <div class="rule-row">
            <span class="rule-label">邀请单单奖励</span>
            <el-input-number v-model="ingotRule.invite_reward" :min="0" :step="50" size="small" controls-position="right" style="width: 128px" />
            <span class="rule-unit">元宝 / 人</span>
          </div>
          <p class="tiny-note">元宝不可提现，仅可兑换：仅可用于兑换会员等级 · 灵活配置 OP/团购/积分兑换订单率。</p>
          <button class="rose-btn" :disabled="!isPlatform" @click="saveIngotRule">保存规则</button>
        </div>

        <div class="card">
          <div class="card-title">◉ 不分配配置 <span class="muted">（决策 12）</span></div>
          <div v-for="it in distItems" :key="it.key" class="toggle-row">
            <div>
              <div class="toggle-label">{{ it.label }}</div>
              <div class="toggle-sub">未开启时该项下单不参与三级分配结算</div>
            </div>
            <el-switch v-model="it.on" :disabled="!isPlatform" @change="saveDistAlloc" />
          </div>
        </div>

        <div class="card">
          <div class="card-title">◉ 提现门槛与费率 <span class="muted">（决策 6）</span></div>
          <div class="wd-grid">
            <div class="wd-cell"><span class="wd-cap">起提金额</span><el-input-number v-model="wdRule.min_amount" :min="0" size="small" controls-position="right" style="width: 110px" /></div>
            <div class="wd-cell"><span class="wd-cap">平台费率</span><el-input-number v-model="wdRule.fee_rate" :min="0" :max="0.2" :step="0.005" size="small" controls-position="right" style="width: 110px" /></div>
            <div class="wd-cell"><span class="wd-cap">单笔限额</span><el-input-number v-model="wdRule.per_txn_limit" :min="1" :step="500" size="small" controls-position="right" style="width: 110px" /></div>
          </div>
          <p class="tiny-note">提现经由企业打款 · 企业付款到零钱，T+1 到账；{{ feeText }}</p>
          <button class="rose-btn" :disabled="!isPlatform" @click="saveWdRule">保存门槛</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';

const isPlatform = JSON.parse(localStorage.getItem('fyt_admin_info') ?? 'null')?.role === 'platform_admin';
const headerStyle = { background: '#fff6e9', color: '#3d2530', fontWeight: 700 };

const loading = ref(false);
const levels = ref([]);
const stats = ref({ ingot_granted_total: 0, levels_active: 0, today_estimate: 0 });
const ingotRule = ref({ self_return: 100, invite_reward: 500 });
const wdRule = ref({ min_amount: 10, fee_rate: 0, per_txn_limit: 5000 });
const distItems = ref([]);
const editing = ref('');
const draft = ref({});

const feeText = computed(() =>
  `当前费率 ${wdRule.value.fee_rate ? (wdRule.value.fee_rate * 100).toFixed(1) + '%' : '0%（免手续费）'} · 单笔限额 ¥${wdRule.value.per_txn_limit.toLocaleString()}`
);

const pct = (v) => `${(Number(v) * 100).toFixed(0)}%`;

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
    const d = await api('/admin/commission/config');
    levels.value = d.levels;
    stats.value = d.stats;
    ingotRule.value = { self_return: 100, invite_reward: 500, ...d.rules.ingot_rule };
    wdRule.value = { min_amount: 10, fee_rate: 0, per_txn_limit: 5000, ...d.rules.withdraw_rule };
    distItems.value = d.rules.dist_alloc?.items ?? [];
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

function startEdit(row) {
  if (!isPlatform) return ElMessage.info('结算规则仅平台管理员可修改');
  editing.value = row.code;
  draft.value = { ingot_price: row.ingot_price, self_rate: row.self_rate, direct_rate: row.direct_rate, team_rate: row.team_rate };
}
function cancelEdit() { editing.value = ''; }
async function saveLevel(row) {
  try {
    await api(`/admin/commission/levels/${row.code}`, { method: 'PATCH', body: draft.value });
    ElMessage.success(`${row.code} 档位已更新，实时生效`);
    editing.value = '';
    await load();
  } catch (e) { ElMessage.error(e.message); }
}
function onAddLevel() { ElMessage.info('等级档位扩展随运营里程碑开放（结算逻辑按 L1-L3 定稿）'); }
async function saveIngotRule() {
  try {
    await api('/admin/commission/config/ingot_rule', { method: 'PUT', body: { value: ingotRule.value } });
    ElMessage.success('元宝规则已保存');
  } catch (e) { ElMessage.error(e.message); }
}
async function saveDistAlloc() {
  try {
    await api('/admin/commission/config/dist_alloc', { method: 'PUT', body: { value: { items: distItems.value } } });
    ElMessage.success('不分配配置已保存');
  } catch (e) { ElMessage.error(e.message); }
}
async function saveWdRule() {
  try {
    await api('/admin/commission/config/withdraw_rule', { method: 'PUT', body: { value: wdRule.value } });
    ElMessage.success('提现门槛已保存');
  } catch (e) { ElMessage.error(e.message); }
}

onMounted(load);
</script>

<style scoped>
.comm-page { display: flex; flex-direction: column; gap: 16px; }
.head-row .title { font-size: 20px; font-weight: 900; color: #3d2530; margin: 0 0 4px; }
.subtitle { font-size: 12px; color: #b08a96; margin: 0; }
.grid { display: grid; grid-template-columns: 1fr 340px; gap: 16px; align-items: start; }
@media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
.col-main, .col-side { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 18px; }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.card-title { font-size: 14.5px; font-weight: 800; color: #3d2530; }
.muted { font-size: 12px; color: #b99aa4; font-weight: 500; }
.gold-btn {
  background: #ffaa1d; color: #5c3200; border: none; cursor: pointer;
  font-size: 12.5px; font-weight: 800; border-radius: 999px; padding: 7px 14px;
}
.gold-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.rose-btn {
  background: #e8336d; color: #fff; border: none; cursor: pointer;
  font-size: 13px; font-weight: 800; border-radius: 999px; padding: 9px 22px;
}
.rose-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.lv { font-weight: 800; color: #3d2530; }
.lv-badge { font-size: 10px; font-weight: 800; border-radius: 999px; padding: 1px 7px; margin-left: 6px; }
.lv-badge.grey { background: #eee; color: #888; }
.lv-badge.pink { background: #f7c9d8; color: #a31245; }
.lv-badge.deep { background: #3d2030; color: #ffaa1d; }
.hot { color: #e8336d; font-weight: 800; }
.op { color: #e8336d; font-size: 12.5px; font-weight: 700; margin-right: 8px; cursor: pointer; }
.op.disabled { color: #c9b6bd; }
.op.save { color: #1a9d5c; }
.tiny-note { font-size: 11px; color: #b99aa4; line-height: 1.7; margin: 10px 0 0; }
.stat-row { display: flex; gap: 12px; margin-top: 14px; }
.stat { flex: 1; background: #fff6e9; border-radius: 12px; padding: 12px 14px; }
.stat-num { font-size: 19px; font-weight: 900; color: #3d2530; display: block; }
.stat-num.gold { color: #e07800; }
.stat-cap { font-size: 11px; color: #b99aa4; }
.path-bar {
  margin-top: 14px; background: #fbdde9; color: #a31245;
  font-size: 12px; font-weight: 700; border-radius: 10px; padding: 9px 14px;
}
.rule-row { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
.rule-label { flex: 1; font-size: 12.5px; color: #6d4a56; font-weight: 600; }
.rule-unit { font-size: 11px; color: #b99aa4; width: 52px; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 0; }
.toggle-label { font-size: 13px; font-weight: 700; color: #3d2530; }
.toggle-sub { font-size: 11px; color: #b99aa4; margin-top: 2px; }
.wd-grid { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.wd-cell { flex: 1; min-width: 100px; background: #fff6e9; border-radius: 10px; padding: 8px 10px; }
.wd-cap { display: block; font-size: 11px; color: #b99aa4; margin-bottom: 5px; }
</style>
