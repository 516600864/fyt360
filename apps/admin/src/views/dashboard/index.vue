<template>
  <!-- admin-29 壳层：深玫红侧栏 + 白顶栏（面包屑 / 平台工作台胶囊 / 搜索 / 铃铛 / 头像） -->
  <div class="layout">
    <aside class="aside">
      <div class="logo-row">
        <span class="logo-text">FYT360</span>
        <span class="logo-badge">管理台</span>
      </div>
      <nav class="menu">
        <template v-for="item in visibleMenus" :key="item.key">
          <button
            class="menu-item"
            :class="{ active: isGroupActive(item), locked: isLocked(item) }"
            :disabled="isLocked(item)"
            @click="onMenu(item)"
          >
            <el-icon class="menu-icon"><component :is="item.icon" /></el-icon>
            <span class="menu-label">{{ item.label }}</span>
            <span v-if="item.key === 'order' && pendingOrders > 0" class="menu-badge">{{ pendingOrders > 99 ? '99+' : pendingOrders }}</span>
            <el-icon v-if="item.children" class="menu-caret" :class="{ open: openGroups[item.key] }"><ArrowDown /></el-icon>
            <span v-if="isLocked(item)" class="menu-lock">🔒</span>
          </button>
          <div v-if="item.children && openGroups[item.key]" class="sub-menu">
            <button
              v-for="c in item.children"
              :key="c.key"
              class="menu-item sub"
              :class="{ active: c.key === menu, locked: isLocked(item) }"
              :disabled="isLocked(item)"
              @click="onSub(c)"
            >
              <span class="sub-dot" />
              <span class="menu-label">{{ c.label }}</span>
            </button>
          </div>
        </template>

        <!-- 决策#43：站点未开通时，唯一可点的入口（带角标）。其余菜单上方已整片置灰锁死。 -->
        <button
          class="menu-item provision-entry"
          :class="{ active: menu === 'provision' }"
          @click="onSub({ key: 'provision', label: '凭据开通' })"
        >
          <el-icon class="menu-icon"><Key /></el-icon>
          <span class="menu-label">{{ siteProvisioned === false ? '凭据开通 · 去配置' : '凭据开通' }}</span>
          <span v-if="siteProvisioned === false" class="menu-alert">{{ badgeCount }}</span>
        </button>
        <p v-if="siteProvisioned === false" class="menu-lock-tip">
          站点尚未开通：配置蚂蚁星球 apikey 并通过连通性测试后自动解锁其余功能
        </p>
      </nav>
    </aside>

    <div class="body">
      <header class="topbar">
        <div class="crumb">
          <span class="crumb-root">管理台</span>
          <template v-if="crumbGroup">
            <span class="crumb-sep">/</span>
            <span class="crumb-mid">{{ crumbGroup.label }}</span>
          </template>
          <span class="crumb-sep">/</span>
          <span class="crumb-cur">{{ currentMenu.label }}</span>
        </div>
        <div class="topbar-right">
          <button class="ws-pill" @click="onWorkspace">
            <el-icon><OfficeBuilding /></el-icon>
            <span>{{ siteLabel }}</span>
            <span class="ws-switch">切换 ▾</span>
          </button>
          <div class="pop-wrap">
            <button class="icon-btn" @click="togglePop('bell')">
              <el-badge :value="null" is-dot :hidden="!unread" class="bell-dot">
                <el-icon :size="18"><Bell /></el-icon>
              </el-badge>
            </button>
            <NotificationPanel
              v-if="pop === 'bell'"
              ref="notifRef"
              class="pop-panel"
              :site="siteCode"
              @navigate="onNotifNavigate"
            />
          </div>
          <div class="pop-wrap">
            <button class="avatar" :title="admin?.username" @click="togglePop('account')">{{ avatarChar }}</button>
            <AccountMenu
              v-if="pop === 'account'"
              class="pop-panel"
              :username="admin?.username ?? ''"
              :nickname="profile.nickname"
              :avatar="profile.avatar"
              :role="admin?.role ?? ''"
              :site-count="siteCount"
              @navigate="onAccountNavigate"
            />
          </div>
        </div>
      </header>

      <main class="main">
        <Overview v-if="menu === 'dashboard'" @kpi="onKpi" @go="onGo" />
        <Reconcile v-else-if="menu === 'ingot'" />
        <OrderCenter v-else-if="menu === 'orderlist'" />
        <MembersPage v-else-if="menu === 'members'" />
        <SiteManage v-else-if="menu === 'site'" @navigate="onSub" />
        <ProvisionWizard v-else-if="menu === 'provision'" :site="activeSite" @done="loadProvisionState" />
        <BrandPage v-else-if="menu === 'goods' || menu === 'brands'" :tab="menu" />
        <TreeView v-else-if="menu === 'commission' || menu === 'tree' || menu === 'withdraw'" :tab="menu" />
        <VerifyPage v-else-if="menu === 'verify'" />
        <MarketingPage v-else-if="menu === 'marketing'" />
        <AiPage v-else-if="menu === 'ai'" />
        <TabbarPage v-else-if="menu === 'tabbar'" />
    <HotwordPage v-else-if="menu === 'hotword'" />
        <PayPage v-else-if="menu === 'pay'" />
        <SettingsPage v-else-if="menu === 'settings'" />
        <AccountPage v-else-if="menu === 'account'" :tab="accountTab" @profile-loaded="loadProfile" />
        <div v-else class="placeholder">
          <el-empty :description="`「${currentMenu.label}」建设中（业务模块逐里程碑开放）`" />
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  Grid, OfficeBuilding, Goods, Tickets, Share, CreditCard, MagicStick, Setting, Bell, Stamp, Discount, ArrowDown, User, Key,
} from '@element-plus/icons-vue';
import NotificationPanel from '../../components/NotificationPanel.vue';
import AccountMenu from '../../components/AccountMenu.vue';
import { adminApi } from '../../lib/api';
import Overview from './overview.vue';
import Reconcile from '../ingot/reconcile.vue';
import OrderCenter from '../order/center.vue';
import MembersPage from '../members/index.vue';
import SiteManage from '../site/manage.vue';
import ProvisionWizard from '../site/provision.vue'; // 屏 52 凭据开通向导（决策#43）
import BrandPage from '../brand/index.vue';
import TreeView from '../tree/index.vue';
import AiPage from '../ai/index.vue';
import TabbarPage from '../tabbar/index.vue';
import HotwordPage from '../hotword/index.vue';
import PayPage from '../pay/index.vue';
import SettingsPage from '../settings/index.vue';
import VerifyPage from '../verify/index.vue';
import MarketingPage from '../marketing/index.vue';
import AccountPage from '../account/index.vue';

const router = useRouter();
const admin = JSON.parse(localStorage.getItem('fyt_admin_info') ?? 'null');
const isPlatform = admin?.role === 'platform_admin';
const avatarChar = (admin?.username ?? 'D').slice(0, 1).toUpperCase();

const menus = [
  { key: 'dashboard', label: '数据看板', icon: Grid },
  { key: 'site', label: '站点管理', icon: OfficeBuilding, platformOnly: true, alwaysOn: true },
  {
    key: 'brand', label: '商品与品牌', icon: Goods,
    children: [
      { key: 'goods', label: '到店团购管理' },
      { key: 'brands', label: '品牌三轨配置' },
    ],
  },
  {
    key: 'order', label: '订单管理', icon: Tickets,
    children: [
      { key: 'orderlist', label: '订单中心' },
      { key: 'verify', label: '到店团购核销' },
      { key: 'ingot', label: '元宝对账' },
    ],
  },
  { key: 'members', label: '会员管理', icon: User },
  {
    key: 'distribute', label: '分销管理', icon: Share,
    children: [
      { key: 'commission', label: '佣金结算配置' },
      { key: 'tree', label: '分销关系树' },
      { key: 'withdraw', label: '提现审核' },
    ],
  },
  { key: 'marketing', label: '营销中心', icon: Discount },
  { key: 'pay', label: '支付商户', icon: CreditCard, alwaysOn: true },
  {
    key: 'ai', label: 'AI装修', icon: MagicStick,
    children: [
      { key: 'ai', label: 'AI动态装修' },
      { key: 'tabbar', label: '底部菜单' },
      { key: 'hotword', label: '热搜词' },
    ],
  },
  { key: 'settings', label: '系统设置', icon: Setting, platformOnly: true, alwaysOn: true },
];
const visibleMenus = menus.filter((m) => !m.platformOnly || isPlatform);
/** 决策#27：活动站点上下文（select-site 页写入），会话单站；scope=all 仅超管只读聚合 */
const activeSite = (() => {
  try { return JSON.parse(localStorage.getItem('fyt_admin_site') ?? 'null'); } catch { return null; }
})();
// ⛔ 2026-10-05 决策#43 落地：未开通的站进来直接落在「凭据开通」，不是数据看板。
//   理由很直白：没配蚂蚁 key 的站，看板/订单/商品全是 0，运营第一反应是「平台没数据」
//   而不是「你还没配 key」。让正确动作占据第一屏，比弹个 toast 再让人自己翻菜单强。
//   ⛔ 平台工作台（scope=all）没有「当前站」，不跳。
//   ⛔ needsProvision 只是路由提示（选站页给的），真相源永远是下面 loadProvisionState
//      从 GET /admin/sites/provision/:siteId 取回的 provisioned —— 那里会做纠偏。
const menu = ref(
  activeSite?.scope === 'site' && activeSite?.needsProvision ? 'provision' : 'dashboard'
);
const openGroups = reactive({ brand: true, order: true, distribute: true, ai: true });
/** 面包屑：子菜单激活时显示「父组 / 子项」 */
const currentMenu = computed(() => {
  for (const m of menus) {
    if (m.key === menu.value) return m;
    if (m.children?.some((c) => c.key === menu.value)) return m.children.find((c) => c.key === menu.value);
  }
  return menus[0];
});
const parentGroupOf = (key) => menus.find((m) => m.children?.some((c) => c.key === key));
const isGroupActive = (item) => item.key === menu.value || !!item.children?.some((c) => c.key === menu.value);
const crumbGroup = computed(() => parentGroupOf(menu.value));

const pendingOrders = ref(0);
/** 账户设置三 Tab 当前 Tab（决策 #37：/account 单页三 Tab 走 query，此处由顶栏下拉直切） */
/** 决策 #27：账户设置三 Tab 当前 Tab（/account 单页三 Tab 走 query，此处由顶栏下拉直切） */
const accountTab = ref('profile');
const siteLabel = activeSite
  ? (activeSite.scope === 'all' ? `平台工作台 · ${activeSite.name}（只读）` : `工作台 · ${activeSite.name}`)
  : (isPlatform ? '平台工作台 · 全部站点' : admin?.siteNames?.[0] ?? '我的站点');

onMounted(() => {
  // 未选站 → 一律回选站页（决策#27 + 2026-10-05 修复）：
  // ⛔ 原来只拦「超管或多站」，单站用户 activeSite 缺失时留在看板——但没有站点上下文
  //   请求头 X-Fyt-Site 是空的，看板数据必空/必错。选站页对单站自动进入（无感），
  //   0 站显示空态，多站/超管显示选择器。不存在需要留在看板的合法场景。
  if (!activeSite) {
    router.replace('/select-site');
  }
  loadProfile();
  checkUnread();
  loadProvisionState();

  // 两态互斥的关闭手势：Esc 与外点
  const onDoc = (e) => {
    if (pop.value && !e.target.closest?.('.pop-wrap')) pop.value = '';
  };
  const onKey = (e) => { if (e.key === 'Escape') pop.value = ''; };
  document.addEventListener('click', onDoc, true);
  document.addEventListener('keydown', onKey);
  onUnmounted(() => {
    document.removeEventListener('click', onDoc, true);
    document.removeEventListener('keydown', onKey);
  });
});

function onWorkspace() {
  router.push('/select-site');
}

function onMenu(item) {
  if (isLocked(item)) {
    ElMessage.warning(`站点尚未开通：请先在侧栏「凭据开通」配置蚂蚁星球 apikey 并通过连通性测试`);
    return;
  }
  if (item.children) {
    openGroups[item.key] = !openGroups[item.key];
    return;
  }
  onSub(item);
}

function onSub(item) {
  const valid = ['dashboard', 'site', 'provision', 'goods', 'brands', 'orderlist', 'verify', 'ingot', 'members', 'commission', 'tree', 'withdraw', 'marketing', 'ai', 'tabbar', 'pay', 'settings'];
  if (!valid.includes(item.key)) {
    ElMessage.info(`「${item.label}」建设中`);
    return;
  }
  const m = menus.find((x) => x.key === item.key || x.children?.some((c) => c.key === item.key));
  if (isLocked(m)) {
    ElMessage.warning(`站点尚未开通：请先在侧栏「凭据开通」配置蚂蚁星球 apikey 并通过连通性测试`);
    return;
  }
  menu.value = item.key;
  const parent = parentGroupOf(item.key);
  if (parent) openGroups[parent.key] = true;
}

/**
 * 决策#43 未开通拦截（前端侧）。真正的强制在 server 中间件（绕前端直连 API 也拿不到数据），
 * 这里只负责「别让人白点一次」+ 把原因写在脸上。
 * alwaysOn 的菜单（站点管理/支付商户/系统设置）是开通手段本身，不能锁。
 */
function isLocked(item) {
  if (!item || item.alwaysOn) return false;
  if (siteProvisioned.value !== false) return false; // 已开通 / 平台工作台（无当前站）→ 不锁
  // 平台工作台（scope=all）本身就是跨站管理台，超管要看全局数据，不锁
  if (activeSite?.scope === 'all') return false;
  return true;
}

/** 开通状态：null=未知/平台工作台（不锁），true/false=当前站是否已开通 */
const siteProvisioned = ref(null);
/** 未开通项角标：待开通站点数（超管视角）；站点工作台视角恒为 1 */
const notConfiguredCount = ref(0);
/**
 * ⛔ 角标曾直接绑 notConfiguredCount，而那个值只在「平台工作台」分支里查过，
 *   站点工作台进来它是初始 0 → 侧栏挂着「凭据开通 · 去配置」却显示角标 0，自相矛盾。
 *   站点视角只有一个当前站，未开通就是 1。
 */
const badgeCount = computed(() => (activeSite?.scope === 'all' ? notConfiguredCount.value : 1));

// 顶栏两态互斥（决策 #37：全局搜索已放弃，搜索框移除，只剩铃铛 + 头像）
const pop = ref('');
const notifRef = ref(null);
const unread = ref(false);
const profile = ref({ nickname: '', avatar: '' });
const siteCount = computed(() => {
  try { return (JSON.parse(localStorage.getItem('fyt_admin_sites') ?? '[]') ?? []).length; } catch { return 0; }
});
const siteCode = computed(() => {
  try {
    const list = JSON.parse(localStorage.getItem('fyt_admin_sites') ?? '[]') ?? [];
    return list.find((s) => s.site_id === activeSite?.site_id)?.code ?? '';
  } catch { return ''; }
});

function togglePop(name) {
  pop.value = pop.value === name ? '' : name;
  if (pop.value === 'bell') checkUnread();
}

/** 未读圆点：只问「有无」，不取数字角标（MVP 决策） */
async function checkUnread() {
  try {
    const q = siteCode.value ? `?site=${encodeURIComponent(siteCode.value)}` : '';
    const d = await adminApi(`/admin/account/notifications${q}`);
    unread.value = !!d.has_unread;
  } catch { unread.value = false; }
}

/** 顶栏资料只用于头像下拉的身份区（昵称/头像），失败不阻塞顶栏 */
async function loadProfile() {
  try {
    const d = await adminApi('/admin/account/profile');
    profile.value = { nickname: d.nickname ?? '', avatar: d.avatar ?? '' };
  } catch { /* 顶栏降级为 username 首字母 */ }
}

/**
 * 决策#43：拉当前站开通状态，决定侧栏锁不锁。
 * 平台工作台（scope=all）没有「当前站」，不锁 → 保持 null。
 * 失败时保守处理成「不锁」：宁可少提示，也不该因为一次网络抖动把超管锁在门外。
 */
async function loadProvisionState() {
  if (!activeSite || activeSite.scope !== 'site') {
    // 平台工作台：只统计待开通站点数做角标
    if (activeSite?.scope === 'all') {
      try {
        const d = await adminApi('/admin/sites');
        notConfiguredCount.value = (d.sites ?? []).filter((s) => !s.provisioned).length;
      } catch { notConfiguredCount.value = 0; }
    }
    return;
  }
  // ⛔ 2026-10-05：activeSite 缺 site_id 的历史会话（选站页旧版本写的）会取不到状态。
  //   不猜、不 fallback 到 code 反查，直接把用户撵回选站页重建会话，否则会一直「不锁」
  //   ——看着能点，进去每个业务 API 都 403，比一开始就走错更难排查。
  if (!activeSite.site_id) {
    localStorage.removeItem('fyt_admin_site');
    ElMessage.warning('会话缺少站点标识，正在返回站点选择页');
    router.replace('/select-site');
    return;
  }
  try {
    const d = await adminApi(`/admin/sites/provision/${activeSite.site_id}`);
    siteProvisioned.value = Boolean(d.site?.provisioned);
    // 纠偏：真相源回来是「未开通」，但用户停在数据看板 → 拉回凭据开通
    if (siteProvisioned.value === false && menu.value !== 'provision' && menu.value !== 'site' && menu.value !== 'settings' && menu.value !== 'pay') {
      menu.value = 'provision';
    }
    // ⛔ 2026-10-05 撤掉「已开通 → 强拉回看板」的反向纠偏：保存成功那一瞬把向导拽走，
    //   用户最想看的「passed + 掩码 key」刷新态根本没机会渲染出来，观感就是「提示成功了但页面没变」。
    //   向导自己会 load() 刷出通过态、侧栏同步解锁，人该自己决定什么时候离开向导。
    //   这里只把会话标志同步成已开通，防止下次进场还按 needsProvision 直接砸向导。
    if (siteProvisioned.value === true && activeSite.needsProvision) {
      activeSite.provisioned = true;
      activeSite.needsProvision = false;
      localStorage.setItem('fyt_admin_site', JSON.stringify(activeSite));
    }
  } catch (e) {
    // ⛔ 403 NOT_SITE_OWNER：当前账号不是该站负责人，屏 52 连读都取不到。
    //   不弹回选站页 —— 那会形成「选站→进站→403→回选站」的死循环，
    //   留在屏 52，由它渲染明确的「你不是负责人」说明态（告诉用户该找谁）。
    //   ⛔ 站点权限仍以 JWT.siteIds 为准：只有拿不到开通状态这一件事，绝不能顺手放开侧栏。
    if (String(e?.message ?? '').includes('负责人')) {
      siteProvisioned.value = null;
      if (menu.value !== 'provision' && menu.value !== 'site' && menu.value !== 'settings' && menu.value !== 'pay') {
        menu.value = 'provision';
      }
      return;
    }
    siteProvisioned.value = null;
  }
}

function onNotifNavigate(key, params) {
  pop.value = '';
  if (key === 'account') { menu.value = 'account'; return; }
  if (key === 'verify') { onSub({ key: 'verify' }); return; }
  onSub({ key });
  void params;
}

async function onAccountNavigate(key) {
  pop.value = '';
  if (key === 'logout') { onLogout(); return; }
  menu.value = 'account';
  accountTab.value = key; // profile / password / audit
  loadProfile();
}

function onLogout() {
  localStorage.removeItem('fyt_admin_token');
  localStorage.removeItem('fyt_admin_info');
  router.replace('/login');
}

/** 看板回传待结算单数 → 订单管理角标 */
function onKpi(kpi) {
  if (kpi && typeof kpi.pending_orders === 'number') pendingOrders.value = kpi.pending_orders;
}

/** 看板「查看全部」等跨页跳转：走 onSub 统一入口（校验 + 切菜单 + 展开父分组） */
function onGo(key) {
  const item = menus.flatMap((m) => m.children ?? []).find((c) => c.key === key) ?? menus.find((m) => m.key === key);
  if (item) onSub(item);
}

function logout() {
  localStorage.removeItem('fyt_admin_token');
  localStorage.removeItem('fyt_admin_info');
  router.push('/login');
}

defineExpose({ logout });
</script>

<style scoped>
.layout { display: flex; height: 100vh; overflow: hidden; }

/* —— 侧栏：深玫红 —— */
.aside {
  width: 200px;
  flex-shrink: 0;
  background: linear-gradient(180deg, #c01c50 0%, #a31245 100%);
  display: flex;
  flex-direction: column;
  padding: 18px 12px;
  overflow: auto;
}
.logo-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px 18px; }
.logo-text { color: #fff; font-size: 21px; font-weight: 900; letter-spacing: 1px; }
.logo-badge {
  background: #ffaa1d; color: #5c3200; font-size: 11px; font-weight: 800;
  border-radius: 999px; padding: 2px 8px;
}
.menu { display: flex; flex-direction: column; gap: 4px; }
.menu-item {
  display: flex; align-items: center; gap: 10px;
  border: none; background: transparent; cursor: pointer;
  color: rgba(255, 255, 255, 0.88); font-size: 14px; font-weight: 600;
  border-radius: 10px; padding: 11px 12px; text-align: left;
  transition: background 0.15s;
}
.menu-item:hover { background: rgba(255, 255, 255, 0.12); }
.menu-item.active { background: #e8336d; color: #fff; box-shadow: 0 3px 0 rgba(0, 0, 0, 0.18); }
.menu-icon { font-size: 16px; }
.menu-label { flex: 1; }
.menu-caret { font-size: 12px; transition: transform 0.2s; opacity: 0.7; }
.menu-caret.open { transform: rotate(180deg); }

/* ── 决策#43 未开通锁定：整片置灰 + 锁标（真拦截在 server 中间件，这里只防白点） ── */
.menu-item.locked { color: rgba(255, 255, 255, 0.34); cursor: not-allowed; }
.menu-item.locked:hover { background: transparent; }
.menu-item.locked .menu-icon { opacity: 0.4; }
.menu-lock { font-size: 11px; opacity: 0.55; }

.menu-item.provision-entry {
  margin-top: 8px; border: 1px dashed rgba(255, 209, 102, 0.5);
  color: #ffd166; background: rgba(255, 209, 102, 0.08);
}
.menu-item.provision-entry:hover { background: rgba(255, 209, 102, 0.16); }
.menu-item.provision-entry.active { background: #e8336d; border-color: transparent; color: #fff; }
.menu-alert {
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
  background: #ff4d4f; color: #fff; font-size: 11px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
}
.menu-lock-tip {
  margin: 8px 4px 0; padding: 8px 10px; border-radius: 8px;
  background: rgba(255, 209, 102, 0.1); color: #ffd166;
  font-size: 11px; line-height: 1.6;
}
.sub-menu { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 4px; }
.menu-item.sub {
  padding: 8px 12px 8px 22px;
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.72);
}
.menu-item.sub .sub-dot {
  width: 5px; height: 5px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.45); flex-shrink: 0;
}
.menu-item.sub:hover { background: rgba(255, 255, 255, 0.1); }
.menu-item.sub.active { background: #e8336d; color: #fff; }
.menu-item.sub.active .sub-dot { background: #ffaa1d; }
.menu-badge {
  background: #ffaa1d; color: #5c3200; font-size: 11px; font-weight: 800;
  border-radius: 999px; padding: 1px 7px; line-height: 16px;
}

/* —— 顶栏 —— */
.body { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
.topbar {
  height: 60px;
  background: #fff;
  border-bottom: 1.5px solid #f0dfc8;
  display: flex; align-items: center;
  padding: 0 20px; gap: 16px;
}
.crumb { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.crumb-root { color: #8a6b75; }
.crumb-mid { color: #8a6b75; }
.crumb-sep { color: #d9c2ae; }
.crumb-cur { color: #3d2530; font-weight: 700; }
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
.ws-pill {
  display: flex; align-items: center; gap: 6px;
  background: #3d2030; color: #fff; border: none; cursor: pointer;
  font-size: 12.5px; font-weight: 600;
  border-radius: 999px; padding: 8px 14px;
}
.ws-pill:hover { background: #57283f; }
.ws-switch { opacity: 0.75; font-weight: 500; }
.pop-wrap { position: relative; }
/* 面板挂顶栏下方右对齐；topbar 有 overflow 场景时靠 z-index 抬层 */
.pop-panel { position: absolute; top: calc(100% + 8px); right: 0; z-index: 300; }
.icon-btn {
  border: 1.5px solid #f0dfc8; background: #fff; cursor: pointer;
  width: 36px; height: 36px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center;
  color: #a31245;
}
.icon-btn:hover { background: #fff6e9; }
.avatar {
  width: 36px; height: 36px; border-radius: 999px; border: none; cursor: pointer;
  background: #ffaa1d; color: #5c3200; font-weight: 900; font-size: 15px;
}
.main { flex: 1; min-height: 0; overflow: auto; padding: 20px 24px; background: #fff6e9; }
.placeholder { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 60px 0; }
</style>
