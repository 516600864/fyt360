<template>
  <view class="pj-wrap"><text class="pj-tip">正在打开…</text></view>
</template>

<script>
/**
 * plugin-jump 插件中转页（2026-10-09 主包瘦身·插件分包化）：
 * 微信规则「分包外页面不能直接跳分包内插件页，需先跳该分包普通页」——
 * 本页即 pkg-mayi（声明 mayi-ordering/mayi-tg 两插件）的统一中转：
 * onLoad 接 ?path=<encodeURIComponent(plugin-private://…)> 即刻 navigateTo 插件页。
 * fail 诚实提示并退栈（插件未配置/版本过旧等）。
 */
export default {
  onLoad(query) {
    const raw = query && query.path ? decodeURIComponent(query.path) : '';
    if (!raw) {
      uni.showToast({ title: '插件路径未配置', icon: 'none' });
      setTimeout(() => uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/index/index' }) }), 1200);
      return;
    }
    // redirectTo 替换本中转页：返回栈变「原页面→插件页」，back 不再落回「正在打开…」死屏；
    // 老基础库不支持重定向到插件页时降级 navigateTo（旧行为兜底）
    uni.redirectTo({
      url: raw,
      fail: () => {
        uni.navigateTo({
          url: raw,
          fail: () => {
            uni.showToast({ title: '插件页打开失败，请更新小程序版本', icon: 'none' });
            setTimeout(() => uni.navigateBack({ fail: () => uni.switchTab({ url: '/pages/index/index' }) }), 1200);
          },
        });
      },
    });
  },
};
</script>

<style>
.pj-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 60vh;
}
.pj-tip {
  color: #8c8577;
  font-size: 26rpx;
}
</style>
