<template>
  <!-- admin-49 底部菜单编辑器（115:178，决策#28/#30）：毛玻璃 4+1 —— Tab2~5 可配 + 导航风格 style + FAB 悬浮钮，tabbar-v2 随 /api/site/config 下发 -->
  <div class="tb-page">
    <div class="head-row">
      <div>
        <h2 class="title">底部菜单编辑器</h2>
        <p class="subtitle">小程序 custom-tab-bar 配置 · 胶囊 4+1（FAB 全站搜索可配）· Tab2~5 可改名称 / 双态图标 / 指向 · 保存后随站点配置下发</p>
      </div>
      <button class="save-btn" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存并下发' }}</button>
    </div>

    <div class="tb-grid">
      <!-- 左：手机预览 -->
      <div class="card phone-card">
        <div class="card-cap">预览 · iPhone 视口</div>
        <div class="phone">
          <div class="phone-head">
            <div class="ph-logo">FYT360</div>
            <div class="ph-sub">吃喝玩乐购 · 一站式全变现</div>
          </div>
          <div class="phone-body">
            <div class="ph-hint">配置保存后随站点配置下发，小程序端 custom-tab-bar 即时生效（壳页已上线）</div>
          </div>
          <div class="phone-tabbar" :class="style === 'glass' ? 'glass' : ''">
            <div v-for="(it, i) in items" :key="it.key" class="pt-item" :class="{ on: i === previewIdx }" @click="previewIdx = i">
              <img v-if="i === previewIdx && it.icon_active" :src="it.icon_active" class="pt-ic" />
              <img v-else-if="it.icon" :src="it.icon" class="pt-ic" />
              <span v-else class="pt-ic ph">{{ i === previewIdx ? (it.emoji_active || it.emoji || emojiOf(i, true)) : (it.emoji || emojiOf(i, false)) }}</span>
              <span class="pt-lb">{{ it.name }}</span>
            </div>
            <div v-if="fab.enabled" class="pt-fab" title="FAB 一键查券（不占槽位）">✨</div>
          </div>
        </div>
        <div class="muted pad" style="font-size:12px">
          {{ style === 'glass' ? '毛玻璃 4+1 实时预览：玻璃胶囊 + 激活玫红 + 深玫 FAB 鎏金星；点击菜单项预览选中态。' : '经典模式预览：通栏实底；未上传图标时显示兜底表情。' }}
        </div>
      </div>

      <!-- 右：菜单项列表 + 编辑 -->
      <div class="card edit-card">
        <div class="card-cap">
          菜单项（{{ items.length }}/5）
          <button v-if="items.length < 5" class="mini-add" @click="addItem">+ 添加菜单</button>
        </div>
        <div class="tb-scroll">
          <div v-for="(it, i) in items" :key="it.key" class="tb-row" :class="{ sel: selIdx === i }" @click="selIdx = i">
            <div class="tb-ics">
              <img v-if="it.icon" :src="it.icon" class="tb-ic" />
              <span v-else class="tb-ic ph">{{ emojiOf(i, false) }}</span>
              <img v-if="it.icon_active" :src="it.icon_active" class="tb-ic" />
              <span v-else class="tb-ic ph on">{{ emojiOf(i, true) }}</span>
            </div>
            <div class="tb-main">
              <b>{{ it.name }}</b>
              <span class="tb-target">{{ targetLabel(it) }}</span>
            </div>
            <span v-if="it.fixed" class="fixed-badge">固定</span>
            <div class="tb-tools" @click.stop>
              <button :disabled="i <= 0" @click="move(i, -1)">↑</button>
              <button :disabled="i >= items.length - 1" @click="move(i, 1)">↓</button>
              <button v-if="!it.fixed" class="danger" @click="items.splice(i, 1); if (selIdx >= items.length) selIdx = items.length - 1">✕</button>
            </div>
          </div>

          <template v-if="items[selIdx]">
            <div class="edit-block">
              <label class="f-label">菜单名称（≤5 字）</label>
              <el-input v-model="items[selIdx].name" size="large" maxlength="5" :disabled="!!items[selIdx].fixed" />
              <label class="f-label">指向（内置页或已发布的 Schema 页）</label>
              <el-select :model-value="targetCode(items[selIdx])" size="large" :disabled="!!items[selIdx].fixed" @change="(v) => onTargetChange(items[selIdx], v)">
                <el-option v-for="o in targetOptions" :key="o.value" :label="o.label" :value="o.value" :disabled="!o.value.startsWith('builtin:home') && usedTargets.includes(o.value) && targetCode(items[selIdx]) !== o.value" />
              </el-select>
              <div class="icon-grid">
                <div>
                  <label class="f-label">常规态图标</label>
                  <div class="img-up-row">
                    <img v-if="items[selIdx].icon" :src="items[selIdx].icon" class="ic-preview" />
                    <span v-else-if="items[selIdx].emoji" class="ic-preview ep">{{ items[selIdx].emoji }}</span>
                    <el-upload v-else :show-file-list="false" accept="image/png" :http-request="(o) => onUp(items[selIdx], 'icon', o)">
                      <button class="mini-up">⬆ 上传</button>
                    </el-upload>
                    <button v-if="items[selIdx].icon" class="mini-del" @click="items[selIdx].icon = ''">清除</button>
                  </div>
                  <div class="emoji-row">
                    <span class="emoji-opt" :class="{ on: !items[selIdx].icon && items[selIdx].emoji === e }" v-for="e in EMOJI_SET" :key="'a' + e" @click="pickEmoji(items[selIdx], 'emoji', e)">{{ e }}</span>
                  </div>
                </div>
                <div>
                  <label class="f-label">选中态图标</label>
                  <div class="img-up-row">
                    <img v-if="items[selIdx].icon_active" :src="items[selIdx].icon_active" class="ic-preview" />
                    <span v-else-if="items[selIdx].emoji_active" class="ic-preview ep">{{ items[selIdx].emoji_active }}</span>
                    <el-upload v-else :show-file-list="false" accept="image/png" :http-request="(o) => onUp(items[selIdx], 'icon_active', o)">
                      <button class="mini-up">⬆ 上传</button>
                    </el-upload>
                    <button v-if="items[selIdx].icon_active" class="mini-del" @click="items[selIdx].icon_active = ''">清除</button>
                  </div>
                  <div class="emoji-row">
                    <span class="emoji-opt" :class="{ on: !items[selIdx].icon_active && items[selIdx].emoji_active === e }" v-for="e in EMOJI_SET" :key="'b' + e" @click="pickEmoji(items[selIdx], 'emoji_active', e)">{{ e }}</span>
                  </div>
                </div>
              </div>
              <div class="muted" style="font-size:11.5px">建议 81×81px PNG；不上传图片可直接点选表情图标（端上优先图片，无图片用表情）。</div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 导航风格 + 悬浮钮 FAB（屏 49 增补行，对应 tabbar-v2 合同 style/fab 字段） -->
    <div class="card meta-card">
      <div class="meta-row">
        <div class="meta-head">
          <span class="meta-title">导航风格 style</span>
          <div class="chip-row">
            <span class="chip" :class="{ on: style === 'classic' }" @click="style = 'classic'">经典 classic</span>
            <span class="chip" :class="{ on: style === 'glass' }" @click="style = 'glass'">毛玻璃 4+1 · glass<span v-if="style === 'glass'"> ✓</span></span>
          </div>
        </div>
        <p class="meta-note">glass = backdrop-filter 毛玻璃胶囊（Android 不支持时奶油白 85% 降级）；壳页内容底部预留 120rpx 穿透区，玻璃悬浮于内容之上。</p>
      </div>
      <div class="meta-row">
        <div class="meta-head">
          <span class="meta-title">悬浮钮 FAB（+1）</span>
          <div class="chip-row">
            <span class="chip" :class="{ on: fab.enabled }" @click="fab.enabled = true">已开启<span v-if="fab.enabled"> ✓</span></span>
            <span class="chip" :class="{ on: !fab.enabled }" @click="fab.enabled = false">已关闭</span>
            <span class="chip-sep"></span>
            <span class="chip static">图标 ✨ sparkle</span>
            <el-select :model-value="fab.action ?? 'search'" size="large" style="width: 220px" @change="(v) => (fab.action = v)" filterable>
              <el-option-group label="快捷功能">
                <el-option v-for="o in FAB_TARGETS" :key="o.value" :label="o.label" :value="o.value" />
              </el-option-group>
              <el-option-group label="活动装修页（决策#34）">
                <el-option v-for="p in schemaPages" :key="p.page" :label="`${p.title || p.page}（${p.page}）`" :value="'page:' + p.page" />
              </el-option-group>
            </el-select>
          </div>
        </div>
        <p class="meta-note">FAB 是胶囊外独立圆钮（等高对齐），不占壳页槽位；动作可选快捷功能或活动装修页（page: 前缀），默认「全站搜索」（07b 搜索结果页）；关闭时胶囊恢复 4 均分。</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { uploadImage } from '../../upload.js';

const PAGES = [
  { label: '首页（固定）', value: 'home' },
  { label: '会员权益', value: 'rights' },
  { label: '生活服务', value: 'life' },
  { label: '我的订单', value: 'orders' },
  { label: '我的', value: 'mine' },
  { label: 'AI 管家', value: 'chat' },
];
const EMOJIS = { home: ['🏠', '🏡'], rights: ['👑', '💝'], life: ['🧭', '🧭'], orders: ['📋', '📚'], mine: ['👤', '🙋'], chat: ['🤖', '💬'] };
/** FAB 动作目标（站内页面任选；search=07b 全站搜索，端上 navigateTo，home 走 switchTab） */
const FAB_TARGETS = [
  { label: '全站搜索（07b·默认）', value: 'search' },
  { label: '首页', value: 'home' },
  { label: '会员权益', value: 'rights' },
  { label: '生活服务', value: 'life' },
  { label: '我的订单', value: 'orders' },
  { label: '我的', value: 'mine' },
  { label: 'AI 管家', value: 'chat' },
];
/** emoji 直选集（不上传图片时可直接选，决策#28 端上回退链：图片 → 表情 → 名称首字） */
const EMOJI_SET = ['🏠', '🎁', '📋', '👤', '⭐', '🛒', '💳', '🎯', '🔥', '📱', '🎫', '💎', '🏪', '🧭', '🙋'];

function pickEmoji(it, field, e) {
  // 再点一次同一表情 = 取消（回退到默认兜底）
  it[field] = it[field] === e ? '' : e;
}

const items = ref([]);
const saving = ref(false);
const selIdx = ref(0);
const previewIdx = ref(0);
/** tabbar-v2 元字段（决策#30）：导航风格 + FAB 悬浮钮（站点级） */
const style = ref('glass');
const fab = ref({ enabled: true, icon: 'sparkle', action: 'search' });

const schemaPages = ref([]);
const targetOptions = computed(() => [
  ...PAGES.map((p) => ({ label: p.label, value: `builtin:${p.value}` })),
  ...schemaPages.value.map((pg) => ({ label: `Schema · ${pg.title || pg.page}`, value: `schema:${pg.page}` })),
]);
const usedTargets = computed(() => items.value.slice(1).map((it) => targetCode(it)).filter(Boolean));
function targetCode(it) {
  return `${it?.target?.type ?? 'builtin'}:${it?.target?.value ?? ''}`;
}
function onTargetChange(it, code) {
  const [type, value] = String(code).split(':');
  it.target = { type, value };
}

function emojiOf(i, active) {
  const t = items.value[i]?.target?.value;
  return (EMOJIS[t] ?? ['⭐', '🌟'])[active ? 1 : 0];
}
function targetLabel(it) {
  const code = targetCode(it);
  if (code.startsWith('schema:')) {
    const pg = schemaPages.value.find((x) => x.page === it.target?.value);
    return `→ Schema · ${pg?.title || it.target?.value}`;
  }
  const p = PAGES.find((x) => x.value === it.target?.value);
  return p ? `→ ${p.label}` : '→ 未设置';
}

function move(i, d) {
  const arr = items.value;
  [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
  if (selIdx.value === i) selIdx.value = i + d;
}
function addItem() {
  items.value.push({ key: `tab${items.value.length + 1}`, name: '新菜单', icon: '', icon_active: '', target: { type: 'builtin', value: PAGES.find((p) => !usedTargets.value.includes(p.value))?.value ?? 'rights' } });
  selIdx.value = items.value.length - 1;
}
async function onUp(it, field, opt) {
  try {
    it[field] = await uploadImage(opt.file);
    ElMessage.success('图标已上传');
  } catch (e) { ElMessage.error(e.message); }
}

async function load() {
  try {
    const res = await fetch('/api/admin/tabbar');
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.message ?? '加载失败');
    items.value = body.data.items;
    style.value = body.data.style ?? 'glass';
    fab.value = body.data.fab ?? { enabled: true, icon: 'sparkle', action: 'search' };
  } catch (e) { ElMessage.error(e.message); }
}
async function save() {
  if (!items.value[0]?.fixed) { ElMessage.error('首项必须为固定「首页」'); return; }
  if (items.value.some((it) => !it.name?.trim())) { ElMessage.error('存在未命名的菜单项'); return; }
  saving.value = true;
  try {
    const res = await fetch('/api/admin/tabbar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items.value.map((it) => ({ ...it, name: it.name.trim() })), style: style.value, fab: fab.value }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.message ?? '保存失败');
    ElMessage.success(`已保存（${body.data.items} 项 · ${body.data.style}${body.data.fab?.enabled ? ' + FAB' : ''}）· 站点配置已下发，端上随小程序版本生效`);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}

onMounted(async () => {
  load();
  try {
    const res = await fetch('/api/admin/schema/pages');
    const body = await res.json();
    if (res.ok && body.ok) schemaPages.value = (body.data ?? []).filter((pg) => /^page-/.test(pg.page));
  } catch (e) { /* 列表失败不影响编辑器，仅缺 Schema 选项 */ }
});
</script>

<style scoped>
.tb-page { display: flex; flex-direction: column; gap: 14px; }
.head-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.title { margin: 0; font-size: 22px; font-weight: 900; color: #3d2530; }
.subtitle { margin: 6px 0 0; font-size: 13px; color: #a08592; }
.save-btn {
  background: #e8336d; border: none; color: #fff; cursor: pointer; font-weight: 800; font-size: 13px;
  border-radius: 999px; padding: 10px 22px; box-shadow: 0 3px 0 rgba(163, 18, 69, 0.35);
}
.save-btn:hover { background: #a31245; }
.save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.tb-grid { display: grid; grid-template-columns: 380px 1fr; gap: 14px; align-items: start; }
.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 8px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
.card-cap { font-weight: 900; color: #3d2530; padding: 8px 4px 4px; display: flex; align-items: center; gap: 10px; }

/* 手机预览 */
.phone { border: 3px solid #3d2530; border-radius: 28px; overflow: hidden; background: #fff6e9; }
.phone-head { background: #fff6e9; padding: 14px 14px 10px; }
.ph-logo { font-weight: 900; font-size: 17px; color: #e8336d; letter-spacing: 1px; }
.ph-sub { font-size: 10.5px; color: #a08592; margin-top: 2px; }
.phone-body { min-height: 300px; display: flex; align-items: center; justify-content: center; }
.ph-hint { font-size: 11.5px; color: #c9aeb8; text-align: center; padding: 0 20px; }
.phone-tabbar { display: flex; background: #fffdf7; border-top: 2px solid #3d2530; }
.pt-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 0 8px; cursor: pointer; }
.pt-ic { width: 22px; height: 22px; object-fit: contain; }
.pt-ic.ph { font-size: 18px; line-height: 22px; }
.pt-lb { font-size: 10px; color: #8c8577; font-weight: 600; }
.pt-item.on .pt-lb { color: #e8336d; font-weight: 800; }

/* glass mock（屏 49 实时预览：玻璃胶囊 + 激活玫红 + 深玫 FAB 鎏金星） */
.phone-tabbar.glass {
  position: relative;
  margin: 0 8px 10px;
  background: rgba(255, 253, 247, 0.85);
  backdrop-filter: blur(8px) saturate(1.5);
  border: 1.5px solid rgba(232, 51, 109, 0.16);
  border-top: 1.5px solid rgba(232, 51, 109, 0.16);
  border-radius: 999px;
  box-shadow: 0 5px 18px rgba(163, 18, 69, 0.18);
}
.pt-fab {
  position: absolute;
  right: 6px;
  top: -16px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(145deg, #e8336d, #a31245);
  border: 2px solid #ffe9b0;
  box-shadow: 0 4px 10px rgba(163, 18, 69, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  cursor: default;
}

/* 导航风格 & FAB 配置卡（屏 49 增补行） */
.meta-card { gap: 4px; }
.meta-row { display: flex; flex-direction: column; gap: 6px; padding: 10px 4px; border-bottom: 1.5px dashed #f0dfc8; }
.meta-row:last-child { border-bottom: none; }
.meta-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.meta-title { font-size: 13.5px; font-weight: 900; color: #3d2530; min-width: 110px; }
.chip-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chip {
  font-size: 12px; font-weight: 700; color: #7a5c68; background: #fff6e9;
  border: 1.5px solid #f0dfc8; border-radius: 999px; padding: 5px 14px; cursor: pointer; user-select: none;
}
.chip:hover { border-color: #e8336d; color: #e8336d; }
.chip.on { background: #e8336d; border-color: #e8336d; color: #fff; box-shadow: 0 2px 0 rgba(163, 18, 69, 0.35); }
.chip.static { cursor: default; color: #a3690f; background: #fff3d6; border-color: #f0dfc8; }
.chip.static:hover { border-color: #f0dfc8; color: #a3690f; }
.chip-sep { width: 1px; height: 16px; background: #f0dfc8; margin: 0 4px; }
.meta-note { margin: 0; font-size: 11.5px; color: #a08592; line-height: 1.6; }

/* 菜单列表 */
.mini-add { margin-left: auto; border: 1.5px dashed #e8336d; background: #fff; color: #e8336d; cursor: pointer; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 4px 12px; }
.mini-add:hover { background: #fdeef4; }
.tb-scroll { max-height: calc(100vh - 300px); overflow: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
.tb-scroll::-webkit-scrollbar { width: 6px; }
.tb-scroll::-webkit-scrollbar-thumb { background: #f0dfc8; border-radius: 3px; }
.tb-row { display: flex; align-items: center; gap: 10px; border: 1.5px solid #f0dfc8; border-radius: 12px; padding: 8px 10px; cursor: pointer; }
.tb-row.sel { border-color: #e8336d; background: #fff6e9; }
.tb-ics { display: flex; }
.tb-ic { width: 26px; height: 26px; object-fit: contain; border-radius: 6px; }
.tb-ic.ph { display: flex; align-items: center; justify-content: center; font-size: 16px; background: #fff6e9; }
.tb-ic.ph.on { background: #fce8f0; }
.tb-main { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.tb-main b { font-size: 13.5px; color: #3d2530; }
.tb-target { font-size: 11.5px; color: #a08592; }
.fixed-badge { background: #fce8f0; color: #a31245; font-size: 10.5px; font-weight: 800; border-radius: 999px; padding: 3px 9px; }
.tb-tools { display: flex; gap: 4px; }
.tb-tools button {
  border: 1.5px solid #f0dfc8; background: #fff; color: #3d2530; cursor: pointer;
  font-size: 11px; border-radius: 7px; width: 24px; height: 24px; line-height: 1;
}
.tb-tools button:hover:not(:disabled) { border-color: #e8336d; color: #e8336d; }
.tb-tools button:disabled { opacity: 0.35; cursor: not-allowed; }
.tb-tools button.danger { color: #e8336d; }

.edit-block { border-top: 1.5px dashed #f0dfc8; margin-top: 6px; padding: 12px 4px 4px; display: flex; flex-direction: column; gap: 8px; }
.icon-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.f-label { font-size: 12px; font-weight: 700; color: #7a5c68; margin-top: 4px; display: block; }
.img-up-row { display: flex; align-items: center; gap: 8px; }
.ic-preview { width: 44px; height: 44px; object-fit: contain; border: 1.5px solid #f0dfc8; border-radius: 10px; background: #fff6e9; }
.ic-preview.ep { display: flex; align-items: center; justify-content: center; font-size: 26px; }
.emoji-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; max-width: 220px; }
.emoji-opt { font-size: 17px; cursor: pointer; border: 1.5px solid transparent; border-radius: 7px; padding: 2px 4px; line-height: 1.3; }
.emoji-opt:hover { background: #fff6e9; }
.emoji-opt.on { border-color: #e8336d; background: #fdeef4; }
.mini-up { border: 1.5px dashed #e8336d; background: #fff; color: #e8336d; cursor: pointer; font-size: 11px; font-weight: 700; border-radius: 8px; padding: 6px 12px; }
.mini-up:hover { background: #fdeef4; }
.mini-del { border: none; background: none; color: #e8336d; cursor: pointer; font-size: 11px; }
.muted { color: #a08592; }
.pad { padding: 4px; }
</style>
