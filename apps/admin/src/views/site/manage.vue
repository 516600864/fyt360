<template>
  <!-- admin-31 站点管理（决策#43 收敛成「建壳 + 授权」）：平台超管 only
       行操作只有「进入站点 / 停用 / 删除」，不再有装饰·配置·域名三格 -->
  <div class="site-manage">
    <div class="head-row">
      <div>
        <h2 class="title">站点管理</h2>
        <p class="subtitle">平台只建壳，绝不碰凭据 · 新建站点后由客户自己登录本站完成凭据开通（决策 #43）</p>
      </div>
      <button class="primary-btn" @click="createOpen = true">
        <el-icon><Plus /></el-icon>
        新建站点
      </button>
    </div>

    <!-- 站点表 -->
    <div class="card">
      <el-table :data="sites" v-loading="loading" style="width: 100%" :header-cell-style="headerStyle">
        <el-table-column label="站点 / AppID" min-width="180">
          <template #default="{ row }">
            <div class="site-cell">
              <span class="site-name">{{ row.name }}</span>
              <span class="site-appid">{{ row.appid ?? '未配置 AppID' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="负责人" min-width="170">
          <template #default="{ row }">
            <span v-if="row.owner_username" class="owner">
              {{ row.owner_username }}<span class="owner-badge">负责人</span>
            </span>
            <span v-else class="muted">未指定</span>
          </template>
        </el-table-column>
        <el-table-column label="凭据开通" width="110" align="center">
          <template #default="{ row }">
            <span class="prov" :class="row.provisioned ? 'prov-ok' : 'prov-no'">
              {{ row.provisioned ? '已开通' : '未开通' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <span class="st" :class="`st-${row.status}`">
              <span class="st-dot"></span>{{ STATUS_TEXT[row.status] ?? row.status }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="110">
          <template #default="{ row }">{{ String(row.created_at).slice(0, 10) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" align="right">
          <template #default="{ row }">
            <el-link
              type="primary" :underline="false" class="op"
              @click="enterSite(row)"
            >进入站点</el-link>
            <span class="op-sep">·</span>
            <el-link
              v-if="row.status !== 'disabled'" type="warning" :underline="false" class="op"
              @click="onToggleStatus(row)"
            >停用</el-link>
            <el-link
              v-else type="success" :underline="false" class="op"
              @click="onToggleStatus(row)"
            >启用</el-link>
            <span class="op-sep">·</span>
            <el-link type="danger" :underline="false" class="op" @click="onDelete(row)">删除</el-link>
          </template>
        </el-table-column>
      </el-table>
      <p class="table-note">
        新建站点只建「壳」：不填任何 key。凭据（蚂蚁星球 / 小程序 / 支付 / 企微）一律由该站
        <b>负责人</b>登录本站后在「凭据开通」向导内自助配置 —— 凭据是钱袋子，平台不代持。
      </p>
    </div>

    <!-- 成员与授权 -->
    <div class="card member-card">
      <div class="member-head">
        <div>
          <h3 class="member-title">成员与授权</h3>
          <p class="member-sub">一个人可管理多站点 · 站点级独立角色 · 授权后登录先选站点（决策 #27）</p>
        </div>
        <button class="primary-btn small" @click="memberOpen = true">
          <el-icon><Plus /></el-icon>
          添加成员
        </button>
      </div>
      <el-table :data="members" v-loading="loading" style="width: 100%" :header-cell-style="headerStyle">
        <el-table-column label="账号" min-width="120">
          <template #default="{ row }">{{ row.username }}</template>
        </el-table-column>
        <el-table-column label="角色" width="140">
          <template #default="{ row }">
            <span class="role-tag" :class="row.role === 'platform_admin' ? 'role-platform' : 'role-site'">
              {{ row.role === 'platform_admin' ? '平台管理员' : '站点管理员' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="可管理站点" min-width="280">
          <template #default="{ row }">
            <span v-if="row.role === 'platform_admin'" class="muted">全部站点（聚合只读）</span>
            <span v-else-if="!row.sites.length" class="muted">未授权站点</span>
            <span v-else class="site-chips">
              <span v-for="s in row.sites" :key="s.code" class="site-chip">
                {{ s.name }}
                <b v-if="s.is_owner" class="chip-owner">负责人</b>
                <el-link
                  v-else type="info" :underline="false" class="chip-act"
                  @click="onTransfer(row, s)"
                >设为负责人</el-link>
              </span>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <span class="st" :class="`st-${row.status}`">
              <span class="st-dot"></span>{{ row.status === 'active' ? '启用' : '停用' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="right">
          <template #default="{ row }">
            <el-link
              type="primary" :underline="false" class="op"
              :disabled="row.sites.some((s) => s.is_owner)"
              @click="onEditMember(row)"
            >编辑</el-link>
            <span class="op-sep">·</span>
            <el-link
              type="danger" :underline="false" class="op"
              :disabled="row.sites.some((s) => s.is_owner)"
              @click="onRemoveMember(row)"
            >移除</el-link>
          </template>
        </el-table-column>
      </el-table>
      <div class="member-notice">
        <b>一站唯一负责人，负责人是该站凭据的唯一配置人。</b><br />
        负责人唯一拥有「凭据开通」写入权（平台超管代填等于跨站改客户钱袋子，绕过决策 #27）；
        停用成员不能当负责人；移交须在成员卡上对目标站点点「设为负责人」。
      </div>
    </div>

    <!-- 抽屉 1：新建站点（⛔ 只有 3 个字段，不出现任何 key 输入框） -->
    <el-drawer v-model="createOpen" title="新建站点" size="420px">
      <el-form label-width="88px" class="drawer-form">
        <el-form-item label="站点名称">
          <el-input v-model="formCreate.name" placeholder="如：半塔红色文化" maxlength="128" />
        </el-form-item>
        <el-form-item label="站点标识">
          <el-input v-model="formCreate.code" placeholder="小写字母开头，如 banta（小程序构建变量，不可改）" maxlength="32" />
        </el-form-item>
        <el-form-item label="负责人">
          <el-select v-model="formCreate.owner_admin_id" placeholder="可暂不指定，之后在成员卡上「设为负责人」" style="width: 100%" clearable>
            <el-option
              v-for="m in ownerCandidates" :key="m.admin_id"
              :label="m.username" :value="m.admin_id"
            />
          </el-select>
          <div class="form-hint">该站凭据的唯一配置人。留空则站点先建壳、稍后再指定负责人（新增账号前不必先有站点）。</div>
        </el-form-item>
        <div class="drawer-tip">
          建壳不填凭据。建完状态为「待开通」，请把站点负责人引导到「凭据开通」自助配置。
        </div>
      </el-form>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onCreate">创建站点</el-button>
      </template>
    </el-drawer>

    <!-- 抽屉 2：添加成员（多选站点 + 每站独立角色） -->
    <el-drawer v-model="memberOpen" title="添加成员" size="480px">
      <el-form label-width="88px" class="drawer-form">
        <el-form-item label="选择账号">
          <el-select v-model="formMember.admin_id" placeholder="已有后台账号" style="width: 100%">
            <el-option v-for="m in memberCandidates" :key="m.admin_id" :label="m.username" :value="m.admin_id" />
          </el-select>
        </el-form-item>
        <el-form-item label="授权站点">
          <div class="site-picker">
            <label v-for="s in sites" :key="s.site_id" class="pick-row">
              <el-checkbox v-model="formMember.site_ids" :value="s.site_id" />
              <span class="pick-name">{{ s.name }}</span>
              <!-- ⚠️ v-model 不能绑函数返回值（编译期即报错），必须用 :model-value + @change -->
              <el-select
                :model-value="roleOf(s.site_id)"
                size="small" style="width: 110px"
                @change="(v) => setRole(s.site_id, v)"
              >
                <el-option label="站点管理员" value="site_admin" />
                <el-option label="只读运营" value="readonly" />
              </el-select>
            </label>
          </div>
        </el-form-item>
        <div class="drawer-tip">
          添加成员不会改变该站负责人。负责人须在成员卡上单独「设为负责人」。
        </div>
      </el-form>
      <template #footer>
        <el-button @click="memberOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="onAddMember">确认添加</el-button>
      </template>
    </el-drawer>

    <div class="notice">
      新增一个小程序 = 后台建租户站点 + 上传新 appid 代码包，用户数据按 site_id 天然隔离；
      写操作一律在单站点上下文内进行（决策 #27）。已有业务数据的站点只能停用、不能删除 —— 历史订单与账房必须留痕。
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { adminApi, currentSite } from '../../lib/api.js';

const emit = defineEmits(['navigate']);

const loading = ref(false);
const saving = ref(false);
const sites = ref([]);
const members = ref([]);

const createOpen = ref(false);
const memberOpen = ref(false);
const formCreate = reactive({ code: '', name: '', owner_admin_id: '' });
const formMember = reactive({ admin_id: '', site_ids: [], roles: {} });

const headerStyle = { background: '#fff6e9', color: '#5c3a4a', fontWeight: 700 };

const STATUS_TEXT = { pending: '待开通', active: '运行中', disabled: '已停用' };

/** ⛔ 停用成员不能当负责人（初稿曾把已停用的老张写成半塔站负责人） */
const ownerCandidates = computed(() => members.value.filter((m) => m.status === 'active'));
const memberCandidates = computed(() => members.value.filter((m) => m.status === 'active'));
const roleOf = (siteId) => formMember.roles[siteId] ?? 'site_admin';
const setRole = (siteId, v) => { formMember.roles[siteId] = v; };

async function load() {
  loading.value = true;
  try {
    const [s, m] = await Promise.all([adminApi('/admin/sites'), adminApi('/admin/sites/members')]);
    sites.value = s.sites;
    members.value = m.members;
  } catch (e) {
    ElMessage.error(e.message ?? '加载失败');
  } finally {
    loading.value = false;
  }
}

function onCreate() {
  saving.value = true;
  adminApi('/admin/sites', {
    method: 'POST',
    body: JSON.stringify({
      code: formCreate.code.trim(),
      name: formCreate.name.trim(),
      owner_admin_id: formCreate.owner_admin_id || undefined,
    }),
  })
    .then((d) => {
      ElMessage.success(`站点已建壳（${d.code}），状态待开通`);
      createOpen.value = false;
      formCreate.code = ''; formCreate.name = ''; formCreate.owner_admin_id = '';
      return load();
    })
    .catch((e) => ElMessage.error(e.message))
    .finally(() => { saving.value = false; });
}

/** 「进入站点」= 把会话切到该站并跳凭据开通（未开通）或该站工作台 */
function enterSite(row) {
  if (!row.provisioned) {
    if (!row.owner_username) {
      ElMessage.warning('该站无负责人 —— 请先在「系统设置」建好账号，再在成员卡上「添加成员」并「设为负责人」，然后才能配置凭据');
      return;
    }
    const owner = members.value.find((m) => m.username === row.owner_username);
    if (!owner) { ElMessage.warning('负责人账号不存在，请先修正授权'); return; }
    localStorage.setItem('fyt_admin_site', JSON.stringify({ scope: 'site', code: row.code, name: row.name, site_id: row.site_id }));
    ElMessage.info(`已进入 ${row.name}：请在「凭据开通」完成配置`);
    emit('navigate', { key: 'provision', label: '凭据开通' });
    return;
  }
  localStorage.setItem('fyt_admin_site', JSON.stringify({ scope: 'site', code: row.code, name: row.name, site_id: row.site_id }));
  ElMessage.success(`已切换会话到 ${row.name}`);
  emit('navigate', { key: 'dashboard', label: '数据看板' });
}

async function onToggleStatus(row) {
  const next = row.status === 'disabled' ? 'active' : 'disabled';
  if (next === 'active' && !row.provisioned) {
    ElMessage.warning('该站尚未开通（蚂蚁星球凭据未通过连通测试），不能启用');
    return;
  }
  try {
    await ElMessageBox.confirm(
      next === 'disabled'
        ? `停用后「${row.name}」C 端立即不可访问，历史订单与账房保留。确认停用？`
        : `确认启用「${row.name}」？`,
      next === 'disabled' ? '停用站点' : '启用站点',
      { type: 'warning' },
    );
  } catch { return; }
  try {
    await adminApi(`/admin/sites/${row.site_id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
    ElMessage.success(next === 'disabled' ? '已停用' : '已启用');
    load();
  } catch (e) { ElMessage.error(e.message); }
}

async function onDelete(row) {
  try {
    await ElMessageBox.confirm(
      `删除「${row.name}」不可撤销。仅空壳站点可删；已有订单/商品/用户数据的站点请改用「停用」。`,
      '删除站点',
      { type: 'error', confirmButtonText: '确认删除', confirmButtonClass: 'el-button--danger' },
    );
  } catch { return; }
  try {
    await adminApi(`/admin/sites/${row.site_id}`, { method: 'DELETE' });
    ElMessage.success('已删除');
    load();
  } catch (e) { ElMessage.error(e.message); }
}

function onAddMember() {
  if (!formMember.admin_id) { ElMessage.warning('请选择账号'); return; }
  if (!formMember.site_ids.length) { ElMessage.warning('至少选择一个站点'); return; }
  // ⛔ 同款守卫：site_ids 来自多选框，理论上不该出现空值，但拼出 `/sites/undefined/members`
  //   会让服务端 500（22P02）。这里拦在发请求之前。
  if (formMember.site_ids.some((s) => !s)) {
    ElMessage.error('所选站点数据不完整，请刷新页面重试');
    return;
  }
  saving.value = true;
  Promise.all(
    formMember.site_ids.map((sid) =>
      adminApi(`/admin/sites/${sid}/members`, {
        method: 'POST',
        body: JSON.stringify({ admin_id: formMember.admin_id, site_role: roleOf(sid) }),
      }),
    ),
  )
    .then(() => {
      ElMessage.success('已添加授权');
      memberOpen.value = false;
      formMember.admin_id = ''; formMember.site_ids = []; formMember.roles = {};
      return load();
    })
    .catch((e) => ElMessage.error(e.message))
    .finally(() => { saving.value = false; });
}

function onEditMember(row) {
  ElMessage.info(`编辑成员权限请在「系统设置 → 管理员账号」操作（可改角色/站点绑定/重置密码）`);
  void row;
}

async function onRemoveMember(row) {
  const owns = row.sites.filter((s) => s.is_owner);
  if (owns.length) { ElMessage.warning(`不能移除负责人：${owns.map((s) => s.name).join('、')}`); return; }
  if (!row.sites.length) { ElMessage.info('该账号未授权任何站点'); return; }
  try {
    await ElMessageBox.confirm(`确认移除「${row.username}」的站点授权？`, '移除授权', { type: 'warning' });
  } catch { return; }
  try {
    for (const s of row.sites) {
      await adminApi(`/admin/sites/${s.site_id}/members/${row.admin_id}`, { method: 'DELETE' });
    }
    ElMessage.success('已移除');
    load();
  } catch (e) { ElMessage.error(e.message); }
}

/** 移交负责人：服务端会校验目标账号启用中；唯一索引保证一站只有一个负责人 */
async function onTransfer(memberRow, site) {
  // ⛔ 前端守卫：这份 site 来自 /admin/sites/members 的嵌套 JSON。
  //   2026-10-05 真实故障：该 JSON 漏了 site_id → 拼出 `/admin/sites/undefined` → 服务端 500。
  //   ⛔ 不做「兜底回查一次列表」来掩盖数据结构缺陷 —— 那样只会把同一个洞推迟到别处再爆。
  //     这里明确报错，让问题当场暴露；数据结构已同时在服务端补齐。
  if (!site?.site_id) {
    ElMessage.error('该站点数据缺少 site_id，无法移交（请刷新页面重试）');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `把「${site.name}」的负责人移交给 ${memberRow.username}？\n原负责人将降为普通站点管理员，且失去该站凭据配置权。`,
      '移交负责人',
      { type: 'warning' },
    );
  } catch { return; }
  try {
    await adminApi(`/admin/sites/${site.site_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ owner_admin_id: memberRow.admin_id }),
    });
    ElMessage.success('已移交负责人');
    load();
  } catch (e) { ElMessage.error(e.message); }
}

onMounted(load);
void currentSite;
</script>

<style scoped>
.site-manage { display: flex; flex-direction: column; gap: 16px; }

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
.primary-btn.small { margin-left: 0; padding: 7px 14px; font-size: 12.5px; }

.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 8px 14px 14px; }

.site-cell { display: flex; flex-direction: column; gap: 2px; }
.site-name { font-weight: 800; color: #3d2530; }
.site-appid { font-size: 11.5px; color: #a08592; font-family: Consolas, monospace; }
.muted { color: #c5b3a4; }

.owner { display: inline-flex; align-items: center; gap: 6px; color: #3d2530; font-weight: 700; font-size: 13px; }
.owner-badge {
  background: #e8336d; color: #fff; font-size: 10.5px; font-weight: 800;
  border-radius: 5px; padding: 2px 6px;
}
.prov { font-size: 12px; font-weight: 800; border-radius: 999px; padding: 3px 10px; }
.prov-ok { background: #e6f7ee; color: #1f9d61; }
.prov-no { background: #fff1e0; color: #a3691b; }

.st { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; }
.st-dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
.st-active .st-dot { background: #1f9d61; }
.st-active { color: #1f9d61; }
.st-pending .st-dot { background: #ffaa1d; }
.st-pending { color: #a3691b; }
.st-disabled .st-dot { background: #c5b3a4; }
.st-disabled { color: #a08592; }

.op-sep { color: #d9c2ae; margin: 0 4px; }
.op.is-disabled { color: #ddd; cursor: not-allowed; }

.table-note {
  margin: 10px 0 0; padding: 9px 12px; border-radius: 9px;
  background: #fdf6ec; color: #a3691b; font-size: 12px; line-height: 1.65;
}
.table-note b { color: #8a4d00; }

.member-card { padding-top: 16px; }
.member-head { display: flex; align-items: flex-start; margin-bottom: 10px; }
.member-title { margin: 0; font-size: 17px; font-weight: 900; color: #3d2530; }
.member-sub { margin: 5px 0 0; font-size: 12.5px; color: #a08592; }
.role-tag { font-size: 11.5px; font-weight: 800; border-radius: 6px; padding: 3px 10px; white-space: nowrap; }
.role-platform { background: #ffe9c9; color: #9a5b00; }
.role-site { background: #fde3ec; color: #a31245; }
.site-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.site-chip {
  background: #fff6e9; border: 1px solid #f0dfc8; color: #8a6b75;
  font-size: 11.5px; font-weight: 700; border-radius: 999px;
  padding: 2px 6px 2px 10px; display: inline-flex; align-items: center; gap: 6px;
}
.chip-owner { color: #fff; background: #e8336d; border-radius: 4px; padding: 1px 5px; font-size: 10px; }
.chip-act { font-size: 11px; }
.member-notice {
  margin-top: 12px; background: #fff6e9; color: #a3691b; border-radius: 10px;
  font-size: 12px; padding: 10px 14px; line-height: 1.6;
}
.member-notice b { color: #8a4d00; }

.drawer-form { padding-right: 8px; }
.drawer-tip {
  margin-top: 6px; background: #fdf6ec; color: #a3691b; border-radius: 8px;
  font-size: 12px; padding: 9px 12px; line-height: 1.6;
}
.form-hint { font-size: 12px; color: #a9907f; line-height: 1.6; margin-top: 4px; }
.site-picker { width: 100%; display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow: auto; }
.pick-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.pick-name { flex: 1; color: #3d2530; }

.notice {
  background: #fde3ec; color: #a31245; border-radius: 12px;
  font-size: 12.5px; padding: 12px 18px; line-height: 1.6;
}
</style>