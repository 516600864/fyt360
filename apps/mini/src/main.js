import App from './App.vue';
import { createSSRApp } from 'vue';
import { bootstrap } from './core/bootstrap';
import { ensureTheme } from './core/theme';

export function createApp() {
  const app = createSSRApp(App);
  bootstrap(app);
  // 全站换肤（决策#34 补丁）：每个页面 onLoad 自动拉取 site.theme 缓存，
  // 注入 pageTheme（模板根节点 :style="pageTheme" 消费）+ 导航栏跟色。
  // mixin data 对全组件可见（builtin 组件在自身 created 里调 ensureTheme）。
  app.mixin({
    data() {
      return { pageTheme: '' };
    },
  // 全局分享开关（2026-10-09 D先生：右上角「转发给朋友/分享朋友圈/复制链接」全灰）。
  // 微信规则：页面定义 onShareAppMessage 点亮「转发给朋友+复制链接」，
  //   onShareTimeline 点亮「分享朋友圈」（官方开放社区实锤口径）。
  // 邀请归因（同日追加）：分享 path/query 统一带 ?invite=码（bootstrap clogin 缓存
  //   fyt_invite_code），被邀请人访问后上级=发起人；匿名无码不带参。
  // 已自定义分享的页面（invite/trade-result）不受影响——Vue3 hook 数组组件自身后注册、返回值优先。
  onShareAppMessage() {
    let inv = '';
    try { inv = String(uni.getStorageSync('fyt_invite_code') ?? ''); } catch (e) { /* 匿名分享不带码 */ }
    return { title: 'FYT360 · 吃喝玩乐省钱逛', path: '/pages/index/index' + (inv ? '?invite=' + inv : '') };
  },
  onShareTimeline() {
    let inv = '';
    try { inv = String(uni.getStorageSync('fyt_invite_code') ?? ''); } catch (e) { /* 匿名分享不带码 */ }
    return { title: 'FYT360 · 吃喝玩乐省钱逛', query: inv ? 'invite=' + inv : '' };
  },
  onLoad() {
    ensureTheme(this);
  },
});
  return { app };
}
