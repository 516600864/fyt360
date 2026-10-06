<script>
export default {
  onLaunch() {
    console.log('[fyt360-h5] launched');
  },
};
</script>

<style>
/* 渲染器主题变量全局注入（组件内全部 var() 引用，约定③） */
@import './renderer/styles/theme.css';

page {
  background-color: var(--fyt-surface);
  color: var(--fyt-text);
  font-size: 15px;
  line-height: 1.6;
}
</style>
