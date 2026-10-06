<template>
  <!-- 淘口令中间页（画布 mini-04，决策#14）：web-view 承载站内 H5 口令页（apps/h5/public/tkl.html）
       职责：口令落地 + 剪贴板写入，规避外链封禁风险。
       前置：mk.fyt360.cn 须在小程序后台配置为「业务域名」（校验文件同 MP_verify 机制）。 -->
  <web-view v-if="url" :src="url" />
  <view v-else class="fallback">
    <text>口令页加载中…</text>
  </view>
</template>

<script>
export default {
  data() {
    return { url: '' };
  },
  onLoad(query) {
    // web-view 只接受完整 http(s) URL，由调用方 encodeURIComponent 传入
    const raw = query?.url ? decodeURIComponent(query.url) : '';
    this.url = raw;
    if (!raw) {
      uni.showToast({ title: '口令页参数缺失', icon: 'none' });
      setTimeout(() => uni.navigateBack({ fail: () => {} }), 1500);
    }
  },
};
</script>

<style>
.fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: #8c8577;
  font-size: 14px;
}
</style>
