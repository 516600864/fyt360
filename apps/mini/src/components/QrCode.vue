<template>
  <canvas id="qr-canvas" type="2d" class="qr-canvas" :style="{ width: size + 'px', height: size + 'px' }" />
</template>

<script>
/**
 * QrCode 二维码绘制（canvas 2d）：qrcode-generator 纯算法产模块矩阵，本地绘制零网络。
 * 用法：<QrCode :text="code" :size="220" />（仅小程序端使用——核销码页/核销员场景）。
 */
import qrcode from 'qrcode-generator';

export default {
  name: 'QrCode',
  props: {
    text: { type: String, default: '' },
    size: { type: Number, default: 220 },
    dark: { type: String, default: '#1a1a1a' },
  },
  watch: {
    text(v) {
      if (v) this.$nextTick(() => this.draw());
    },
  },
  mounted() {
    if (this.text) this.$nextTick(() => this.draw());
  },
  methods: {
    draw() {
      try {
        // typeNumber=0 自动选最小版本；容错 M（15% 可纠错，扫码场景足够）
        const qr = qrcode(0, 'M');
        qr.addData(this.text);
        qr.make();
        const count = qr.getModuleCount();
        const quiet = 2; // 四周静区（模块数）
        const total = count + quiet * 2;
        uni
          .createSelectorQuery()
          .in(this)
          .select('#qr-canvas')
          .fields({ node: true, size: true })
          .exec((res) => {
            const info = res && res[0];
            if (!info || !info.node) return;
            const canvas = info.node;
            const dpr = (uni.getSystemInfoSync().pixelRatio) || 2;
            canvas.width = this.size * dpr;
            canvas.height = this.size * dpr;
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            // 白底（含静区）
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, this.size, this.size);
            const cell = this.size / total;
            ctx.fillStyle = this.dark;
            for (let r = 0; r < count; r++) {
              for (let c = 0; c < count; c++) {
                if (qr.isDark(r, c)) {
                  ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, Math.ceil(cell), Math.ceil(cell));
                }
              }
            }
          });
      } catch (e) {
        console.error('[QrCode] draw fail', e);
      }
    },
  },
};
</script>

<style scoped>
.qr-canvas { display: block; }
</style>
