<template>
  <!-- admin-46 后台登录页：左品牌渐变区 + 右表单区，1:1 画布稿 -->
  <div class="login-page">
    <!-- 左：品牌区 -->
    <div class="brand-pane">
      <div class="brand-top">
        <img class="brand-logo" :src="logo" alt="FYT360" />
        <span class="brand-name">FYT360</span>
        <span class="brand-badge">管理台</span>
      </div>
      <div class="brand-hero">
        <h1 class="hero-title">吃喝玩乐购<br />一站全变现</h1>
        <p class="hero-sub">无需资质 · 无需预存 · 流量变现如此简单</p>
        <div class="hero-pills">
          <span class="pill">专门接入</span>
          <span class="pill">实时结算</span>
          <span class="pill">多场景覆盖</span>
          <span class="pill">专属客服</span>
        </div>
      </div>
      <div class="brand-bottom">
        <p class="coop-label">合作品牌 · {{ brandCount }} 个品牌 · 海量优质平台 强强联合</p>
        <PartnerMarquee class="coop-marquee" />
        <p class="copyright">2026 FYT360 · 吃·喝·玩·乐·购·一站全变现</p>
      </div>
    </div>

    <!-- 右：表单区 -->
    <div class="form-pane">
      <div class="form-box">
        <h2 class="form-title">欢迎回来</h2>
        <p class="form-sub">登录 FYT360 管理台，管理你的站点与变现业务</p>
        <el-form @submit.prevent="onLogin">
          <div class="field-label">账号</div>
          <el-input v-model="username" placeholder="平台超管 / 站点管理员账号" size="large" class="field-input" />
          <div class="field-label">密码</div>
          <el-input v-model="password" type="password" placeholder="请输入密码" size="large" show-password class="field-input" />
          <div class="form-meta">
            <el-checkbox v-model="remember" size="small">记住登录状态</el-checkbox>
            <el-link type="primary" :underline="false" class="forgot" @click="onForgot">忘记密码?</el-link>
          </div>
          <el-button class="login-btn" type="primary" size="large" :loading="loading" native-type="submit">
            登录 · 进入管理台
          </el-button>
        </el-form>
        <p v-if="error" class="login-error">{{ error }}</p>
        <p class="form-note">平台超管可管理全站点并创建站点管理员；站点管理员仅管理绑定站点（§8.2）</p>
        <p class="form-version">v0.1.0 · 环境与站点信息由部署时初始化脚本下发</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import logo from '../../assets/logo.png';
import PartnerMarquee from '../../components/PartnerMarquee.vue';
import { PARTNER_BRANDS } from '../../data/partnerBrands';

const brandCount = PARTNER_BRANDS.length;

const router = useRouter();
const username = ref('');
const password = ref('');
const remember = ref(true);
const loading = ref(false);
const error = ref('');

function onForgot() {
  ElMessage.info('请联系平台超管重置密码');
}

async function onLogin() {
  loading.value = true;
  error.value = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.message ?? '登录失败');
    localStorage.setItem('fyt_admin_token', body.data.token);
    localStorage.setItem('fyt_admin_info', JSON.stringify(body.data.admin));
    localStorage.setItem('fyt_admin_sites', JSON.stringify(body.data.sites ?? []));
    localStorage.removeItem('fyt_admin_site');
    // 空账号（先建人后建站）是合法中间态：进站但明确告知，别让人以为登录坏了
    if (body.data.admin?.role !== 'platform_admin' && (body.data.sites?.length ?? 0) === 0) {
      ElMessage.warning('该账号尚未分配站点，功能已锁定。请联系平台管理员在「站点管理」中把您加为该站成员并设为负责人。');
    }
    // ⛔ 2026-10-05 修复：**所有**登录一律过选站页。原来「单站直接进 /」跳过了 select-site，
    //   而 needsProvision（未开通 → 直奔凭据向导）是 select-site 的 enterSite 写入的 ——
    //   单站站点管理员永远拿不到这个标记，登录后落在空看板而不是开通向导（D先生实走流程打回）。
    //   select-site 对单站用户会自动进入（无感），停用站除外（要看「已停用」提示）。
    router.push('/select-site');
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
}
.brand-pane {
  width: 58%;
  min-width: 520px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 40px 48px;
  background: linear-gradient(105deg, #e8336d 0%, #d92648 34%, #f0713c 68%, #ffaa1d 100%);
  color: #fff;
}
.brand-top { display: flex; align-items: center; gap: 10px; }
.brand-logo { width: 40px; height: 40px; border-radius: 10px; background: #fff; object-fit: cover; padding: 2px; }
.brand-name { font-size: 24px; font-weight: 900; letter-spacing: 1px; }
.brand-badge {
  background: #ffaa1d; color: #5c3200; font-size: 12px; font-weight: 800;
  border-radius: 999px; padding: 3px 10px;
}
.brand-hero { flex: 1; display: flex; flex-direction: column; justify-content: center; }
.hero-title { font-size: 44px; line-height: 1.25; font-weight: 900; margin: 0 0 16px; }
.hero-sub { font-size: 14px; opacity: 0.92; margin: 0 0 22px; }
.hero-pills { display: flex; gap: 10px; }
.pill {
  border: 1.5px solid rgba(255, 255, 255, 0.85); border-radius: 999px;
  padding: 5px 16px; font-size: 13px; font-weight: 600;
}
.brand-bottom { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.coop-label { font-size: 13px; font-weight: 700; margin: 0; opacity: 0.95; }
.coop-marquee {
  --pm-chip-bg: rgba(255, 255, 255, 0.94);
  --pm-chip-fg: #a31245;
  max-height: 30vh;
  overflow-y: auto;
  padding-right: 4px;
}
.copyright { font-size: 12px; opacity: 0.75; margin: 4px 0 0; }

.form-pane {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}
.form-box { width: 340px; }
.form-title { font-size: 28px; font-weight: 900; color: #3d2530; margin: 0 0 6px; }
.form-sub { font-size: 13px; color: #8a6b75; margin: 0 0 26px; }
.field-label { font-size: 13px; font-weight: 700; color: #3d2530; margin: 14px 0 6px; }
.field-input :deep(.el-input__wrapper) { border-radius: 10px; }
.form-meta { display: flex; align-items: center; justify-content: space-between; margin: 10px 0 18px; }
.forgot { font-size: 12px; }
.login-btn {
  width: 100%;
  border-radius: 999px;
  font-weight: 800;
  letter-spacing: 2px;
}
.login-error { color: #d03050; font-size: 13px; text-align: center; margin: 12px 0 0; }
.form-note { font-size: 12px; color: #8a6b75; margin: 26px 0 0; line-height: 1.7; }
.form-version { font-size: 12px; color: #b9a3ac; margin: 10px 0 0; }
</style>
