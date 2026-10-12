<template>
  <view class="pj-wrap">
    <!-- 波普品牌化转场（2026-10-12 D先生 钦定）：静态品牌全名贴纸 + 出票文案，替换裸「正在打开…」 -->
    <view class="pj-card">
      <view class="pj-sticker" :class="{ 'pj-sticker--long': nameLen > 4 }">{{ brandName }}</view>
      <text class="pj-tip">正在为你出票…</text>
    </view>
  </view>
</template>

<script>
/**
 * plugin-jump 插件中转页（2026-10-09 主包瘦身·插件分包化）：
 * 微信规则「分包外页面不能直接跳分包内插件页，需先跳该分包普通页」——
 * 本页即 pkg-mayi（声明 mayi-ordering/mayi-tg 两插件）的统一中转：
 * onLoad 接 ?path=<encodeURIComponent(plugin-private://…)> 即刻 redirectTo 插件页。
 * fail 诚实提示并退栈（插件未配置/版本过旧等）。
 * 2026-10-12：品牌化转场——?name= 品牌全名贴纸（brand-launch 响应 name 透传），缺省回退 FYT360。
 */
export default {
  data() {
    return { brandName: 'FYT360' };
  },
  computed: {
    nameLen() {
      return this.brandName.length;
    },
  },
  onLoad(query) {
    const name = query && query.name ? decodeURIComponent(query.name).trim().slice(0, 12) : '';
    if (name) this.brandName = name;
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
  height: 100vh;
  background: var(--fyt-bg, #fff6e9);
}
.pj-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 40rpx;
}
/* 品牌全名贴纸：奶油白卡 + 玫红粗描边 + 波普错位硬阴影（静态，无动效） */
.pj-sticker {
  background: #fffdf7;
  border: 4rpx solid var(--fyt-primary, #e8336d);
  border-radius: 24rpx;
  box-shadow: 8rpx 8rpx 0 #2b2b2b;
  padding: 28rpx 48rpx;
  font-size: 48rpx;
  font-weight: 900;
  color: var(--fyt-primary, #e8336d);
  max-width: 560rpx;
  text-align: center;
  line-height: 1.2;
  word-break: break-all;
}
/* 长品牌名（>4 字）降字号防撑破贴纸 */
.pj-sticker--long {
  font-size: 36rpx;
  padding: 24rpx 36rpx;
}
.pj-tip {
  color: var(--fyt-text-2, #8c8577);
  font-size: 26rpx;
  font-weight: 700;
}
</style>
