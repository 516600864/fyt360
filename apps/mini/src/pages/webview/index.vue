<template>
  <!-- H5 外链容器（Action 协议 jump+h5 落地；web-view 顶满整页） -->
  <web-view v-if="src" :src="src" />
</template>

<script>
export default {
  data() {
    return { src: '' };
  },
  onLoad(query) {
    // src 为 encodeURIComponent 后的完整链接；仅放行 http/https
    const raw = decodeURIComponent(query?.src ?? '');
    if (/^https?:\/\//.test(raw)) this.src = raw;
    else uni.showToast({ title: '链接不合法', icon: 'none' });
  },
};
</script>
