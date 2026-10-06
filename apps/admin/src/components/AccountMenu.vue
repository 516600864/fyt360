<template>
  <!-- 账户信息 · 头像下拉（决策 #37 三态之三）
       身份区（鎏金头像 + 角色徽标）+ 四项菜单；刻意不放「切换站点」——顶栏徽标是唯一入口（决策 #27） -->
  <div class="am">
    <div class="am-identity">
      <span class="am-avatar">
        <img v-if="avatarUrl" :src="avatarUrl" alt="" />
        <template v-else>{{ initial }}</template>
      </span>
      <span class="am-id">
        <span class="am-name">{{ displayName }}</span>
        <span class="am-roles">
          <span class="am-role">{{ roleLabel }}</span>
          <span class="am-scope">{{ scopeText }}</span>
        </span>
      </span>
    </div>

    <div class="am-menu">
      <button v-for="m in MENUS" :key="m.key" class="am-item" @click="$emit('navigate', m.key)">
        <el-icon class="am-icon"><component :is="m.icon" /></el-icon>
        <span>{{ m.label }}</span>
      </button>
    </div>

    <p class="am-foot">站点切换见顶栏徽标（唯一入口）</p>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { User, Lock, Tickets, SwitchButton } from '@element-plus/icons-vue';

const props = defineProps({
  username: { type: String, default: '' },
  nickname: { type: String, default: '' },
  avatar: { type: String, default: '' },
  role: { type: String, default: '' },
  siteCount: { type: Number, default: 0 },
});
defineEmits(['navigate']);

const ROLE_LABEL = { platform_admin: '平台管理员', site_admin: '站点管理员', readonly: '只读运营' };
const MENUS = [
  { key: 'profile', label: '个人资料', icon: User },
  { key: 'password', label: '修改密码', icon: Lock },
  { key: 'audit', label: '我的操作日志', icon: Tickets },
  { key: 'logout', label: '退出登录', icon: SwitchButton },
];

const displayName = computed(() => props.nickname || props.username || '管理员');
const initial = computed(() => displayName.value.slice(0, 1).toUpperCase());
const avatarUrl = computed(() => props.avatar || '');
const roleLabel = computed(() => ROLE_LABEL[props.role] ?? '管理员');
const scopeText = computed(() => (props.role === 'platform_admin' ? '超级管理员·平台工作台' : `站点管理员·${props.siteCount} 个站点`));
</script>

<style scoped>
.am {
  width: 236px;
  background: #fff;
  border: 1.5px solid #f0dfc8;
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(122, 45, 82, 0.16);
  overflow: hidden;
}
.am-identity {
  display: flex; align-items: center; gap: 10px;
  padding: 13px 14px; background: linear-gradient(100deg, #fdf0f5, #fff8ee);
  border-bottom: 1.5px solid #f7ece2;
}
.am-avatar {
  flex-shrink: 0; width: 38px; height: 38px; border-radius: 50%;
  background: linear-gradient(135deg, #e8336d, #ffaa1d); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 900; overflow: hidden;
}
.am-avatar img { width: 100%; height: 100%; object-fit: cover; }
.am-id { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.am-name { font-size: 13.5px; font-weight: 800; color: #3d2530; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.am-roles { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.am-role { background: #e8336d; color: #fff; border-radius: 999px; padding: 1px 8px; font-size: 10.5px; font-weight: 800; }
.am-scope { font-size: 10.5px; color: #9a7a86; }

.am-menu { padding: 6px 0; }
.am-item {
  display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
  border: none; background: none; cursor: pointer;
  padding: 9px 14px; font-size: 13px; font-weight: 600; color: #3d2530;
}
.am-item:hover { background: #fdf3f7; color: #a31245; }
.am-icon { font-size: 15px; }
.am-foot { margin: 0; padding: 8px 14px; border-top: 1px solid #faf3ee; background: #fdfaf7; font-size: 10.5px; color: #b8a0aa; }
</style>
