<template>
  <!-- admin-42 AI 动态装修 + admin-30 DIY 编辑器：单菜单双视图（设计稿：菜单=AI 装修 ×1，两屏按钮互跳） -->
  <DiyEditor v-if="view === 'editor'" :initial-base="editorBase" @regen-ai="view = 'generate'" />
  <div v-else class="ai-page">
    <div class="head-row">
      <div>
        <h2 class="title">AI 动态装修 · 一句话建页</h2>
        <p class="subtitle">自然语言描述 → cloudbase-agent 生成页面 Schema → 预览微调 → 一键发布（小程序 / H5 同步生效）</p>
      </div>
      <div class="head-right">
        <span class="view-tabs">
          <button class="view-tab on">AI 建页</button>
          <button class="view-tab" @click="openEditor">页面装修</button>
        </span>
        <span class="site-chip">站点：{{ siteLabel }} · 小程序首页</span>
      </div>
    </div>

    <div class="flow-strip">① 自然语言描述 → ② LLM 生成页面 Schema → ③ JSON Schema 校验（不合格自动重试） → ④ 可视化预览 / 人工微调 → ⑤ 发布站点（即时回滚）</div>

    <div class="ai-grid">
      <!-- 左：生成需求 -->
      <div class="card">
        <div class="card-cap">
          生成需求
          <span class="mode-tabs">
            <button class="mode-tab" :class="{ on: genMode === 'page' }" @click="genMode = 'page'">装修页</button>
            <button class="mode-tab" :class="{ on: genMode === 'theme' }" @click="genMode = 'theme'">换肤</button>
          </span>
        </div>
        <textarea class="prompt-box" v-if="genMode === 'page'" v-model="prompt" placeholder="给中秋节做一个页面：顶部中秋氛围轮播，中间放电影和月饼团购模块，底部引流到京东商品。"></textarea>
        <textarea class="prompt-box" v-else v-model="prompt" placeholder="描述配色主题：例：海洋蓝主题，清爽夏天感觉，主色用深海蓝，辅助色用青绿。"></textarea>
        <div class="target-row" v-if="genMode === 'page'">
          <label class="radio"><input type="radio" value="existing" v-model="genTarget" /> 修改所选页面（{{ pageLabel(curPage) }}）</label>
          <label class="radio"><input type="radio" value="new" v-model="genTarget" /> 新增页面</label>
          <input v-if="genTarget === 'new'" class="new-title" v-model="newPageTitle" maxlength="30" placeholder="页面名称，如：中秋活动页" />
        </div>
        <div class="chip-row"><span class="chip" v-for="c in chips" :key="c">{{ c }}</span></div>
        <!-- 决策#34：换肤两步制——预览色板 → 确认应用（旧值存档可回滚） -->
        <div v-if="genMode === 'theme' && themePreview" class="theme-preview">
          <div class="tp-cap">配色预览 · 尚未生效</div>
          <div class="tp-grid">
            <div v-for="(v, k) in themePreview" :key="k" class="tp-item">
              <span class="tp-swatch" :style="{ background: v }"></span>
              <span class="tp-key">{{ k }}</span>
            </div>
          </div>
          <div class="tp-actions">
            <button class="primary-btn" :disabled="busy" @click="applyTheme">✓ 应用到全站</button>
            <button class="tp-ghost" @click="themePreview = null">放弃</button>
          </div>
        </div>
        <div v-if="genMode === 'theme'" class="tp-current">
          <span>当前主题：{{ curThemeKeys ? `${curThemeKeys} 项 token 已生效` : '默认波普（未自定义）' }}</span>
          <button class="tp-ghost" :disabled="busy" @click="rollbackTheme">回滚上一版</button>
          <button class="tp-ghost" :disabled="busy" @click="resetTheme">恢复默认波普</button>
        </div>
        <button class="primary-btn wide" :disabled="busy || !agentReady || prompt.trim().length < 4" @click="onGenerate">{{ busy ? '生成中…（约 10-30 秒）' : (genMode === 'theme' ? '生成配色预览' : '生成页面 Schema') }}</button>
        <div class="agent-note" v-if="agentReady === false">AI 通道不可用：{{ agentError || '请稍后重试' }}。</div>
        <div class="agent-note" v-else-if="genMode === 'theme'">换肤 = 全站配色（与上方所选页面无关）：AI 产 12 项色板 → 预览确认后才生效；可回滚上一版 / 一键恢复默认波普。要改单个页面请用「装修页」模式。</div>
        <div class="agent-note" v-else>AI 只产出受约束的页面 Schema（27 种已实现组件、非法输出自动重试 ≤2 次），生成结果存为 AI 草稿 → 去「页面装修」微调后发布。</div>
      </div>

      <!-- 中：实时预览（设计稿 42：手机壳内可视化渲染 published 楼层） -->
      <div class="card preview-card">
        <div class="card-cap">
          实时预览 · {{ pageLabel(curPage) }}
          <span class="gen-badge" v-if="curPage">已生成 ↑ v{{ curPage.version }}</span>
        </div>
        <div class="page-tabs">
          <button v-for="p in pageRows" :key="p.page" class="pill" :class="{ active: (curPage?.page) === p.page }" @click="selPage = p.page">{{ pageLabel(p) }}</button>
        </div>
        <div v-if="pageLoading" class="muted pad">加载中…</div>
        <div v-else-if="curPage" class="phone">
          <div class="phone-status"><span>16:30</span><span>5G ▮</span></div>
          <div class="phone-body">
            <template v-for="(f, i) in curFloors" :key="f.floor_id ?? i">
              <FloorPreview :floor="f" />
            </template>
            <div v-if="!curFloors.length" class="muted pad">published schema 无楼层</div>
          </div>
          <div class="phone-tabbar"><span class="on">🏠 首页</span><span>📋 订单</span><span>👤 我的</span></div>
        </div>
        <div v-else class="muted pad">该站点暂无 published 首页 schema</div>
        <div class="src-line" v-if="curPage">
          <span class="src-tag">{{ curPage.source === 'ai' ? 'source: ai' : 'source: manual' }}</span>
          <span class="ver-meta">{{ curPage.status }} · v{{ curPage.version }}</span>
        </div>
      </div>

      <!-- 右：Schema 结构 + 版本历史 -->
      <div class="col-right">
        <div class="card">
          <div class="card-cap">
            Schema 结构
            <span class="src-badge" v-if="curPage">{{ curPage.source === 'ai' ? 'source: ai' : 'source: manual' }}</span>
          </div>
          <div v-if="pageLoading" class="muted pad">加载中…</div>
          <template v-else-if="curPage">
            <div class="schema-tree">
              <div class="tree-root">· page: {{ curPage.page }}</div>
              <div v-for="(f, i) in curFloors" :key="i" class="tree-node">
                <span class="tree-dot">├</span> {{ floorSummary(f) }}
              </div>
              <div v-if="!curFloors.length" class="muted pad">无楼层</div>
            </div>
            <div class="validate-line" :class="curPage.status === 'published' ? 'ok' : 'draft'">
              {{ curPage.status === 'published' ? '✓ JSON Schema 校验通过 · 不合格自动重试' : '草稿 · 发布时执行 Schema 白名单校验' }}
            </div>
          </template>
          <div v-else class="muted pad">暂无 schema</div>
        </div>

        <div class="card ver-card">
          <div class="card-cap">版本历史 · llm_log 留痕</div>
          <div class="diff-bar">
            <el-select v-model="diffA" size="small" placeholder="版本 A" style="width: 108px">
              <el-option v-for="p in selPageVersions" :key="p.version" :label="`v${p.version} ${p.status}`" :value="p.version" />
            </el-select>
            <span class="diff-arrow">→</span>
            <el-select v-model="diffB" size="small" placeholder="版本 B" style="width: 108px">
              <el-option v-for="p in selPageVersions" :key="p.version" :label="`v${p.version} ${p.status}`" :value="p.version" />
            </el-select>
            <el-button size="small" type="primary" plain :disabled="!diffA || !diffB || diffA === diffB || diffLoading" :loading="diffLoading" @click="onDiff">对比差异</el-button>
          </div>
          <div class="ver-scroll">
            <div v-for="p in selPageVersions" :key="p.id" class="ver-item">
              <div class="ver-head">
                <b>{{ p.page === 'home' ? '小程序首页' : 'H5 首页' }} v{{ p.version }}</b>
                <span class="ver-meta">{{ p.status }} · {{ p.source }} · {{ (p.updated_at ?? '').slice(0, 16).replace('T', ' ') }}</span>
              </div>
              <div class="ver-floors">{{ p.floors.join(' → ') || '（无楼层）' }}</div>
              <div class="ver-actions">
                <el-button v-if="p.status === 'published'" size="small" plain @click="onRollback(p)">回滚到此版</el-button>
              </div>
            </div>
            <div v-if="!pageLoading && !pages.length" class="muted pad">暂无版本记录</div>
            <div class="log-cap">llm_log（生成留痕）</div>
            <div v-for="l in logs" :key="l.id" class="log-item">
              <span class="log-prompt">{{ l.prompt.slice(0, 40) }}{{ l.prompt.length > 40 ? '…' : '' }}</span>
              <span class="log-meta">
                v{{ l.version }} · {{ l.floor_cnt }} 楼层 · {{ l.status === 'failed' ? '❌失败' : `${l.duration_ms ?? 0}ms` }} · {{ (l.created_at ?? '').slice(0, 10) }}
                <el-button v-if="l.status === 'failed'" size="small" type="warning" plain :loading="retryingId === l.id" @click="onRetry(l)">重试</el-button>
              </span>
            </div>
            <div v-if="!pageLoading && !logs.length" class="muted pad">暂无生成留痕</div>
          </div>
        </div>
      </div>
    </div>

    <el-dialog v-model="diffOpen" :title="`版本对比 · ${pageLabel(curPage)} v${diffA} → v${diffB}`" width="560px">
      <div class="diff-stats" v-if="diffData">
        <span class="ds same">同 {{ diffData.stats.same }}</span>
        <span class="ds changed">改 {{ diffData.stats.changed }}</span>
        <span class="ds added">增 {{ diffData.stats.added }}</span>
        <span class="ds removed">删 {{ diffData.stats.removed }}</span>
        <span class="ds meta">{{ diffData.a.source }}·{{ diffData.a.status }} → {{ diffData.b.source }}·{{ diffData.b.status }}</span>
      </div>
      <div class="diff-list" v-if="diffData">
        <div v-for="d in diffData.diff" :key="d.index" class="diff-row" :class="d.status">
          <span class="d-idx">#{{ d.index + 1 }}</span>
          <span class="d-badge">{{ { same: '同', changed: '改', added: '增', removed: '删' }[d.status] }}</span>
          <span class="d-body">
            <template v-if="d.status === 'added'"><b class="nb">{{ d.b }}</b></template>
            <template v-else-if="d.status === 'removed'"><s class="ns">{{ d.a }}</s></template>
            <template v-else-if="d.status === 'changed'"><s class="ns">{{ d.a }}</s> → <b class="nb">{{ d.b }}</b></template>
            <template v-else>{{ d.a }}</template>
          </span>
        </div>
      </div>
    </el-dialog>

    <div class="notice notice-pink">AI 只产出受约束的页面 Schema，不直接产出代码；发布后小程序 / H5 同步生效，llm_log 全程留痕可回滚</div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import DiyEditor from '../diy/index.vue';
import FloorPreview from '../../components/FloorPreview.js';

// 单菜单双视图（设计稿 30/42）：generate=AI 建页（42）/ editor=页面装修（30）
const view = ref('generate');
/** 编辑器加载基线：直接进装修=发布版；AI 生成后带草稿进编辑器 */
const editorBase = ref('published');
function openEditor() {
  editorBase.value = 'published';
  view.value = 'editor';
}

async function api(path, opt = {}) {
  const r = await fetch('/api' + path, {
    ...opt,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token'), ...(opt.headers ?? {}) },
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.message || '请求失败');
  return j.data;
}

const admin = JSON.parse(localStorage.getItem('fyt_admin_info') ?? 'null');
// 站点徽标读会话真值源（决策#27 localStorage.fyt_admin_site，select-site 写入）；
// 禁用 admin.sites[0]——多站账号永远显示登录首站（2026-10-09 真实事故：新建站后徽标谎报）
const siteLabel = (() => {
  try {
    const s = JSON.parse(localStorage.getItem('fyt_admin_site') ?? 'null');
    if (s?.scope === 'site' && s.name) return s.name;
    if (s?.scope === 'all') return `平台工作台 · ${s.name ?? '全局'}`;
  } catch { /* ignore */ }
  return '未选站点';
})();

const prompt = ref('');
const chips = ['中秋大促', '年货节', '会员日'];
const pages = ref([]);
const logs = ref([]);
const selPage = ref('home');
const pageLoading = ref(false);
const agentReady = ref(null);
const agentError = ref('');
const busy = ref(false);
const genMode = ref('page'); // page=装修页 / theme=L1 换肤
const genTarget = ref('existing'); // existing=修改所选页面 / new=新增页面（B 方案多页面）
const newPageTitle = ref('');
const pageLabel = (p) => !p ? '' : p.title || (p.page === 'home' ? '小程序首页' : p.page === 'home_h5' ? 'H5 首页' : `${p.title ?? ''} ${p.page}`.trim());

// 按 page 去重（overview 返回全部版本行）：published 优先，否则取最新版本；每页仅一个代表行
const pageRows = computed(() => {
  const m = new Map();
  for (const p of pages.value) {
    const cur = m.get(p.page);
    if (!cur) { m.set(p.page, p); continue; }
    if (p.status === 'published' && cur.status !== 'published') m.set(p.page, p);
  }
  return [...m.values()];
});
const curPage = computed(() => pageRows.value.find((p) => p.page === selPage.value) ?? pageRows.value[0] ?? null);
const curFloors = computed(() => {
  const doc = curPage.value?.schema_json;
  return doc && typeof doc === 'object' && Array.isArray(doc.floors) ? doc.floors : [];
});

// Schema 结构树摘要（楼层 type + 关键 props）
function floorSummary(f) {
  const pr = f.props ?? {};
  const t = f.type;
  if (t === 'swiper') {
    const it = (pr.items ?? [])[0] ?? {};
    return `swiper楼层 · ${it.title ?? ''}${it.emphasize ? ' · ' + it.emphasize : ''}`;
  }
  if (t === 'nav') return `nav · ${(pr.items ?? []).length} 入口`;
  if (t === 'coupon-strip') return `coupon-strip · ${pr.amount ?? ''} ${pr.note_top ?? ''}`.trim();
  if (t === 'goods-feed') {
    const mode = f.data_source?.mode ?? 'platform_tab';
    return `goods-feed · ${mode === 'self' ? '到店团购选品' : (pr.title ?? '商品流')}`;
  }
  if (t === 'search-bar') return `search-bar · ${pr.placeholder ?? ''}`.trim();
  if (t === 'brand-chips') return `brand-chips · ${(pr.chips ?? []).length} 品牌`;
  if (t === 'notice') return `notice · ${(pr.texts ?? [])[0] ?? ''}`.trim();
  if (t === 'divider') return `divider · ${pr.title ?? ''}`.trim();
  if (t === 'rich-text') return `rich-text · ${pr.title ?? ''}`.trim();
  if (t === 'blank') return `blank · 间距 ${(pr.height ?? 24)}px`;
  if (t === 'ingot-entry') return `ingot-entry · ${pr.title ?? ''}`.trim();
  if (t === 'floor') return `floor · ${pr.title ?? '通用容器'}`;
  if (t === 'category-nav') return `category-nav · ${(pr.items ?? []).length} 分类`;
  if (t === 'seckill') return `seckill · ${(pr.items ?? []).length} 商品${pr.deadline ? ' · 倒计时' : ''}`;
  if (t === 'group-buy-floor') return `group-buy · ${(pr.items ?? []).length} 商品`;
  if (t === 'coupon-wall') return `coupon-wall · ${(pr.coupons ?? []).length} 券`;
  if (t === 'brand-matrix') return `brand-matrix · ${(pr.items ?? []).length} 品牌`;
  if (t === 'invite-floor') return `invite · ${pr.title ?? ''}`.trim();
  if (t === 'member-card') return `member-card · ${pr.title ?? ''}`.trim();
  if (t === 'activity-floor') return `activity · ${pr.title ?? ''}`.trim();
  if (t === 'image-hotzone') return `hotzone · ${(pr.zones ?? []).length} 热区`;
  if (t === 'video-floor') return `video · ${pr.title ?? '视频楼层'}`;
  if (t === 'countdown') return `countdown · ${pr.title ?? ''}`.trim();
  if (t === 'popup-modal') return `popup · ${pr.title ?? ''}`.trim();
  if (t === 'float-btn') return `float-btn · ${pr.text ?? ''}`.trim();
  return t;
}

async function load() {
  pageLoading.value = true;
  try {
    const d = await api('/admin/ai/overview');
    pages.value = d.pages;
    logs.value = d.logs;
    agentReady.value = !!d.agent_ready;
    agentError.value = d.agent_error ?? '';
  } catch (e) { ElMessage.error(e.message); } finally { pageLoading.value = false; }
}

/* ---- 异步生成轮询（2026-10-09 504 实锤：接入层 ~30s 掐同步连接，/generate 改秒回 job_id 后台跑） ---- */
async function pollJob(jobId, { timeoutMs = 180000, stepMs = 2000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, stepMs));
    let d;
    try {
      d = await api(`/admin/ai/generate/status/${jobId}`);
    } catch (e) {
      if (/任务不存在/.test(e.message)) throw e; // 404（过期/重启）直接失败
      continue; // 单次轮询网络抖动 → 吞掉继续，靠总超时兜底
    }
    if (d.status === 'ok') return d.result;
    if (d.status === 'failed') throw new Error(d.error || 'AI 生成失败');
  }
  throw new Error('AI 生成超时（3 分钟）——后台可能仍在跑，稍后刷新草稿列表查看结果');
}

async function onGenerate() {
  busy.value = true;
  try {
    if (genMode.value === 'theme') {
      // 决策#34 两步制：只出预览，不落 site.theme；确认生效走 applyTheme
      const d = await api('/admin/ai/theme/preview', { method: 'POST', body: JSON.stringify({ brief: prompt.value }) });
      themePreview.value = d.tokens ?? {};
      ElMessage.success(`配色预览已生成（${(d.duration_ms / 1000).toFixed(1)}s）——确认无误后点「应用到全站」`);
      return;
    }
    if (genTarget.value === 'new') {
      const title = newPageTitle.value.trim();
      if (title.length < 2) { ElMessage.warning('请先填写新页面名称（2~30 字）'); return; }
      const s = await api('/admin/ai/generate', { method: 'POST', body: JSON.stringify({ target: 'new', title, brief: prompt.value }) });
      ElMessage.info('AI 生成中（约 30~60 秒），请勿关闭页面…');
      const d = await pollJob(s.job_id);
      await load();
      selPage.value = d.page;
      ElMessage.success(`新页面「${title}」已生成（${d.page} · v${d.version} · ${d.floors} 层），已带入编辑器微调`);
      editorBase.value = 'draft';
      view.value = 'editor';
      return;
    }
    const page = curPage.value?.page ?? selPage.value;
    const s = await api('/admin/ai/generate', { method: 'POST', body: JSON.stringify({ page, brief: prompt.value }) });
    ElMessage.info('AI 生成中（约 30~60 秒），请勿关闭页面…');
    const d = await pollJob(s.job_id);
    ElMessage.success(`AI 已生成 ${d.floors} 层草稿（v${d.version}），已带入编辑器微调`);
    await load();
    // 设计稿流程：生成 → 在 DIY 编辑器微调 → 发布（base=draft 显式带草稿进编辑器）
    editorBase.value = 'draft';
    view.value = 'editor';
  } catch (e) { ElMessage.error(e.message); } finally { busy.value = false; }
}

async function onRollback(p) {
  try {
    await api('/admin/ai/rollback', { method: 'POST', body: JSON.stringify({ page: p.page, from_version: p.version }) });
    ElMessage.success(`已回滚：${p.page} 发布版本已恢复为 v${p.version} 内容`);
    load();
  } catch (e) { ElMessage.error(e.message); }
}

/* ---- 换肤两步制（决策#34）：预览 → 应用 / 恢复默认 ---- */
const themePreview = ref(null);
const curTheme = ref({});
const curThemeKeys = computed(() => Object.keys(curTheme.value ?? {}).length);
async function loadTheme() {
  try { const d = await api('/admin/ai/theme'); curTheme.value = d.theme ?? {}; } catch { /* 静默 */ }
}
async function applyTheme() {
  busy.value = true;
  try {
    const d = await api('/admin/ai/theme/apply', { method: 'POST', body: JSON.stringify({ tokens: themePreview.value, brief: prompt.value }) });
    themePreview.value = null;
    curTheme.value = d.theme ?? {};
    ElMessage.success(`配色已应用到全站（${d.merged_keys} 项 token）——小程序 / H5 重新进入即生效；旧配色已存档`);
  } catch (e) { ElMessage.error(e.message); } finally { busy.value = false; }
}
async function resetTheme() {
  try {
    await ElMessageBox.confirm('将恢复出厂默认波普配色（玫红/鎏金/奶油白），当前自定义配色会被覆盖。确定？', '恢复默认', { type: 'warning' });
  } catch { return; }
  busy.value = true;
  try {
    const d = await api('/admin/ai/theme/reset', { method: 'POST', body: JSON.stringify({}) });
    themePreview.value = null;
    curTheme.value = d.theme ?? {};
    ElMessage.success('已恢复默认波普配色');
  } catch (e) { ElMessage.error(e.message); } finally { busy.value = false; }
}
async function rollbackTheme() {
  busy.value = true;
  try {
    const d = await api('/admin/ai/theme/rollback', { method: 'POST', body: JSON.stringify({}) });
    curTheme.value = d.theme ?? {};
    ElMessage.success('已回滚到上一版配色——小程序 / H5 重新进入即生效');
  } catch (e) {
    ElMessage.warning(e?.message?.includes('ROLLBACK_NOT_FOUND') || e?.message?.includes('没有可回滚') ? '没有可回滚的上一版（未曾应用过换肤）' : e.message);
  } finally { busy.value = false; }
}

/* ---- 版本 diff 对比（#1）---- */
const diffA = ref(null);
const diffB = ref(null);
const diffLoading = ref(false);
const diffOpen = ref(false);
const diffData = ref(null);
const selPageVersions = computed(() =>
  pages.value.filter((p) => p.page === (curPage.value?.page ?? selPage.value))
    .sort((x, y) => y.version - x.version));

async function onDiff() {
  const page = curPage.value?.page ?? selPage.value;
  diffLoading.value = true;
  try {
    const d = await api(`/admin/ai/diff?page=${page}&a=${diffA.value}&b=${diffB.value}`);
    diffData.value = d;
    diffOpen.value = true;
  } catch (e) { ElMessage.error(e.message); } finally { diffLoading.value = false; }
}

/* ---- 失败留痕一键重试（#2）---- */
const retryingId = ref(null);
async function onRetry(l) {
  retryingId.value = l.id;
  try {
    const d0 = await api('/admin/ai/retry', { method: 'POST', body: JSON.stringify({ log_id: l.id }) });
    if (d0.job_id) {
      // 页面重试已异步化（同 /generate）：轮询拿结果
      ElMessage.info('AI 重试生成中（约 30~60 秒）…');
      const d = await pollJob(d0.job_id);
      ElMessage.success(`重试成功：AI 已生成 ${d.floors} 层草稿（v${d.version}），已带入编辑器微调`);
      view.value = 'editor';
    } else {
      const tk = d0.tokens ?? {};
      ElMessage.success(`重试成功：配色已生成并保存（${d0.merged_keys} 项 token，${(d0.duration_ms / 1000).toFixed(1)}s）：主色 ${tk.primary ?? '保持'} · 辅助 ${tk.secondary ?? '保持'}`);
    }
    load();
  } catch (e) { ElMessage.error(e.message); } finally { retryingId.value = null; }
}

onMounted(() => { load(); loadTheme(); });
</script>

<style scoped>
.ai-page { display: flex; flex-direction: column; gap: 16px; height: 100%; overflow: hidden; }
.head-row { display: flex; align-items: flex-start; }
.head-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.view-tabs { display: flex; background: #fff; border: 1.5px solid #f0dfc8; border-radius: 999px; padding: 3px; }
.view-tab { border: none; background: transparent; color: #8a6b75; font-size: 12.5px; font-weight: 700; border-radius: 999px; padding: 6px 16px; cursor: pointer; }
.view-tab.on { background: #e8336d; color: #fff; box-shadow: 0 2px 0 rgba(163, 18, 69, 0.3); }
.title { margin: 0; font-size: 22px; font-weight: 900; color: #3d2530; }
.subtitle { margin: 6px 0 0; font-size: 13px; color: #a08592; }
.site-chip { margin-left: auto; background: #fce8f0; color: #a31245; font-size: 12.5px; font-weight: 700; border-radius: 999px; padding: 8px 14px; }

.flow-strip { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 12px; padding: 10px 16px; font-size: 12.5px; font-weight: 700; color: #7a5c68; }

.ai-grid { display: grid; grid-template-columns: 1fr 1.15fr 1.15fr; gap: 14px; flex: 1; min-height: 0; align-items: stretch; }
.ai-grid > .card { min-height: 0; overflow: auto; }
.ai-grid > .col-right { min-height: 0; }
.col-right > .card { min-height: 0; overflow: auto; }
.ver-card { flex: 1; }
.col-right { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 8px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.card-cap { font-weight: 900; color: #3d2530; padding: 8px 4px 4px; display: flex; align-items: center; gap: 10px; }
.mode-tabs { margin-left: auto; display: flex; background: #fff6e9; border: 1.5px solid #f0dfc8; border-radius: 999px; padding: 3px; }
.mode-tab { border: none; background: transparent; color: #8a6b75; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 5px 14px; cursor: pointer; }
.mode-tab.on { background: #e8336d; color: #fff; box-shadow: 0 2px 0 rgba(163, 18, 69, 0.3); }
.pad { padding: 10px 4px; }
.muted { color: #c5b3a4; font-size: 13px; }

.prompt-box { width: 100%; min-height: 130px; resize: vertical; border: 1.5px solid #f0dfc8; border-radius: 12px; padding: 12px; font-size: 13px; color: #3d2530; box-sizing: border-box; }
.target-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.radio { display: flex; align-items: center; gap: 4px; font-size: 12.5px; color: #3d2530; font-weight: 700; cursor: pointer; }
.radio input { accent-color: #e8336d; }
.new-title { flex: 1; min-width: 140px; border: 1.5px solid #f0dfc8; border-radius: 999px; padding: 7px 14px; font-size: 12.5px; color: #3d2530; box-sizing: border-box; }
.chip-row { display: flex; gap: 8px; flex-wrap: wrap; }
.chip { background: #fff6e9; color: #a06a2c; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 5px 12px; }
.primary-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  background: #e8336d; color: #fff; border: none; cursor: pointer;
  font-size: 13px; font-weight: 700; border-radius: 999px; padding: 10px 18px;
  box-shadow: 0 3px 0 rgba(163, 18, 69, 0.3);
}
.primary-btn:hover { background: #d0295f; }
.primary-btn:disabled { background: #d8a8b8; cursor: not-allowed; }
.primary-btn.wide { width: 100%; }
.agent-note { font-size: 12px; color: #a08592; line-height: 1.6; }
/* 换肤两步制（决策#34） */
.theme-preview { margin-top: 10px; padding: 12px; border: 2px solid #e8b88a; border-radius: 12px; background: #fff9ee; }
.tp-cap { font-size: 12px; font-weight: 700; color: #a31245; margin-bottom: 8px; }
.tp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.tp-item { display: flex; align-items: center; gap: 5px; min-width: 0; }
.tp-swatch { width: 22px; height: 22px; border-radius: 6px; border: 2px solid #2b2b33; flex-shrink: 0; }
.tp-key { font-size: 10px; color: #8c8577; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-actions { display: flex; gap: 8px; margin-top: 10px; }
.tp-ghost { padding: 6px 12px; border: 2px solid #2b2b33; border-radius: 8px; background: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
.tp-ghost:hover { background: #fff3d6; }
.tp-current { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 12px; color: #8c8577; }

/* 中卡：实时预览 */
.preview-card { gap: 8px; }
.gen-badge { margin-left: auto; background: #ffaa1d; color: #5c3200; font-size: 10px; font-weight: 800; border-radius: 999px; padding: 2px 9px; }
.page-tabs { display: flex; gap: 8px; }
.pill { border: 1.5px solid #f0dfc8; background: #fff; color: #7a5c68; border-radius: 999px; padding: 6px 14px; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.pill.active { background: #fce8f0; border-color: #e8336d; color: #e8336d; }
.phone { width: 250px; margin: 0 auto; background: #fff; border: 2px solid #3d2530; border-radius: 26px; padding: 8px 10px; box-shadow: 0 6px 0 rgba(163, 18, 69, 0.12); }
.phone-status { display: flex; justify-content: space-between; font-size: 10px; color: #8a6b75; padding: 2px 6px 6px; font-weight: 700; }
.phone-body { display: flex; flex-direction: column; gap: 8px; background: #fff9f2; border-radius: 14px; padding: 10px 8px; min-height: 300px; max-height: 480px; overflow: auto; }
.phone-tabbar { display: flex; justify-content: space-around; padding: 8px 4px 2px; font-size: 10.5px; color: #b0898f; }
.phone-tabbar .on { color: #e8336d; font-weight: 800; }
.src-line { display: flex; align-items: center; gap: 10px; padding: 0 4px; }
.src-tag { font-size: 11.5px; color: #ffaa1d; font-weight: 800; }
.ver-meta { font-size: 11.5px; color: #a08592; }

/* 右卡：Schema 结构 */
.src-badge { background: #e8f7ee; color: #1f9d55; font-size: 10.5px; font-weight: 800; border-radius: 999px; padding: 2px 9px; }
.schema-tree { font-family: Consolas, 'Courier New', monospace; font-size: 12px; color: #5c3a4a; line-height: 1.9; }
.tree-root { font-weight: 800; color: #3d2530; }
.tree-node { padding-left: 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tree-dot { color: #d9a8bc; margin-right: 4px; }
.validate-line { border-radius: 10px; padding: 8px 12px; font-size: 12px; font-weight: 700; }
.validate-line.ok { background: #e8f7ee; color: #1f9d55; }
.validate-line.draft { background: #fff6e9; color: #a06a2c; }

/* 版本历史 */
.ver-item { border: 1.5px solid #f0dfc8; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.ver-head { display: flex; align-items: baseline; gap: 10px; }
.ver-head b { color: #3d2530; font-size: 13.5px; }
.ver-meta { font-size: 11.5px; color: #a08592; }
.ver-floors { font-size: 12px; color: #7a5c68; font-family: Consolas, monospace; }
.ver-actions { display: flex; justify-content: flex-end; }
.log-cap { font-weight: 900; color: #3d2530; font-size: 13px; border-top: 1.5px dashed #f0dfc8; padding-top: 10px; }
.log-item { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.log-prompt { color: #5c3a4a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-meta { color: #a08592; flex: none; }
.ver-scroll { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 4px; }
.ver-scroll::-webkit-scrollbar { width: 6px; }
.ver-scroll::-webkit-scrollbar-thumb { background: #f0dfc8; border-radius: 3px; }

/* 版本 diff 对比 */
.diff-bar { display: flex; align-items: center; gap: 8px; }
.diff-arrow { color: #a08592; font-weight: 900; }
.diff-stats { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.ds { font-size: 12px; font-weight: 800; border-radius: 999px; padding: 4px 12px; }
.ds.same { background: #f3efe7; color: #8c8577; }
.ds.changed { background: #fff3dd; color: #a06a2c; }
.ds.added { background: #e5f6ec; color: #2fa36b; }
.ds.removed { background: #fce8f0; color: #a31245; }
.ds.meta { background: #fff6e9; color: #a08592; font-weight: 700; }
.diff-list { max-height: 52vh; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.diff-row { display: flex; align-items: baseline; gap: 8px; font-size: 12.5px; border: 1.5px solid #f0dfc8; border-radius: 10px; padding: 7px 10px; }
.diff-row.same { opacity: 0.55; }
.diff-row.added { border-color: #9fd8b6; background: #f4fcf7; }
.diff-row.removed { border-color: #efb3c8; background: #fef4f7; }
.diff-row.changed { border-color: #ecc98f; background: #fffaf0; }
.d-idx { color: #c5b3a4; font-family: Consolas, monospace; flex: none; }
.d-badge { flex: none; font-weight: 900; font-size: 11px; border-radius: 6px; padding: 1px 7px; background: #f3efe7; color: #8c8577; }
.diff-row.added .d-badge { background: #e5f6ec; color: #2fa36b; }
.diff-row.removed .d-badge { background: #fce8f0; color: #a31245; }
.diff-row.changed .d-badge { background: #fff3dd; color: #a06a2c; }
.d-body { color: #5c3a4a; font-family: Consolas, monospace; }
.nb { color: #2fa36b; }
.ns { color: #c5b3a4; }

.notice { border-radius: 12px; padding: 10px 16px; font-size: 12.5px; }
.notice-pink { background: #fce8f0; color: #a31245; }
</style>
