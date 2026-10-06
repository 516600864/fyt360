import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // 后台挂载在静态托管 /admin/ 子路径下（mk.fyt360.cn/admin/），资源必须用相对 base
  base: '/admin/',
  server: {
    proxy: { '/api': 'http://127.0.0.1:9000' },
  },
});
