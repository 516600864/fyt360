<template>
  <!-- admin-35 团购商品管理 + admin-36 团购核销 + admin-37 品牌三轨配置：侧栏「商品与品牌」子菜单驱动（tab 由壳层传入） -->
  <div class="brand-page">
    <div class="head-row">
      <div>
        <h2 class="title">{{ tab === 'goods' ? '到店团购管理' : '品牌三轨配置中心' }}</h2>
        <p class="subtitle">{{ tab === 'goods' ? '多规格 SKU · 到店团购核销 · 上下架与库存管理' : '每品牌三轨接入 · JSON Schema 校验 · 保存即下发小程序' }}</p>
      </div>
      <button v-if="tab === 'goods'" class="primary-btn" @click="openCreate">新增商品</button>
      <button v-else class="primary-btn" @click="onAddBrand">新增品牌</button>
    </div>

    <!-- ===== 团购商品 ===== -->
    <template v-if="tab === 'goods'">
      <div class="pill-bar">
        <button v-for="t in goodsTabs" :key="t.key" class="pill" :class="{ active: goodsTab === t.key }" @click="switchGoodsTab(t.key)">
          {{ t.label }} <b v-if="tabs[t.count] !== undefined">{{ tabs[t.count] }}</b>
        </button>
      </div>
      <div class="card">
        <el-table :data="goods" v-loading="loading" style="width: 100%" :header-cell-style="headerStyle">
          <el-table-column label="商品" min-width="240">
            <template #default="{ row }">
              <div class="goods-cell">
                <img v-if="row.img" :src="row.img" class="g-img" />
                <div v-else class="g-img g-img-ph">货</div>
                <span class="g-title">{{ row.title }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="所属站点" width="90">
            <template #default="{ row }"><span class="site-tag">{{ row.site }}</span></template>
          </el-table-column>
          <el-table-column label="售价" width="150">
            <template #default="{ row }">
              <span class="price">¥{{ row.price ?? '—' }}<template v-if="row.price_max && row.price_max !== row.price"> ~ {{ row.price_max }}</template></span>
              <span v-if="row.sku_count > 1" class="sku-n">{{ row.sku_count }} 规格</span>
            </template>
          </el-table-column>
          <el-table-column prop="stock" label="库存" width="90" />
          <el-table-column label="成本价（按规格）" width="150">
            <template #default="{ row }">
              <template v-if="row.cost_recorded > 0">
                <span v-if="row.cost_max !== row.cost_min" class="cost">
                  ¥{{ row.cost_min }}~{{ row.cost_max }}
                </span>
                <span v-else class="cost">¥{{ row.cost_min }}</span>
                <span v-if="row.cost_recorded < row.sku_count" class="cost-partial" :title="`${row.sku_count} 个规格里只录了 ${row.cost_recorded} 个，其余按下单时的兜底成本`">
                  {{ row.cost_recorded }}/{{ row.sku_count }} 规格
                </span>
              </template>
              <span v-else class="cost-missing" title="所有规格都未录成本 → 看板「到店团购毛利」不可算">待录入</span>
            </template>
          </el-table-column>
          <el-table-column label="履约方式" width="130">
            <template #default="{ row }">{{ row.delivery_type === 'group' ? '团购券 · 到店核销' : '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <span class="st" :class="row.status === 'on' ? 'st-on' : 'st-off'">
                <i class="st-dot" />{{ row.status === 'on' ? '上架中' : '已下架' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" align="right">
            <template #default="{ row }">
              <span class="ops">
                <el-link type="primary" @click="openEdit(row)">编辑</el-link>
                <el-link v-if="row.status === 'on'" type="warning" @click="toggleGoods(row, 'off')">下架</el-link>
                <el-link v-else type="success" @click="toggleGoods(row, 'on')">上架</el-link>
                <el-link type="danger" @click="removeGoods(row)">删除</el-link>
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div class="notice notice-pink">
        返元宝按实付金额 × 100 元宝计算；佣金比例 = 品类佣金 × 用户上线等级比例（L2 10% / L3 20%）· 三跳内分配
      </div>
    </template>

    <!-- ===== 品牌三轨 ===== -->
    <template v-else>
      <div class="brand-grid">
        <div class="card brand-list">
          <div class="card-cap">品牌列表（{{ filteredBrands.length }}<template v-if="searchKey">/{{ brands.length }}</template>）</div>
          <div class="brand-search"><input v-model="searchKey" placeholder="搜品牌名 / code，如：美团、kfc" /></div>
          <div class="brand-scroll">
            <div v-if="brandsLoading" class="muted pad">加载中…</div>
            <div v-else-if="!brands.length" class="muted pad">品牌配置为空（seed 未执行或已清空）</div>
            <div v-else-if="!filteredBrands.length" class="muted pad">没有匹配「{{ searchKey }}」的品牌</div>
            <div v-for="b in filteredBrands" :key="b.id" class="brand-item" :class="{ active: curBrand?.id === b.id }" @click="pickBrand(b)">
              <span class="b-avatar">{{ b.name.slice(0, 1) }}</span>
              <span class="b-main">
                <span class="b-name">{{ b.name }} <i v-if="b.enabled" class="b-on">已上线</i></span>
                <span class="b-meta">{{ b.category_name }} · {{ actionLabel(b.action_type) }}</span>
              </span>
            </div>
          </div>
        </div>
        <div class="card brand-detail" v-if="curBrand">
          <div class="detail-cap">
            <span>{{ curBrand.name }} · 三轨配置</span>
            <span class="schema-ok" v-if="cfgValid">Schema 校验通过 ✓</span>
            <span class="schema-bad" v-else>JSON 解析失败</span>
          </div>
          <div class="track-row">
            <button v-for="a in ['plugin','halfscreen','launch']" :key="a" class="track" :class="{ active: draft.action_type === a }" @click="draft.action_type = a">
              {{ actionLabel(a) }}
            </button>
          </div>
          <textarea class="cfg-box" v-model="cfgText" spellcheck="false"></textarea>
          <div class="detail-actions">
            <label class="switch-label">
              <el-switch v-model="draft.enabled" /> 上线
            </label>
            <button class="primary-btn" :disabled="!cfgValid" @click="saveBrand">保存并下发全部用户</button>
          </div>
          <div class="detail-note">三轨含义：① 官方小程序卡片打开 ② 半屏拉起 ③ 呼起公用小程序兑换页（蚂蚁星球）</div>
        </div>
        <div class="card brand-detail muted pad" v-else>← 从左侧选择品牌查看三轨配置</div>
      </div>
    </template>
    <!-- ===== 新建/编辑商品弹层（对齐画布 35 号屏增补稿：基础信息 + 履约二选一 + 多规格 SKU） ===== -->
    <el-dialog v-model="dlgVisible" :title="editId ? '编辑商品' : '新增商品'" width="620px" destroy-on-close>
      <div class="dlg-form">
        <div class="f-label">商品标题 <i>*</i></div>
        <el-input v-model="form.title" maxlength="255" placeholder="如：手作桂花糕 · 6 枚装" />

        <div class="f-label">主图（最多 5 张，≤3MB/张）</div>
        <div class="img-row">
          <div v-for="(u, i) in form.mainImgs" :key="u" class="img-thumb">
            <img :src="u" alt="" />
            <button class="img-x" @click="form.mainImgs.splice(i, 1)">✕</button>
          </div>
          <label v-if="form.mainImgs.length < 5" class="img-add">＋<input type="file" accept="image/*" hidden @change="onAddImg($event, 'main')" /></label>
        </div>

        <div class="f-label">履约方式</div>
        <div class="dlv-row">
          <button class="track active">🏪 到店核销（团购）</button>
        </div>
        <div class="dlv-hint">
          本站仅支持到店团购模式：下单生成核销券码，买家到店出示由核销员核销，流程复用团购核销（2026-09-29 需求更正：快递发货与微信小程序发货信息管理冲突，已全面移除）
        </div>

        <div class="f-label">规格、价格与成本（SKU，最多 20 个）<i>*</i></div>
        <div class="sku-box">
          <div class="sku-head">
            <span>规格名</span><span>售价 ¥</span><span>成本 ¥</span><span>库存</span><span></span>
          </div>
          <div v-for="(s, i) in form.skus" :key="i" class="sku-row">
            <el-input v-model="s.spec" size="small" placeholder="如：标准装" />
            <el-input-number v-model="s.price" :min="0.01" :precision="2" :step="1" size="small" controls-position="right" />
            <el-input-number
              v-model="s.cost" :min="0" :precision="2" :step="1" size="small" controls-position="right"
              placeholder="未录" :class="{ 'cost-warn': s.cost !== null && s.cost !== undefined && s.cost > s.price }"
            />
            <el-input-number v-model="s.stock" :min="0" :step="1" size="small" controls-position="right" />
            <button class="sku-del" :disabled="form.skus.length <= 1" @click="form.skus.splice(i, 1)">✕</button>
          </div>
        </div>
        <div class="sku-foot">
          <button class="ghost-btn" :disabled="form.skus.length >= 20" @click="form.skus.push({ spec: '', price: 1, cost: null, stock: 0 })">＋ 添加规格</button>
          <span class="sku-total">合计库存 <b>{{ totalStock }}</b></span>
          <button class="ghost-btn" :disabled="!form.skus.length" title="把所有规格成本一次性填成同一个数" @click="applyCostToAll">成本填全部规格</button>
        </div>
        <div class="dlv-hint">
          <b>成本价按规格录</b>——同一商品的「1 件」和「10 件」商家结算成本完全不同，
          用一个数算两个规格的毛利必错。留空 = 该规格未录成本，看板会标「成本待录入」（不猜不填 0）。
          成本在<b>下单瞬间按规格快照</b>到订单，之后改价不会篡改历史账房。
        </div>
      </div>
      <template #footer>
        <span class="dlg-footer">
          <button class="ghost-btn" @click="dlgVisible = false">取消</button>
          <button class="primary-btn" :disabled="!formOk" @click="saveGoods">保 存</button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, reactive, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { uploadImage } from '../../upload.js';

/** tab 由侧栏「商品与品牌」子菜单驱动：goods=团购商品管理 / brands=品牌三轨配置 */
const props = defineProps({ tab: { type: String, default: 'goods' } });
const tab = computed(() => props.tab);

async function api(path, opt = {}) {
  const r = await fetch('/api' + path, {
    ...opt,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token'), ...(opt.headers ?? {}) },
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.message || '请求失败');
  return j.data;
}

const headerStyle = { background: '#fff6e9', color: '#5c3a4a', fontWeight: 700 };

/* ---- 到店团购商品 ---- */
const goodsTabs = [
  { key: 'all', label: '全部', count: 'all_cnt' },
  { key: 'on', label: '上架中', count: 'on_cnt' },
    { key: 'off', label: '已下架', count: 'off_cnt' },
];
const goodsTab = ref('all');
const tabs = ref({});
const goods = ref([]);
const loading = ref(false);

async function loadGoods() {
  loading.value = true;
  try {
    const d = await api(`/admin/self-goods?tab=${goodsTab.value}&size=50`);
    tabs.value = d.tabs;
    goods.value = d.items;
  } catch (e) { ElMessage.error(e.message); } finally { loading.value = false; }
}
function switchGoodsTab(k) { goodsTab.value = k; }
async function toggleGoods(row, status) {
  try {
    await api(`/admin/self-goods/${row.goods_id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    ElMessage.success(status === 'on' ? '已上架' : '已下架');
    loadGoods();
  } catch (e) { ElMessage.error(e.message); }
}

/* ---- 团购商品：新建/编辑弹层 ---- */
const dlgVisible = ref(false);
const editId = ref(null);
const form = reactive({ title: '', mainImgs: [], detailImgs: [], delivery_type: 'group', skus: [{ spec: '', price: 1, cost: null, stock: 0 }] });

const totalStock = computed(() => form.skus.reduce((a, s) => a + (Number(s.stock) || 0), 0));
const formOk = computed(() =>
  form.title.trim().length > 0
  && form.skus.length > 0
  && form.skus.every((s) => Number(s.price) > 0 && Number(s.stock) >= 0 && Number.isFinite(Number(s.stock)))
  // 成本按规格校验（决策#38 + 039）：填了就必须是非负合法金额（空 = 未录，允许），
  // 且不得高于该规格售价——成本 > 售价必是录错，不是经营亏损。
  && form.skus.every((s) => s.cost === null || s.cost === undefined || s.cost === ''
    || (Number(s.cost) >= 0 && Number.isFinite(Number(s.cost)) && Number(s.cost) <= Number(s.price))),
);

/** 「成本填全部规格」：多规格同成本时的批量快捷方式（成本仍逐规格保存，语义不倒退） */
function applyCostToAll() {
  const target = form.skus[0]?.cost;
  form.skus.forEach((s) => { s.cost = target === '' ? null : target; });
}

function openCreate() {
  editId.value = null;
  Object.assign(form, { title: '', mainImgs: [], detailImgs: [], delivery_type: 'group', skus: [{ spec: '', price: 1, cost: null, stock: 0 }] });
  dlgVisible.value = true;
}

async function openEdit(row) {
  try {
    const d = await api(`/admin/self-goods/${row.goods_id}`);
    const skus = Array.isArray(d.skus) ? d.skus : [];
    editId.value = d.goods_id;
    Object.assign(form, {
      title: d.title,
      mainImgs: Array.isArray(d.main_imgs) ? d.main_imgs : [],
      detailImgs: Array.isArray(d.detail_imgs) ? d.detail_imgs : [],
      delivery_type: 'group', // 团购仅到店团购（2026-09-29 需求更正）
      // 成本按规格回填（039）：cost 缺失/空 → null（未录），绝不回落成 0 骗人
      skus: skus.length
        ? skus.map((s) => ({
            spec: String(s.spec ?? ''),
            price: Number(s.price),
            cost: s.cost === null || s.cost === undefined || s.cost === '' ? null : Number(s.cost),
            stock: Number(s.stock),
          }))
        : [{ spec: '', price: 1, cost: null, stock: 0 }],
    });
    dlgVisible.value = true;
  } catch (e) { ElMessage.error(e.message); }
}

async function saveGoods() {
  const body = {
    title: form.title.trim(),
    main_imgs: form.mainImgs,
    detail_imgs: form.detailImgs,
    delivery_type: form.delivery_type,
    // 成本逐规格传；空值原样传 null（后端 parseCostPrice 收 null = 该规格未录成本）
    skus: form.skus.map((s, i) => ({
      sku_id: `s${i + 1}`,
      spec: s.spec.trim() || '默认',
      price: Number(s.price),
      cost: s.cost === null || s.cost === undefined || s.cost === '' ? null : Number(s.cost),
      stock: Math.floor(Number(s.stock)),
    })),
  };
  try {
    if (editId.value) {
      await api(`/admin/self-goods/${editId.value}`, { method: 'PUT', body: JSON.stringify(body) });
      ElMessage.success('已保存');
    } else {
      await api('/admin/self-goods', { method: 'POST', body: JSON.stringify(body) });
      ElMessage.success('已创建并上架');
    }
    dlgVisible.value = false;
    loadGoods();
  } catch (e) { ElMessage.error(e.message); }
}

async function removeGoods(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.title}」？该操作不可恢复，有秒杀活动的商品无法删除。`, '删除商品', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    });
  } catch { return; }
  try {
    await api(`/admin/self-goods/${row.goods_id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    loadGoods();
  } catch (e) { ElMessage.error(e.message); }
}

async function onAddImg(e, kind) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const url = await uploadImage(file);
    (kind === 'main' ? form.mainImgs : form.detailImgs).push(url);
  } catch (err) { ElMessage.error(err.message); }
}

/* ---- 品牌三轨 ---- */
const brands = ref([]);
const brandsLoading = ref(false);
const curBrand = ref(null);
const draft = ref({ action_type: 'plugin', enabled: true });
const cfgText = ref('{}');
const cfgValid = computed(() => { try { JSON.parse(cfgText.value); return true; } catch { return false; } });
const searchKey = ref('');
const filteredBrands = computed(() => {
  const k = searchKey.value.trim().toLowerCase();
  if (!k) return brands.value;
  return brands.value.filter((b) => b.name.toLowerCase().includes(k) || (b.brand_code || '').toLowerCase().includes(k));
});

const ACTION_LABEL = { plugin: '① plugin 内嵌', halfscreen: '② halfscreen 半屏', launch: '③ launch 呼起' };
const actionLabel = (a) => ACTION_LABEL[a] ?? a;

async function loadBrands() {
  brandsLoading.value = true;
  try {
    const d = await api('/admin/brands');
    brands.value = d.items;
    if (brands.value.length && !curBrand.value) pickBrand(brands.value[0]);
  } catch (e) { ElMessage.error(e.message); } finally { brandsLoading.value = false; }
}
function pickBrand(b) {
  curBrand.value = b;
  draft.value = { action_type: b.action_type, enabled: b.enabled };
  cfgText.value = JSON.stringify(b.miniapp_cfg ?? {}, null, 2);
}
async function saveBrand() {
  try {
    const cfg = JSON.parse(cfgText.value);
    await api(`/admin/brands/${curBrand.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ action_type: draft.value.action_type, enabled: draft.value.enabled, miniapp_cfg: cfg }),
    });
    ElMessage.success('已保存并下发');
    loadBrands();
  } catch (e) { ElMessage.error(e.message); }
}
function onAddBrand() { ElMessage.info('新增品牌随供给侧扩容里程碑开放'); }

watch(tab, (t) => { if (t === 'brands' && !brands.value.length) loadBrands(); }, { immediate: true });
watch(goodsTab, loadGoods);
onMounted(loadGoods);
</script>

<style scoped>
.brand-page { display: flex; flex-direction: column; gap: 16px; }
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
.primary-btn:disabled { background: #d8a8b8; cursor: not-allowed; }
.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 8px 14px 14px; }
.pad { padding: 14px; }
.muted { color: #c5b3a4; font-size: 13px; }

.tab-row, .pill-bar { display: flex; gap: 10px; flex-wrap: wrap; }
.pill {
  border: 1.5px solid #f0dfc8; background: #fff; color: #7a5c68;
  border-radius: 999px; padding: 7px 16px; font-size: 13px; font-weight: 700; cursor: pointer;
}
.pill.active { background: #fce8f0; border-color: #e8336d; color: #e8336d; }
.pill b { color: #e8336d; }

.goods-cell { display: flex; align-items: center; gap: 10px; }
.g-img { width: 44px; height: 44px; border-radius: 10px; object-fit: cover; background: #fff6e9; }
.g-img-ph { display: flex; align-items: center; justify-content: center; color: #d8a8b8; font-weight: 900; border: 1.5px dashed #f0dfc8; }
.g-title { font-weight: 700; color: #3d2530; }
.site-tag { font-size: 12px; color: #a08592; font-family: Consolas, monospace; }
.price { color: #e8336d; font-weight: 900; }
.st { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
.st-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.st-on { color: #2fa36b; }
.st-off { color: #c5b3a4; }

.notice { border-radius: 12px; padding: 10px 16px; font-size: 12.5px; }
.notice-pink { background: #fce8f0; color: #a31245; }

/* —— 商品弹层 —— */
.ops { display: inline-flex; gap: 14px; }
.price { color: #e8336d; font-weight: 900; }
/* 成本价（决策#38）：已录显示金额，未录灰标「待录入」——未录不是 0 */
.cost { color: #5c3a4a; font-weight: 700; font-variant-numeric: tabular-nums; }
.cost-missing { color: #b9a3ac; font-size: 12px; border: 1px dashed #dcc9b4; border-radius: 999px; padding: 1px 8px; }
/* 成本按规格：多规格区间窄列 + 「只录了 N/M 个规格」提示 */
.cost-partial { margin-left: 5px; color: #b9a3ac; font-size: 11px; }
/* 成本高于售价：录错的信号，红框直接怼到输入框上，别让人猜 */
.cost-warn :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--fyt-danger, #d93025) inset; }
.sku-n { display: block; font-size: 11px; color: #a08592; font-weight: 500; }
.dlg-form { display: flex; flex-direction: column; gap: 8px; }
.f-label { font-size: 13px; font-weight: 800; color: #5c3a4a; margin-top: 8px; }
.f-label i { color: #e8336d; font-style: normal; }
.img-row { display: flex; gap: 10px; flex-wrap: wrap; }
.img-thumb { position: relative; width: 64px; height: 64px; border-radius: 10px; overflow: hidden; border: 1.5px solid #f0dfc8; }
.img-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.img-x {
  position: absolute; top: 2px; right: 2px; width: 16px; height: 16px;
  border: none; border-radius: 50%; background: rgba(61, 37, 48, 0.75);
  color: #fff; font-size: 10px; line-height: 16px; padding: 0; cursor: pointer;
}
.img-add {
  width: 64px; height: 64px; border: 1.5px dashed #e8a0b8; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: #e8336d; font-size: 20px; cursor: pointer; background: #fff6e9;
}
.img-add:hover { background: #fce8f0; }
.dlv-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dlv-hint { font-size: 12px; color: #a08592; margin: 2px 0 4px; }
.sku-box { border: 1.5px solid #f0dfc8; border-radius: 12px; padding: 8px 10px; background: #fffdf8; }
.sku-head, .sku-row { display: grid; grid-template-columns: 1fr 120px 120px 110px 28px; gap: 8px; align-items: center; }
.sku-head { font-size: 11.5px; color: #a08592; font-weight: 700; padding: 0 2px 6px; }
.sku-row { padding: 4px 0; }
.sku-del {
  border: none; background: transparent; color: #c5b3a4; cursor: pointer;
  font-size: 13px; width: 24px; height: 24px; border-radius: 6px;
}
.sku-del:hover:not(:disabled) { color: #e8336d; background: #fce8f0; }
.sku-del:disabled { opacity: 0.35; cursor: not-allowed; }
.sku-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
.sku-total { font-size: 12.5px; color: #7a5c68; }
.sku-total b { color: #e8336d; font-size: 14px; }
.ghost-btn {
  border: 1.5px solid #e8a0b8; background: #fff; color: #a31245; cursor: pointer;
  font-size: 13px; font-weight: 700; border-radius: 999px; padding: 7px 16px;
}
.ghost-btn:hover:not(:disabled) { background: #fce8f0; }
.ghost-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.dlg-footer { display: inline-flex; gap: 12px; }
.dlg-footer .primary-btn { margin-left: 0; }

.brand-grid { display: grid; grid-template-columns: 320px 1fr; gap: 14px; align-items: start; }
.brand-list { display: flex; flex-direction: column; max-height: calc(100vh - 190px); padding-bottom: 8px; }
.brand-search { padding: 0 4px 8px; }
.brand-search input {
  width: 100%; box-sizing: border-box;
  border: 1.5px solid #f0dfc8; border-radius: 999px; padding: 7px 14px;
  font-size: 13px; color: #3d2530; background: #fffdf8; outline: none;
}
.brand-search input:focus { border-color: #e8336d; }
.brand-scroll { overflow-y: auto; min-height: 120px; flex: 1; }
.brand-detail { position: sticky; top: 76px; }
.card-cap { font-weight: 900; color: #3d2530; padding: 8px 4px 10px; }
.brand-item { display: flex; gap: 10px; padding: 10px 8px; border-radius: 12px; cursor: pointer; align-items: center; }
.brand-item:hover { background: #fff6e9; }
.brand-item.active { background: #fce8f0; }
.b-avatar { width: 34px; height: 34px; border-radius: 10px; background: #e8336d; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 900; flex: none; }
.b-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.b-name { font-weight: 800; color: #3d2530; font-size: 13.5px; }
.b-on { font-style: normal; color: #2fa36b; font-size: 11px; margin-left: 6px; }
.b-meta { font-size: 11.5px; color: #a08592; }

.brand-detail { display: flex; flex-direction: column; gap: 12px; }
.detail-cap { display: flex; justify-content: space-between; align-items: center; font-weight: 900; color: #3d2530; padding: 8px 4px 0; }
.schema-ok { font-size: 12px; color: #2fa36b; font-weight: 700; }
.schema-bad { font-size: 12px; color: #d0295f; font-weight: 700; }
.track-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.track {
  border: 1.5px solid #f0dfc8; background: #fff; border-radius: 999px;
  padding: 9px 0; font-size: 13px; font-weight: 700; color: #7a5c68; cursor: pointer;
}
.track.active { background: #e8336d; border-color: #e8336d; color: #fff; }
.cfg-box {
  width: 100%; min-height: 150px; resize: vertical;
  background: #2b1e26; color: #ffd9a8; border: none; border-radius: 12px;
  font-family: Consolas, monospace; font-size: 12.5px; padding: 12px; box-sizing: border-box;
}
.detail-actions { display: flex; align-items: center; gap: 16px; }
.switch-label { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: #5c3a4a; }
.detail-note { font-size: 12px; color: #a08592; }
</style>
