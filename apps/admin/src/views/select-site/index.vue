<template>
  <!-- admin-48 站点选择页（决策#27）：登录后锁会话单站；超管可进平台工作台聚合只读 -->
  <div class="pick-page">
    <span class="blob blob-a"></span>
    <span class="blob blob-b"></span>
    <span class="blob blob-c"></span>

    <div class="card">
      <div class="brand-row">
        <img class="logo" :src="logo" alt="FYT360" />
        <span class="brand-text">FYT360 管理台</span>
      </div>
      <h1 class="title">选择要进入的站点</h1>
      <p class="sub">您好 {{ adminName }}，您对以下站点有管理权限；进入后当前会话将锁定该站点（决策 #27）</p>

      <div v-if="loading" class="loading" v-loading="true" element-loading-background="transparent"></div>
      <template v-else>
        <button
          v-for="s in sites"
          :key="s.code"
          class="site-card"
          :disabled="s.status === 'disabled'"
          @click="enterSite(s)"
        >
          <span class="site-main">
            <span class="site-name">
              {{ s.name }}
              <span class="role-badge">{{ roleLabel(s.site_role) }}</span>
              <span v-if="s.status === 'disabled'" class="role-badge paused">已停用</span>
              <span v-else-if="!s.provisioned" class="role-badge todo">待开通</span>
              <span v-if="s.is_owner" class="role-badge owner">负责人</span>
            </span>
            <span class="site-meta">
              {{ s.domain || '未绑定域名' }} ·
              <template v-if="s.status === 'disabled'">已停用</template>
              <template v-else-if="!s.provisioned && !s.is_owner">未开通 · 需负责人配置</template>
              <template v-else-if="!s.provisioned">进入后请先完成凭据开通</template>
              <template v-else>运行中</template>
            </span>
          </span>
          <span class="go-btn">›</span>
        </button>

        <p v-if="!sites.length" class="empty-hint">
          您的账号还没有绑定任何站点，请联系平台管理员在「站点管理」里添加您并设为负责人。
        </p>

        <button v-if="canAggregate" class="platform-card" @click="enterAll">
          <span class="site-main">
            <span class="site-name dark-name">
              平台工作台
              <span class="all-badge">全部站点管理</span>
            </span>
            <span class="site-meta dark-meta">全局站点聚合与关键大盘 · 完善环节请接入具体站点</span>
          </span>
          <span class="go-btn gold">›</span>
        </button>
      </template>

      <div class="foot">
        <a class="foot-link" @click.prevent="logout">退出登录 · 切换账号</a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import logo from '../../assets/logo.png';

const router = useRouter();
const admin = JSON.parse(localStorage.getItem('fyt_admin_info') ?? 'null');
const adminName = admin?.username ?? '管理员';

const loading = ref(true);
const sites = ref([]);
const canAggregate = ref(false);

function roleLabel(role) {
  return role === 'owner' ? '站点主理人' : '站点管理员';
}

function setActive(site) {
  localStorage.setItem('fyt_admin_site', JSON.stringify(site));
}

/**
 * 进入站点。
 * ⛔ 2026-10-05 修：setActive 原先只存 {scope, code, name}，**丢了 site_id**。
 *   屏 52 凭据开通与白名单判定都按 site_id 取数，超管走站点管理进站时是手动拼的带 site_id，
 *   但站点管理员走这里进站就丢了 → 凭据向导拿到 undefined 直接空转。
 * 未开通站点额外带 needsProvision 标记，工作台据此自动落到「凭据开通」而不是数据看板。
 */
function enterSite(s) {
  setActive({
    scope: 'site',
    site_id: s.site_id,
    code: s.code,
    name: s.name,
    provisioned: Boolean(s.provisioned),
    is_owner: Boolean(s.is_owner),
    // 未开通 → 进工作台就直奔凭据开通（决策#43：没配 key 的站，看板/订单全是 0）
    needsProvision: !s.provisioned,
  });
  router.push('/');
}

function enterAll() {
  setActive({ scope: 'all', name: '全部站点' });
  router.push('/');
}

function logout() {
  localStorage.removeItem('fyt_admin_token');
  localStorage.removeItem('fyt_admin_info');
  localStorage.removeItem('fyt_admin_sites');
  localStorage.removeItem('fyt_admin_site');
  router.push('/login');
}

onMounted(async () => {
  try {
    const res = await fetch('/api/admin/sites/my');
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.message ?? '加载失败');
    sites.value = body.data.sites ?? [];
    canAggregate.value = !!body.data.can_aggregate;
    // 单站站点管理员：无需选择，直接进入（未开通会由 enterSite 带上 needsProvision 直奔凭据开通）
    // ⛔ 停用的单站不能自动进：得让人看见卡片上的「已停用」和提示，而不是被直接扔进工作台
    if (!canAggregate.value && sites.value.length === 1 && sites.value[0].status !== 'disabled') {
      enterSite(sites.value[0]);
      return;
    }
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.pick-page {
  min-height: 100vh;
  background: #fff6e9;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  padding: 32px 16px;
}
.blob { position: absolute; border-radius: 50%; }
.blob-a { width: 150px; height: 150px; background: #fbd7c7; left: 9%; top: 60%; opacity: 0.6; }
.blob-b { width: 90px; height: 90px; background: #fce9b8; right: 15%; top: 9%; opacity: 0.7; }
.blob-c { width: 60px; height: 60px; background: #f7c9d8; right: 26%; bottom: 12%; opacity: 0.55; }

.card {
  width: 396px;
  max-width: 100%;
  background: #fff;
  border: 2px solid #f0b9c9;
  border-radius: 22px;
  padding: 30px 26px 22px;
  position: relative;
  z-index: 1;
  box-shadow: 0 18px 44px rgba(163, 18, 69, 0.10);
}
.brand-row { display: flex; align-items: center; justify-content: center; gap: 8px; }
.logo { width: 34px; height: 34px; object-fit: contain; }
.brand-text { font-size: 17px; font-weight: 900; color: #3d2530; }
.title { text-align: center; font-size: 19px; font-weight: 900; color: #3d2530; margin: 14px 0 6px; }
.sub { text-align: center; font-size: 11.5px; color: #b08a96; line-height: 1.6; margin: 0 0 16px; }

.loading { height: 180px; }
.site-card, .platform-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  border: none;
  cursor: pointer;
  text-align: left;
  border-radius: 13px;
  padding: 13px 14px;
  margin-bottom: 11px;
  background: #fdf1e4;
  transition: box-shadow 0.15s, transform 0.15s;
}
.site-card:hover:not(:disabled), .platform-card:hover { box-shadow: 0 4px 0 rgba(163, 18, 69, 0.16); transform: translateY(-1px); }
.site-card:disabled { opacity: 0.5; cursor: not-allowed; }
.site-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.site-name { font-size: 14px; font-weight: 800; color: #3d2530; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.role-badge {
  background: #f7c9d8; color: #a31245; font-size: 10px; font-weight: 800;
  border-radius: 999px; padding: 1px 7px;
}
.role-badge.paused { background: #eee; color: #999; }
.role-badge.todo { background: #ffe1b0; color: #a35a00; }
.role-badge.owner { background: #e8336d; color: #fff; }
.empty-hint {
  font-size: 12px; color: #b99aa4; line-height: 1.7;
  background: #fdf1e4; border-radius: 11px; padding: 12px 13px; margin: 2px 0 11px;
}
.site-meta { font-size: 11px; color: #b99aa4; }
.go-btn {
  width: 26px; height: 26px; border-radius: 50%;
  background: #e8336d; color: #fff; font-size: 15px; font-weight: 900;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.go-btn.gold { background: #ffaa1d; color: #5c3200; }

.platform-card { background: #3d2030; }
.platform-card:hover { box-shadow: 0 4px 0 rgba(0, 0, 0, 0.25); }
.dark-name { color: #fff; }
.dark-meta { color: rgba(255, 255, 255, 0.55); }
.all-badge {
  background: #ffaa1d; color: #5c3200; font-size: 10px; font-weight: 800;
  border-radius: 999px; padding: 1px 7px;
}

.foot { text-align: center; margin-top: 6px; }
.foot-link { font-size: 12px; color: #c26d8a; cursor: pointer; }
.foot-link:hover { color: #a31245; }
</style>
