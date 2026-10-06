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
    onLoad() {
      ensureTheme(this);
    },
  });
  return { app };
}
