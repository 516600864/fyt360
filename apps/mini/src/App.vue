<script>
import { request } from './utils/request.js';

export default {
  onLaunch() {
    console.log('[fyt360-mini] launched');
    this.initMoviePluginParams();
  },
  methods: {
    /**
     * mayi-movie 影票插件参数初始化（文档 tomovie.js 方式：插件 box/页面从 storage 读参）。
     * movieuid/movieapikey/index/homepath 从 brand-launch 动态下发（uid/apikey 占位符已由端点替换），
     * 启动即写，匿名 uid=1；登录态更新后下次冷启生效。
     */
    initMoviePluginParams() {
      // #ifdef MP-WEIXIN
      request('/api/site/brand-launch?code=life_01')
        .then((d) => {
          if (!d?.path) return;
          const q = {};
          String(d.path).split('?')[1]?.split('&').forEach((kv) => {
            const i = kv.indexOf('=');
            if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
          });
          if (q.movieuid) uni.setStorageSync('movieuid', q.movieuid);
          if (q.movieapikey) uni.setStorageSync('movieapikey', q.movieapikey);
          if (q.index) uni.setStorageSync('index', q.index);
          if (q.homepath) uni.setStorageSync('homepath', q.homepath);
        })
        .catch(() => {});
      // #endif
    },
  },
};
</script>

<style lang="scss">
/* Design Token 由 vite additionalData 全局注入（px→rpx：1px = 2rpx，750 稿） */

page {
  background-color: $fyt-surface;
  color: $fyt-text-primary;
  font-size: 30rpx;
  line-height: 44rpx;
}
</style>

<style>
/* 渲染器 CSS 变量全局注入（2026-09-23 真机修复）：
   之前只由 renderer/index.wxss 承载，小程序组件样式隔离下 page,:root 选择器无效，
   变量未定义 → 全部 var(--fyt-*) 解析为空 → 首页 UI 全崩。
   注入 app.wxss（页面级）后变量随 DOM 继承穿透组件隔离。与 H5 :root 双端同源。 */
@import './renderer/styles/theme.css';
</style>
