<template>
  <!-- 热搜词管理（032 迁移，2026-10-03）
       07B「相关搜索」真实词表。替换掉端上硬编码的 5 个词，其中「每日坚果」「空气炸锅」
       站内无此商品、点了必零结果。词源全部来自真实数据面（品牌/分类/权益），运营可增删改/调权重/启停。
       列表同时展示近 30 天真实搜索量，让运营知道哪些词真有人搜。 -->
  <div class="hw-page">
    <div class="head-row">
      <div>
        <h2 class="title">热搜词管理</h2>
        <p class="subtitle">07B「相关搜索」词表 · 权重越大越靠前 · 词源须为真实数据面（分类/品牌/权益），禁止凭空造词</p>
      </div>
      <div class="head-tools">
        <el-input v-model="kw" placeholder="搜索词" size="large" style="width: 180px" clearable @keyup.enter="load" />
        <el-button size="large" @click="load">查询</el-button>
        <el-button size="large" type="primary" @click="openCreate">+ 新增热词</el-button>
      </div>
    </div>

    <!-- 统计条：一眼看清词表规模与真实流量 -->
    <div class="stat-row">
      <div class="stat"><b>{{ list.length }}</b><span>当前词数</span></div>
      <div class="stat"><b>{{ enabledCount }}</b><span>已启用</span></div>
      <div class="stat"><b>{{ searchedCount }}</b><span>近30天有人搜</span></div>
      <div class="stat tip"><b>真热搜</b><span>词表 + 搜索量双维</span></div>
    </div>

    <!-- 编辑区（新增/编辑共用） -->
    <div v-if="editing" class="card">
      <div class="card-cap">{{ form.id ? '编辑热词' : '新增热词' }}</div>
      <div class="form-grid">
        <div>
          <label class="f-label">热词（≤64 字，须是站内真实存在的品牌/分类/权益名）</label>
          <el-input v-model="form.word" size="large" maxlength="64" placeholder="例：瑞幸 / 美团外卖 / 腾讯视频" />
        </div>
        <div>
          <label class="f-label">权重（越大越靠前）</label>
          <el-input-number v-model="form.weight" :min="0" :max="9999" size="large" controls-position="right" style="width: 100%" />
        </div>
        <div>
          <label class="f-label">启用</label>
          <el-switch v-model="form.enabled" />
        </div>
      </div>
      <div class="form-tip">
        权重参考：分类 1000 / 服务 600 / 权益 400（种子策略）。你可以按运营需要覆盖。
      </div>
      <div class="form-tools">
        <button class="save-btn" :disabled="saving || !form.word.trim()" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
        <button class="mini-btn" @click="editing = false">取消</button>
      </div>
    </div>

    <!-- 词表 -->
    <div class="card">
      <div class="card-cap">
        词表（{{ list.length }}）
        <span class="muted">· source 可溯源：category=分类 / service=品牌服务 / rights=蚂蚁权益 / manual=手工</span>
      </div>
      <el-table :data="list" v-loading="loading" size="default" :max-height="620" style="width: 100%">
        <el-table-column label="热词" min-width="180">
          <template #default="{ row }">
            <b class="hw-word">{{ row.word }}</b>
            <el-tag v-if="!row.enabled" size="small" type="info" class="off-tag">已停用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="权重" width="110" sortable :sort-method="(a,b)=>Number(a.weight)-Number(b.weight)">
          <template #default="{ row }"><b class="hw-w">{{ row.weight }}</b></template>
        </el-table-column>
        <el-table-column label="来源" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="srcType(row.source)">{{ srcLabel(row.source) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="近30天搜索" width="130" align="center">
          <template #default="{ row }">
            <b :class="Number(row.search_cnt) > 0 ? 'hot' : 'cold'">{{ row.search_cnt }}</b>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" align="right">
          <template #default="{ row }">
            <button class="mini-btn" @click="openEdit(row)">编辑</button>
            <button class="mini-btn" @click="toggle(row)">{{ row.enabled ? '停用' : '启用' }}</button>
            <button class="mini-btn danger" @click="remove(row)">删除</button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty">暂无热词。执行 <code>node deploy/scripts/seed-hotwords.mjs</code> 可从真实数据面一键生成。</div>
        </template>
      </el-table>
    </div>
  </div>
</template>

<script setup>
/**
 * 热搜词管理页（032 迁移）
 * 依赖端点：GET/PUT/DELETE /api/admin/hotwords（server/src/routes/admin-hotword.ts）
 * 改词后需调 POST /api/site/hot-words/invalidate 清端上 60s 缓存，否则端上最多延迟 60s 才生效。
 */
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const list = ref([]);
const loading = ref(false);
const saving = ref(false);
const kw = ref('');
const editing = ref(false);
const form = ref({ id: '', word: '', weight: 500, enabled: true });

const enabledCount = computed(() => list.value.filter((x) => x.enabled).length);
const searchedCount = computed(() => list.value.filter((x) => Number(x.search_cnt) > 0).length);

const srcLabel = (s) => ({ category: '分类', service: '品牌服务', rights: '蚂蚁权益', manual: '手工' }[s] ?? s);
const srcType = (s) => ({ category: 'warning', service: 'success', rights: 'info', manual: '' }[s] ?? '');

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.header ?? {}) };
  const t = localStorage.getItem('fyt_admin_token');
  if (t) headers.Authorization = 'Bearer ' + t;
  const res = await fetch(path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.ok === false) throw new Error(j.message ?? `HTTP ${res.status}`);
  return j.data;
}

async function load() {
  loading.value = true;
  try {
    const q = kw.value.trim();
    list.value = await api(`/api/admin/hotwords${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  } catch (e) {
    ElMessage.error('加载热词失败：' + e.message);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  form.value = { id: '', word: '', weight: 500, enabled: true };
  editing.value = true;
}
function openEdit(row) {
  form.value = { id: row.id, word: row.word, weight: Number(row.weight), enabled: !!row.enabled };
  editing.value = true;
}

async function save() {
  const word = form.value.word.trim();
  if (!word) return;
  saving.value = true;
  try {
    if (form.value.id) {
      await api(`/api/admin/hotwords/${form.value.id}`, {
        method: 'PUT',
        body: { word, weight: form.value.weight, enabled: form.value.enabled },
      });
      ElMessage.success('已保存');
    } else {
      await api('/api/admin/hotwords', {
        method: 'POST',
        body: { word, weight: form.value.weight, enabled: form.value.enabled },
      });
      ElMessage.success('已新增');
    }
    editing.value = false;
    await invalidateCache();
    await load();
  } catch (e) {
    ElMessage.error('保存失败：' + e.message);
  } finally {
    saving.value = false;
  }
}

async function toggle(row) {
  try {
    await api(`/api/admin/hotwords/${row.id}`, { method: 'PUT', body: { enabled: !row.enabled } });
    ElMessage.success(row.enabled ? '已停用' : '已启用');
    await invalidateCache();
    await load();
  } catch (e) {
    ElMessage.error('操作失败：' + e.message);
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除热词「${row.word}」？`, '删除确认', { type: 'warning' });
  } catch {
    return; // 用户取消
  }
  try {
    await api(`/api/admin/hotwords/${row.id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    await invalidateCache();
    await load();
  } catch (e) {
    ElMessage.error('删除失败：' + e.message);
  }
}

/** 清端上 60s 热词缓存，让改词立刻在 C 端生效 */
async function invalidateCache() {
  try {
    await api('/api/site/hot-words/invalidate', { method: 'POST', body: {} });
  } catch {
    // 失效失败不阻塞：最多 60s 后 TTL 自然过期
  }
}

onMounted(load);
</script>

<style scoped>
.hw-page { display: flex; flex-direction: column; gap: 16px; }
.head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.title { margin: 0; font-size: 22px; font-weight: 900; color: #3d2530; }
.subtitle { margin: 6px 0 0; font-size: 13px; color: #a08592; }
.head-tools { display: flex; gap: 10px; align-items: center; flex-shrink: 0; }

.stat-row { display: flex; gap: 12px; flex-wrap: wrap; }
.stat {
  flex: 1; min-width: 130px; background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px;
  padding: 12px 16px; display: flex; flex-direction: column; gap: 2px;
}
.stat b { font-size: 22px; font-weight: 900; color: #e8336d; }
.stat span { font-size: 12px; color: #a08592; }
.stat.tip b { font-size: 15px; color: #7a5c68; }

.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.card-cap { font-weight: 900; color: #3d2530; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.muted { font-size: 12px; color: #a08592; font-weight: 400; }

.form-grid { display: grid; grid-template-columns: 2fr 1fr 120px; gap: 14px; align-items: end; }
.f-label { font-size: 12px; font-weight: 700; color: #7a5c68; margin-bottom: 4px; display: block; }
.form-tip { font-size: 12px; color: #a08592; background: #fff6e9; border-radius: 10px; padding: 8px 12px; }
.form-tools { display: flex; gap: 10px; }

.save-btn {
  background: #ffaa1d; border: 2px solid #a31245; border-radius: 999px;
  padding: 10px 34px; font-size: 14px; font-weight: 900; color: #a31245; cursor: pointer;
}
.save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mini-btn {
  background: #fff6e9; border: 1.5px solid #e8d9c5; border-radius: 999px;
  padding: 5px 16px; font-size: 12px; font-weight: 700; color: #7a5c68; cursor: pointer;
}
.mini-btn:hover { background: #ffe3ec; }
.mini-btn.danger { color: #c0392b; border-color: #f0c0b8; }
.off-tag { margin-left: 8px; }
.hw-word { font-size: 15px; color: #3d2530; }
.hw-w { color: #a31245; }
.hot { color: #e8336d; }
.cold { color: #c9b8c0; }
.empty { padding: 30px; text-align: center; color: #a08592; font-size: 13px; }
.empty code { background: #fff6e9; padding: 2px 8px; border-radius: 6px; }
</style>
