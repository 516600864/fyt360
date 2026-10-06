<template>
  <!-- 账户设置（决策 #37 配套增补稿：账户下拉三个菜单项的落地页）
       单页三 Tab 走 query；不进侧栏、不占屏号。
       ① 个人资料 ② 修改密码（改后强制重登）③ 我的操作日志（仅本人，与 50 屏全站审计同源不同视角） -->
  <div class="acc">
    <div class="head-row">
      <div>
        <h2 class="page-title">账户设置</h2>
        <p class="page-sub">管理我的资料、密码与操作记录 · 所有写操作均留痕（admin_audit_log）</p>
      </div>
    </div>

    <div class="tabs">
      <button v-for="t in TABS" :key="t.key" class="tab" :class="{ active: tab === t.key }" @click="switchTab(t.key)">
        {{ t.label }}
      </button>
    </div>

    <!-- ① 个人资料 -->
    <div v-show="tab === 'profile'" class="panel">
      <div class="panel-head">
        <span class="panel-title">个人资料</span>
        <span class="panel-tip">昵称为空时展示登录账号；头像留空则用账号首字母</span>
      </div>
      <div v-if="loading" class="tip">加载中…</div>
      <div v-else class="form">
        <div class="row">
          <div class="label">头像</div>
          <div class="ctl avatar-ctl">
            <span class="ava">
              <img v-if="form.avatar" :src="form.avatar" alt="" />
              <template v-else>{{ initial }}</template>
            </span>
            <el-input v-model="form.avatar" placeholder="头像 URL（http/https 或站内路径，留空用首字母）" />
          </div>
        </div>
        <div class="row">
          <div class="label">昵称</div>
          <div class="ctl"><el-input v-model="form.nickname" maxlength="64" placeholder="展示名，留空用登录账号" /></div>
        </div>
        <div class="row">
          <div class="label">邮箱</div>
          <div class="ctl"><el-input v-model="form.email" placeholder="联系邮箱（不参与登录与通知下发）" /></div>
        </div>
        <div class="row">
          <div class="label">登录账号</div>
          <div class="ctl"><el-input :model-value="profile.username" disabled /></div>
        </div>
        <div class="row">
          <div class="label">角色</div>
          <div class="ctl">
            <span class="role-chip">{{ profile.role_label }}</span>
            <span class="scope-text">{{ profile.role === 'platform_admin' ? '超级管理员 · 平台工作台（可跨站只读聚合）' : '仅可访问绑定站点' }}</span>
          </div>
        </div>
        <div class="row">
          <div class="label">可访问站点</div>
          <div class="ctl">
            <span v-if="!profile.sites?.length" class="scope-text">暂无</span>
            <span v-for="s in profile.sites" :key="s.code" class="site-chip">
              {{ s.name }}<em>{{ s.scope }}</em>
            </span>
          </div>
        </div>
        <div class="row">
          <div class="label">创建时间</div>
          <div class="ctl"><span class="scope-text">{{ fmtTime(profile.created_at) }}</span></div>
        </div>
        <div v-if="profile.must_change_password" class="notice warn">
          该账号被标记为「必须修改密码」，请前往「修改密码」页完成设置。
        </div>
        <div class="actions">
          <el-button @click="loadProfile">重置</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </div>
    </div>

    <!-- ② 修改密码 -->
    <div v-show="tab === 'password'" class="panel">
      <div class="panel-head">
        <span class="panel-title">修改密码</span>
        <span class="panel-tip">修改成功后需重新登录</span>
      </div>
      <div class="form">
        <div class="row">
          <div class="label">当前密码</div>
          <div class="ctl"><el-input v-model="pwd.old_password" type="password" show-password placeholder="请输入当前密码" /></div>
        </div>
        <div class="row">
          <div class="label">新密码</div>
          <div class="ctl">
            <el-input v-model="pwd.new_password" type="password" show-password placeholder="至少 8 位" />
            <p class="hint">至少 8 位，建议字母 + 数字组合</p>
          </div>
        </div>
        <div class="row">
          <div class="label">确认新密码</div>
          <div class="ctl"><el-input v-model="pwd.confirm" type="password" show-password placeholder="再次输入新密码" /></div>
        </div>
        <div class="actions">
          <el-button @click="pwd = { old_password: '', new_password: '', confirm: '' }">重置</el-button>
          <el-button type="primary" :loading="changing" @click="changePwd">确认修改</el-button>
        </div>
      </div>
    </div>

    <!-- ③ 我的操作日志 -->
    <div v-show="tab === 'audit'" class="panel">
      <div class="panel-head">
        <span class="panel-title">我的操作日志</span>
        <span class="panel-tip">仅显示本人最近 30 天的写操作</span>
      </div>
      <div v-if="auditLoading" class="tip">加载中…</div>
      <el-table v-else :data="audit.items" size="small" empty-text="暂无操作记录">
        <el-table-column label="时间" width="150">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" min-width="180">
          <template #default="{ row }">
            <span class="act-chip">{{ ACTION_LABEL[row.action] ?? row.action }}</span>
          </template>
        </el-table-column>
        <el-table-column label="模块" width="110">
          <template #default="{ row }">{{ row.target_type || '—' }}</template>
        </el-table-column>
        <el-table-column label="对象" min-width="160">
          <template #default="{ row }">{{ row.target_id || '—' }}</template>
        </el-table-column>
        <el-table-column label="站点" width="130">
          <template #default="{ row }">{{ row.site_name || '平台级' }}</template>
        </el-table-column>
        <el-table-column label="IP" width="130">
          <template #default="{ row }">{{ row.ip || '—' }}</template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { adminApi } from '../../lib/api';

const props = defineProps({ tab: { type: String, default: 'profile' } });
const emit = defineEmits(['profile-loaded']);
const router = useRouter();

const TABS = [
  { key: 'profile', label: '个人资料' },
  { key: 'password', label: '修改密码' },
  { key: 'audit', label: '我的操作日志' },
];
const ACTION_LABEL = {
  'admin.password_change': '修改密码',
  'admin.profile_update': '更新个人资料',
  'admin.profile_update_sensitive': '更新头像/邮箱',
  'ingot.adjust': '元宝调账',
  'coupon.reissue': '重发券码',
  'user.disable': '禁用账号',
};

const tab = ref(props.tab);
const loading = ref(false);
const saving = ref(false);
const changing = ref(false);
const auditLoading = ref(false);
const profile = ref({ username: '', nickname: '', avatar: '', email: '', role: '', role_label: '', sites: [], must_change_password: false, created_at: '' });
const form = reactive({ nickname: '', avatar: '', email: '' });
const pwd = reactive({ old_password: '', new_password: '', confirm: '' });
const audit = ref({ items: [] });

const initial = computed(() => (form.nickname || profile.value.username || 'D').slice(0, 1).toUpperCase());
const fmtTime = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—');

watch(
  () => props.tab,
  (v) => { tab.value = v; if (v === 'audit' && !audit.value.items.length) loadAudit(); }
);

function switchTab(k) {
  tab.value = k;
  if (k === 'audit' && !audit.value.items.length) loadAudit();
}

async function loadProfile() {
  loading.value = true;
  try {
    const d = await adminApi('/admin/account/profile');
    profile.value = d;
    form.nickname = d.nickname ?? '';
    form.avatar = d.avatar ?? '';
    form.email = d.email ?? '';
  } catch (e) {
    ElMessage.error(e.message || '资料加载失败');
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    await adminApi('/admin/account/profile', { method: 'PATCH', body: JSON.stringify({ ...form }) });
    ElMessage.success('已保存');
    await loadProfile();
    emit('profile-loaded'); // 顶栏头像下拉同步昵称/头像
  } catch (e) {
    ElMessage.error(e.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function changePwd() {
  if (!pwd.old_password || !pwd.new_password) return ElMessage.warning('请填写完整');
  if (pwd.new_password.length < 8) return ElMessage.warning('新密码至少 8 位');
  if (pwd.new_password !== pwd.confirm) return ElMessage.warning('两次输入的新密码不一致');
  if (pwd.new_password === pwd.old_password) return ElMessage.warning('新密码不能与旧密码相同');
  changing.value = true;
  try {
    const d = await adminApi('/auth/admin/password', {
      method: 'POST',
      body: JSON.stringify({ old_password: pwd.old_password, new_password: pwd.new_password }),
    });
    // 决策 #37：改密成功后弹提示并强制重登（后端已同条把 must_change_password 置 false）
    if (d?.must_relogin) {
      await ElMessageBox.alert('修改成功，请重新登录。', '修改成功', {
        confirmButtonText: '重新登录',
        type: 'success',
      }).catch(() => {});
    } else {
      ElMessage.success('修改成功');
    }
    localStorage.removeItem('fyt_admin_token');
    localStorage.removeItem('fyt_admin_info');
    router.replace('/login');
  } catch (e) {
    ElMessage.error(e.message || '修改失败');
  } finally {
    changing.value = false;
  }
}

async function loadAudit() {
  auditLoading.value = true;
  try {
    const d = await adminApi('/admin/account/audit/mine?days=30&limit=100');
    audit.value = d;
  } catch (e) {
    ElMessage.error(e.message || '日志加载失败');
  } finally {
    auditLoading.value = false;
  }
}

onMounted(() => {
  loadProfile();
  if (tab.value === 'audit') loadAudit();
});
</script>

<style scoped>
.acc { display: flex; flex-direction: column; gap: 14px; }
.head-row { display: flex; align-items: flex-start; justify-content: space-between; }
.page-title { font-size: 21px; font-weight: 900; color: #3d2530; margin: 0; }
.page-sub { font-size: 12.5px; color: #9a7a86; margin: 6px 0 0; }

.tabs { display: flex; gap: 8px; }
.tab {
  border: 1.5px solid #f0dfc8; background: #fff; cursor: pointer;
  border-radius: 999px; padding: 7px 20px;
  font-size: 13.5px; font-weight: 700; color: #8a6b75;
}
.tab.active { background: #e8336d; border-color: #e8336d; color: #fff; }

.panel { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 16px 18px; }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
.panel-title { font-size: 15px; font-weight: 800; color: #3d2530; }
.panel-tip { font-size: 12px; color: #9a7a86; }
.tip { padding: 30px; text-align: center; color: #9a7a86; font-size: 13px; }

.form { display: flex; flex-direction: column; gap: 14px; }
.row { display: flex; align-items: flex-start; gap: 14px; }
.label { width: 90px; flex-shrink: 0; font-size: 13px; font-weight: 700; color: #3d2530; padding-top: 8px; }
.ctl { flex: 1; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; max-width: 560px; }
.avatar-ctl .el-input { flex: 1; min-width: 260px; }
.ava {
  flex-shrink: 0; width: 44px; height: 44px; border-radius: 50%; overflow: hidden;
  background: linear-gradient(135deg, #e8336d, #ffaa1d); color: #fff;
  display: flex; align-items: center; justify-content: center; font-size: 19px; font-weight: 900;
}
.ava img { width: 100%; height: 100%; object-fit: cover; }
.hint { width: 100%; margin: 4px 0 0; font-size: 11.5px; color: #9a7a86; }

.role-chip { background: #e8336d; color: #fff; border-radius: 999px; padding: 3px 12px; font-size: 12px; font-weight: 800; }
.site-chip {
  background: #fdf0f5; color: #a31245; border: 1.5px solid #f6d3e0;
  border-radius: 999px; padding: 3px 12px; font-size: 12px; font-weight: 700;
}
.site-chip em { margin-left: 5px; font-style: normal; font-size: 10.5px; opacity: 0.7; }
.scope-text { font-size: 12.5px; color: #9a7a86; }

.notice { border-radius: 12px; padding: 10px 14px; font-size: 12.5px; line-height: 1.6; }
.notice.warn { background: #fff6e9; border: 1.5px solid #ffd58f; color: #8a5a1b; }

.actions { display: flex; gap: 10px; padding-top: 6px; }
.act-chip {
  background: #fdf0f5; color: #a31245; border-radius: 6px;
  padding: 2px 8px; font-size: 12px; font-weight: 700;
}
</style>
