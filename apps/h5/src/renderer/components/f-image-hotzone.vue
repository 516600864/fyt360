<template>
  <view class="f-hotzone">
    <image v-if="image" :src="image" mode="widthFix" class="hz-image" @load="onLoad" />
    <view
      v-for="(z, i) in zones"
      :key="i"
      class="hz-zone"
      :style="{ left: z.x + '%', top: (z.y * ratio) + '%', width: z.w + '%', height: (z.h * ratio) + '%' }"
      @click="tap(z)"
    />
  </view>
</template>

<script>
/** f-image-hotzone 图片热区（画布组件库）：底图 + 百分比热区（x/y/w/h 相对图片原始比例）；图片缩放后热区按纵横比校正 */
export default {
  name: 'FImageHotzone',
  props: {
    image: { type: String, default: '' },
    zones: { type: Array, default: () => [] },
  },
  data() {
    return { ratio: 1 }; // 显示高度 / 原始高度比：widthFix 后纵横比不变 → y/h 乘 ratio=1（宽度铺满，纵横比守恒）
  },
  methods: {
    onLoad() { /* widthFix 模式纵横比守恒，热区百分比直接生效；保留钩子防特殊裁剪 */ },
    tap(zone) {
      if (zone.action && zone.action.type !== 'none') this.$emit('action', zone.action);
    },
  },
};
</script>

<style scoped>
.f-hotzone { position: relative; }
.hz-image { width: 100%; display: block; border: var(--fyt-border-thick) solid var(--fyt-border-strong); border-radius: var(--fyt-radius-lg); }
.hz-zone { position: absolute; }
</style>
