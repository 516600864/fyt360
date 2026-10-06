<template>
  <view class="page" :style="pageTheme">
    <view v-if="loading" class="state">
      <text class="state-text">福袋兽搬金币中…</text>
    </view>
    <view v-else-if="error" class="state">
      <text>{{ error }}</text>
      <button class="fyt-btn" @click="load">重试</button>
    </view>
    <!-- Schema 引擎（§6.1）：页面=JSON Schema，渲染器统一消费；h5_home 与 mini 首页同稿（决策#26） -->
    <SchemaPage v-else :schema="schema" :theme="theme" :fetcher="feedFetcher" @goods-tap="onGoodsTap" @action="onAction" @checkin="onCheckin" />
    <!-- 聚宝盆签到弹层（决策#31）：搜索条「签到有礼」触发 -->
    <CheckinPopup ref="checkin" />
  </view>
</template>

<script>
import SchemaPage from '@/renderer/index.vue';
import CheckinPopup from '@/renderer/components/checkin-popup.vue';
import defaultHome from '@/renderer/schema/default-home.json';
import { ensureBoot, loadSiteConfig } from '../../core/bootstrap';
import { onGoodsTap as goodsTap } from '../../core/link';
import { request, SITE_CODE } from '../../utils/request';

export default {
  components: { SchemaPage, CheckinPopup },
  data() {
    return {
      loading: true,
      error: '',
      schema: null,
      theme: null,
      pageTheme: '',
    };
  },
  onLoad() {
    this.load();
  },
  methods: {
    // fetcher 注入：模块 import 对模板不可见（Options API），必须挂 methods 才能被 :fetcher 引用
    request,
    async load() {
      this.loading = true;
      this.error = '';
      try {
        // bootAuth 完成后再拉配置（OAuth 跳走时挂起，回跳后继续）
        await ensureBoot();
        const cfg = await loadSiteConfig();
        document.title = cfg.site?.name || 'FYT360';
        // 端内回退：无 published h5_home 时用内置默认装修（与 003 seed 同源）
        this.schema = cfg.h5_home?.schema ?? defaultHome;
        this.theme = cfg.site?.theme ?? null;
        // 决策#34 补丁：根节点同名变量覆盖（SchemaPage 之外的组件——签到弹层等——同样吃换肤）
        this.pageTheme = Object.entries(this.theme ?? {}).map(([k, v]) => `--fyt-${k}:${v}`).join(';');
      } catch (e) {
        this.schema = defaultHome;
      } finally {
        this.loading = false;
      }
    },
    onGoodsTap({ item, platform }) {
      // 商品卡点击统一协议：self 提示去小程序；CPS 先进商详页（mini-03 同稿）再转链
      goodsTap(item, platform);
    },
    /** 商品流数据通道：附带站点 code——匿名浏览（浏览器无登录态）时自营列表按站点返回（server 侧 JWT 优先） */
    feedFetcher(path) {
      const sep = path.includes('?') ? '&' : '?';
      return request(`${path}${sep}site=${encodeURIComponent(SITE_CODE)}`);
    },
    onCheckin() {
      // 聚宝盆签到（决策#31）：渲染器 popup/checkin 上抛 → 打开弹层
      this.$refs.checkin?.open();
    },
    onAction({ action }) {
      // 统一 Action 协议（§6.1）：popup 已由渲染器内置弹层；H5 端落地 jump(page/h5)，小程序呼起如实提示
      const a = action ?? {};
      if (a.type === 'jump' && a.target === 'page' && a.value) {
        // H5 端无搜索页（端内仅首页+口令页）：搜索引导去小程序，其余页面建设中
        const msg = String(a.value).includes('/pages/goods/search') ? '搜索请使用「FYT360」小程序' : '页面建设中';
        uni.navigateTo({ url: a.value, fail: () => uni.showToast({ title: msg, icon: 'none' }) });
        return;
      }
      if (a.type === 'jump' && a.target === 'h5' && a.value) {
        // H5 端外链直跳（决策#26 同款：location.href）
        window.location.href = a.value;
        return;
      }
      if ((a.type === 'jump' && a.target === 'weapp') || a.type === 'plugin-launch') {
        // 品牌呼起：H5 端调 brand-launch，动态转链 H5 链接（016 actunionurl）→ 直跳；小程序专属呼起如实提示
        if (a.value) {
          request(`/api/site/brand-launch?code=${encodeURIComponent(a.value)}`)
            .then((d) => {
              if (d?.mode === 'h5url' && d.url) {
                window.location.href = d.url;
                return;
              }
              uni.showToast({ title: '请在小程序中打开', icon: 'none' });
            })
            .catch(() => uni.showToast({ title: '品牌呼起未配置', icon: 'none' }));
          return;
        }
        uni.showToast({ title: '请在小程序中打开', icon: 'none' });
        return;
      }
      if (a.type === 'activity') {
        uni.showToast({ title: '活动页请在小程序中打开', icon: 'none' });
        return;
      }
      uni.showToast({ title: '功能建设中', icon: 'none' });
    },
  },
};
</script>

<style scoped>
.page {
  min-height: 100vh;
  box-sizing: border-box;
}
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 120px 0;
  color: var(--fyt-text-2);
}
.fyt-btn {
  background: var(--fyt-primary);
  color: var(--fyt-on-primary);
  border: var(--fyt-border-thick) solid var(--fyt-border-strong);
  border-radius: var(--fyt-radius-md);
  box-shadow: var(--fyt-shadow-btn);
  font-weight: 700;
  padding: 6px 24px;
}
</style>
