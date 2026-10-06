import path from 'node:path';
import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

// H5 工程：无 SCSS token 依赖（渲染器纯 CSS 变量，铁律双轨共存不互扰）
// base 由 manifest.json h5.router.base=/h5/ 驱动，产物 dist/build/h5
export default defineConfig({
  plugins: [uni()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
});
