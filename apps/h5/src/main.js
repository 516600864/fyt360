import App from './App.vue';
import { createSSRApp } from 'vue';
import { ensureBoot } from './core/bootstrap';

export function createApp() {
  const app = createSSRApp(App);
  // H5：bootAuth（静默 OAuth）不阻塞挂载，页面侧 await ensureBoot() 后再拉配置
  ensureBoot();
  return { app };
}
