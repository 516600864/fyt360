<template>
  <view v-if="show" class="ck-mask" @click="close">
    <view class="ck-sheet" @click.stop>
      <!-- 头行（01B）：标题 + 副标 + 关闭 -->
      <view class="ck-head">
        <view class="ck-head-l">
          <view class="ck-title">日进斗金</view>
          <view class="ck-sub">签到即添金 · 连签灌满聚宝盆</view>
        </view>
        <view class="ck-close" @click="close"><text>×</text></view>
      </view>

      <!-- 未登录 -->
      <view v-if="needLogin" class="ck-login">
        <text class="ck-login-txt">登录后开启聚宝盆，签到领元宝</text>
        <button class="ck-btn ck-btn-main ck-login-btn" @click="goLogin">去登录</button>
      </view>

      <template v-else>
        <!-- 01C 成功态头：添金成功 chip + 大字 -->
        <view v-if="mode === 'success'" class="ck-success-head">
          <view class="ck-ok-chip"><text>添金成功 ✓</text></view>
          <view class="ck-big"><text>+{{ lastAmount }} 元宝</text></view>
        </view>

        <!-- 盆区：光线 + 金币（7 槽位）+ 碗/口/座 + chip + D7 横幅 -->
        <view class="ck-pot-area">
          <view v-for="(r, i) in rays" :key="'r' + i" class="ck-ray" :style="r"></view>
          <view
            v-for="(c, i) in coins"
            :key="'c' + i"
            class="ck-coin"
            :class="c.cls"
            :style="c.style"
          >
            <view class="ck-coin-hole"></view>
          </view>
          <view class="ck-bowl"></view>
          <view class="ck-rim"></view>
          <view class="ck-foot"></view>
          <view class="ck-chip"><text>{{ chipText }}</text></view>
          <view v-if="bannerShow" class="ck-banner"><text>盆满钵满 · +{{ rewards[6] }} 元宝！</text></view>
        </view>

        <!-- 7 圆点进度 -->
        <view class="ck-dots">
          <view v-for="i in 7" :key="'d' + i" class="ck-dot" :class="dotCls(i)">
            <text>{{ dotTxt(i) }}</text>
          </view>
        </view>

        <!-- 文案行（01B）/ 提示条（01C 鎏金浅底） -->
        <view v-if="mode === 'success'" class="ck-tip"><text>{{ tipText }}</text></view>
        <view v-else class="ck-cap"><text>{{ caption }}</text></view>

        <!-- 主按钮 -->
        <button
          class="ck-btn ck-btn-main"
          :class="{ 'ck-pulse': pulse && mode !== 'success', 'ck-btn-dim': signed && mode !== 'success' }"
          :disabled="busy || (signed && mode !== 'success')"
          @click="mode === 'success' ? close() : onSign()"
        >
          {{ btnText }}
        </button>

        <!-- 规则/邀请小字 -->
        <view class="ck-rule">
          <text>{{ mode === 'success' ? '喊好友一起添金 · 每邀 1 人 +' + inviteReward + ' 元宝' : '奖励逐日递增（' + rewards[0] + '→' + rewards[5] + '），断签重新计盆 · 元宝仅用于兑换会员等级' }}</text>
        </view>
      </template>
    </view>
  </view>
</template>

<script>
/**
 * 聚宝盆签到弹层（决策#31，画布 142:208 弹层 / 142:269 成功态；动效规格按设计 Demo 定稿）：
 * ① 添金下落：金币 translateY -150→0 过冲回弹（0.65s cubic-bezier(.3,.6,.4,1.25)）
 * ② 盆渐满：每签一枚金币入槽（7 槽位堆小山，坐标照搬 Demo×2 换 rpx）
 * ③ D7 开盆：金币 6 方向飞散旋转淡出 +「盆满钵满」横幅 pop
 * ④ CTA 待机：呼吸脉冲
 * 小程序不支持 <svg> → CSS 画盆（碗/口/座三层）+ view 金币；全端 CSS keyframes 无兼容坑。
 * 数据：GET/POST /api/me/checkin/*（断签重新计盆由服务端裁决，端上只渲染）。
 */
import { request, getToken } from '@/utils/request';

/** Demo 槽位（300×172 viewBox）×2 换 rpx + 容器居中偏移 15rpx；金币直径 48rpx → 左上 = 中心 - 24 */
const SLOTS = [
  [315, 148], [251, 160], [379, 160], [295, 124], [351, 120], [221, 172], [409, 172],
];
/** 光线（角度 deg × 透明度 × 色） */
const RAYS = [
  { a: -58, o: 0.08, c: '232,51,109' },
  { a: -20, o: 0.13, c: '255,170,29' },
  { a: 0, o: 0.08, c: '232,51,109' },
  { a: 20, o: 0.13, c: '255,170,29' },
  { a: 58, o: 0.08, c: '232,51,109' },
];
/** D7 飞散 6 方向（rpx） */
const FLY = [
  [150, -180], [-160, -150], [190, -60], [-190, -50], [80, -210], [-80, -200],
];

export default {
  name: 'CheckinPopup',
  data() {
    return {
      show: false,
      needLogin: false,
      mode: 'default', // default=01B 弹层 | success=01C 成功态
      busy: false,
      falling: false, // 新金币下落动画中
      bannerShow: false,
      rewards: [50, 60, 70, 80, 90, 100, 500],
      streak: 0,
      cycle: 1,
      days: [],
      todayChecked: false,
      todayAmount: 0,
      nextAmount: 0,
      balance: 0,
      inviteReward: 500,
      lastAmount: 0,
      full: false,
      pushTmpl: '', // 订阅消息模板 ID（后台配置后随 status 下发；决策#32 每日提醒）
      pushAsked: false, // 本会话已拉过授权（防重复骚扰）
    };
  },
  computed: {
    /** 盆内已落金币数（本盆 days 长度；D7 满盆 = 7） */
    potCoins() {
      return Math.min(this.days.length, 7);
    },
    /** 金币视图：已落的静态 + 下落中最后一枚 + D7 飞散 class */
    coins() {
      const list = [];
      const n = this.potCoins;
      for (let i = 0; i < n; i++) {
        const s = SLOTS[i];
        let cls = '';
        let extra = '';
        if (this.falling && i === n - 1) {
          cls = 'ck-fall';
          extra = 'animation-delay:0s;';
        }
        if (this.bannerShow) {
          cls = 'ck-fly-' + (i % 6);
          extra = 'animation-delay:' + (i % 4) * 60 + 'ms;';
        }
        list.push({
          cls,
          style: 'left:' + (s[0] - 24) + 'rpx;top:' + (s[1] - 24) + 'rpx;' + extra,
        });
      }
      return list;
    },
    rays() {
      return RAYS.map(
        (r) =>
          'transform:translate(-50%,-72%) rotate(' + r.a + 'deg);opacity:' + r.o +
          ';background:rgb(' + r.c + ');'
      );
    },
    signed() {
      return this.todayChecked && this.mode !== 'success';
    },
    chipText() {
      if (this.full && this.mode !== 'success') return '已盆满';
      if (this.mode === 'success') return '今日已添';
      return this.todayChecked ? '今日已添' : '今日 +' + this.todayAmount;
    },
    caption() {
      if (this.streak === 0) return '连签 7 天盆满开大奖，整盆 ' + this.rewards[6] + ' 元宝抱走';
      if (this.todayChecked) {
        return this.full
          ? '第 7 天盆满 · 大奖已开！'
          : '已连签 ' + this.streak + ' 天 · 明日添金 +' + this.nextAmount + ' 元宝';
      }
      return this.streak > 0
        ? '已连签 ' + this.streak + ' 天 · 今日添金 +' + this.todayAmount + ' 元宝'
        : '连签 7 天盆满开大奖，整盆 ' + this.rewards[6] + ' 元宝抱走';
    },
    tipText() {
      return this.full
        ? '整盆 ' + this.rewards[6] + ' 元宝已入账，明天开新盆继续添金'
        : '已连签 ' + this.streak + ' 天 · 明日添金 ×' + this.nextAmount + '，别让盆凉了';
    },
    btnText() {
      if (this.mode === 'success') return '收下这捧元宝';
      if (this.busy) return '添金中…';
      if (this.todayChecked) {
        return this.full ? '明日开新盆 · 添金 +' + this.nextAmount + ' 元宝' : '明日再来 · 添金 +' + this.nextAmount + ' 元宝';
      }
      return '今日添金 · 签到 +' + this.todayAmount + ' 元宝';
    },
    pulse() {
      return !this.busy && !this.todayChecked;
    },
  },
  methods: {
    /** 宿主页 $refs 调用打开 */
    open() {
      this.show = true;
      this.needLogin = !getToken();
      if (this.needLogin) return;
      this.mode = 'default';
      this.bannerShow = false;
      this.load();
    },
    close() {
      if (this.busy) return;
      this.show = false;
      if (this.mode === 'success') this.askSubscribe();
    },
    /** 决策#32 每日提醒：成功态关闭手势内拉一次性订阅授权（accept → 上报 quota+1，明日 09:00 提醒）。
     *  仅 MP-WEIXIN 且后台已配模板；用户勾选「总是保持以上选择」后不再弹窗，静默上报。 */
    askSubscribe() {
      // #ifdef MP-WEIXIN
      if (!this.pushTmpl || this.pushAsked || typeof uni.requestSubscribeMessage !== 'function') return;
      this.pushAsked = true;
      uni.requestSubscribeMessage({
        tmplIds: [this.pushTmpl],
        success: (res) => {
          if (res && res[this.pushTmpl] === 'accept') {
            request('/api/me/checkin/subscribe', { method: 'POST', body: { state: 'accept' } }).catch(() => {});
          }
        },
        fail: () => {}, // 用户关闭弹窗/环境不支持 → 静默
      });
      // #endif
    },
    goLogin() {
      this.show = false;
      // #ifdef MP-WEIXIN
      uni.switchTab({ url: '/pages/shell/s5', fail: () => {} });
      // #endif
      // #ifndef MP-WEIXIN
      uni.showToast({ title: '请先登录后签到', icon: 'none' });
      // #endif
    },
    async load() {
      try {
        const d = await request('/api/me/checkin/status');
        this.applyStatus(d);
      } catch (e) {
        const msg = String(e?.message ?? '');
        if (msg.includes('401') || msg.includes('登录')) {
          this.needLogin = true;
        } else {
          uni.showToast({ title: msg || '签到状态加载失败', icon: 'none' });
        }
      }
    },
    applyStatus(d) {
      this.rewards = Array.isArray(d.rewards) && d.rewards.length === 7 ? d.rewards : this.rewards;
      this.streak = Number(d.streak ?? 0);
      this.cycle = Number(d.cycle ?? 1);
      this.days = Array.isArray(d.days) ? d.days : [];
      this.todayChecked = !!d.today_checked;
      this.todayAmount = Number(d.today_amount ?? 0);
      this.nextAmount = Number(d.next_amount ?? 0);
      this.balance = Number(d.balance ?? 0);
      this.inviteReward = Number(d.invite_reward ?? 500);
      this.full = !!d.full;
      this.pushTmpl = String(d.push_tmpl ?? '');
    },
    async onSign() {
      if (this.busy || this.todayChecked) return;
      this.busy = true;
      try {
        const d = await request('/api/me/checkin/do', { method: 'POST' });
        // ① 添金下落（0.65s+缓冲）
        this.lastAmount = Number(d.amount ?? 0);
        this.streak = Number(d.streak ?? 0);
        this.cycle = Number(d.cycle ?? 1);
        this.days = Array.isArray(d.days) ? d.days : [];
        this.full = !!d.full;
        this.balance = Number(d.balance_after ?? 0);
        this.todayChecked = true;
        this.falling = true;
        setTimeout(() => {
          this.falling = false;
          // ③ D7 开盆：横幅 + 飞散；否则切 01C 成功态
          if (this.full) {
            this.bannerShow = true;
            setTimeout(() => {
              this.mode = 'success';
              this.busy = false;
            }, 1000);
          } else {
            this.mode = 'success';
            this.busy = false;
          }
        }, 720);
      } catch (e) {
        this.busy = false;
        const msg = String(e?.message ?? '签到失败');
        if (msg.includes('已经签过')) {
          this.todayChecked = true;
          this.load();
        }
        uni.showToast({ title: msg, icon: 'none' });
      }
    },
    dotCls(i) {
      const n = this.potCoins;
      if (i <= n) return 'ck-dot-done';
      if (i === n + 1 && !this.full && !this.todayChecked && this.mode !== 'success') return 'ck-dot-today';
      return 'ck-dot-todo';
    },
    dotTxt(i) {
      const n = this.potCoins;
      if (i <= n) return '✓';
      if (i === n + 1 && !this.full && !this.todayChecked && this.mode !== 'success') return String(i);
      return String(i);
    },
  },
};
</script>

<style scoped>
/* ---------- 遮罩 + 居中弹窗（2026-09-30 由半屏 Sheet 改居屏中：custom-tab-bar 是微信原生层，z-index 再高也盖不过它，bottom sheet 的按钮必被遮挡） ---------- */
.ck-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(31, 31, 31, 0.55);
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ck-sheet {
  width: 620rpx;
  max-height: 82vh;
  overflow-y: auto;
  background: var(--fyt-bg, #fff6e9);
  border: 4rpx solid #1f1f1f;
  border-radius: 32rpx;
  padding: 28rpx 32rpx 32rpx;
  box-sizing: border-box;
  box-shadow: 0 16rpx 48rpx rgba(31, 31, 31, 0.3);
}
.ck-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.ck-title {
  font-size: 44rpx;
  font-weight: 700;
  color: var(--fyt-primary-dark, #a31245);
  letter-spacing: 2rpx;
}
.ck-sub {
  font-size: 22rpx;
  color: #6b6b6b;
  margin-top: 4rpx;
}
.ck-close {
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: rgba(31, 31, 31, 0.08);
  text-align: center;
  line-height: 44rpx;
  font-size: 32rpx;
  color: #1f1f1f;
}

/* ---------- 盆区 ---------- */
.ck-pot-area {
  position: relative;
  height: 340rpx;
  margin-top: 20rpx;
  background: #fdefd9;
  border-radius: 24rpx;
  overflow: hidden;
}
.ck-ray {
  position: absolute;
  left: 50%;
  top: 42%;
  width: 150rpx;
  height: 460rpx;
  border-radius: 75rpx;
  transform: translate(-50%, -72%);
}
/* 盆：碗 + 口沿 + 底座（CSS 三层，替代 SVG） */
.ck-bowl {
  position: absolute;
  left: 50%;
  top: 150rpx;
  width: 420rpx;
  height: 128rpx;
  margin-left: -210rpx;
  background: linear-gradient(180deg, #ffc24d, var(--fyt-secondary, #ffaa1d));
  border: 6rpx solid var(--fyt-primary-dark, #a31245);
  border-radius: 0 0 210rpx 210rpx / 0 0 124rpx 124rpx;
  box-sizing: border-box;
}
.ck-rim {
  position: absolute;
  left: 50%;
  top: 136rpx;
  width: 444rpx;
  height: 44rpx;
  margin-left: -222rpx;
  background: #ffd97a;
  border: 6rpx solid var(--fyt-primary-dark, #a31245);
  border-radius: 50%;
  box-sizing: border-box;
  z-index: 3;
}
.ck-foot {
  position: absolute;
  left: 50%;
  top: 274rpx;
  width: 224rpx;
  height: 32rpx;
  margin-left: -112rpx;
  background: var(--fyt-primary, #e8336d);
  border: 6rpx solid var(--fyt-primary-dark, #a31245);
  border-radius: 10rpx;
  box-sizing: border-box;
}
/* 金币（7 槽位）：鎏金圆 + 深玫描边 + 方孔 */
.ck-coin {
  position: absolute;
  width: 48rpx;
  height: 48rpx;
  border-radius: 50%;
  background: var(--fyt-secondary, #ffaa1d);
  border: 4rpx solid var(--fyt-primary-dark, #a31245);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  transform-origin: center;
}
.ck-coin-hole {
  width: 14rpx;
  height: 14rpx;
  background: var(--fyt-primary-dark, #a31245);
  border-radius: 3rpx;
}
.ck-chip {
  position: absolute;
  right: 16rpx;
  top: 16rpx;
  background: var(--fyt-secondary, #ffaa1d);
  border: 4rpx solid var(--fyt-primary-dark, #a31245);
  border-radius: 28rpx;
  padding: 6rpx 20rpx;
  z-index: 4;
}
.ck-chip text {
  font-size: 24rpx;
  font-weight: 600;
  color: var(--fyt-primary-dark, #a31245);
}
.ck-banner {
  position: absolute;
  left: 50%;
  top: 68rpx;
  transform: translateX(-50%);
  background: var(--fyt-primary, #e8336d);
  border: 4rpx solid #1f1f1f;
  border-radius: 28rpx;
  padding: 10rpx 28rpx;
  white-space: nowrap;
  z-index: 5;
  animation: ck-pop 0.45s ease-out;
}
.ck-banner text {
  font-size: 28rpx;
  font-weight: 600;
  color: #fff;
}

/* ---------- 圆点进度 ---------- */
.ck-dots {
  display: flex;
  justify-content: space-between;
  margin: 20rpx 12rpx 0;
}
.ck-dot {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  text-align: center;
  line-height: 50rpx;
  font-size: 24rpx;
  box-sizing: border-box;
  border: 4rpx solid #c7c2b6;
  background: #fff;
}
.ck-dot text {
  color: #6b6b6b;
}
.ck-dot-done {
  background: var(--fyt-primary, #e8336d);
  border-color: var(--fyt-primary-dark, #a31245);
}
.ck-dot-done text {
  color: #fff;
  font-weight: 700;
}
.ck-dot-today {
  background: var(--fyt-secondary, #ffaa1d);
  border-color: var(--fyt-primary-dark, #a31245);
}
.ck-dot-today text {
  color: var(--fyt-primary-dark, #a31245);
  font-weight: 700;
}

/* ---------- 文案 + 按钮 ---------- */
.ck-cap {
  text-align: center;
  font-size: 22rpx;
  color: var(--fyt-primary-dark, #a31245);
  margin-top: 16rpx;
}
.ck-tip {
  margin-top: 16rpx;
  background: rgba(255, 170, 29, 0.18);
  border-radius: 14rpx;
  padding: 12rpx 0;
  text-align: center;
}
.ck-tip text {
  font-size: 22rpx;
  color: var(--fyt-primary-dark, #a31245);
  font-weight: 600;
}
.ck-btn {
  width: 100%;
  margin-top: 20rpx;
  height: 88rpx;
  border: 4rpx solid #1f1f1f;
  border-radius: 44rpx;
  background: var(--fyt-primary, #e8336d);
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
  line-height: 80rpx;
  padding: 0;
}
.ck-btn-dim {
  opacity: 0.55;
}
.ck-rule {
  text-align: center;
  font-size: 20rpx;
  color: #6b6b6b;
  margin-top: 14rpx;
  line-height: 1.5;
}

/* ---------- 01C 成功态头 ---------- */
.ck-success-head {
  margin-top: 6rpx;
}
.ck-ok-chip {
  display: inline-block;
  border: 3rpx solid var(--fyt-primary, #e8336d);
  border-radius: 26rpx;
  padding: 6rpx 22rpx;
  background: #fff;
}
.ck-ok-chip text {
  font-size: 24rpx;
  color: var(--fyt-primary, #e8336d);
  font-weight: 600;
}
.ck-big {
  margin-top: 10rpx;
}
.ck-big text {
  font-size: 64rpx;
  font-weight: 700;
  color: var(--fyt-primary-dark, #a31245);
}

/* ---------- 未登录 ---------- */
.ck-login {
  padding: 40rpx 0 20rpx;
  text-align: center;
}
.ck-login-txt {
  font-size: 26rpx;
  color: #6b6b6b;
}
.ck-login-btn {
  margin-top: 30rpx;
}

/* ---------- 动效（Demo 定稿参数） ---------- */
/* ① 添金下落：-150 → +6 过冲 → 0，回弹曲线 */
.ck-fall {
  animation: ck-drop 0.65s cubic-bezier(0.3, 0.6, 0.4, 1.25) forwards;
}
@keyframes ck-drop {
  0% {
    transform: translateY(-150rpx) scale(0.55);
    opacity: 0;
  }
  70% {
    transform: translateY(6rpx) scale(1.06);
    opacity: 1;
  }
  100% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}
/* ③ D7 飞散：6 方向 + 旋转淡出（class 内联 delay 错落） */
.ck-fly-0 { animation: ck-fly0 0.9s ease-out forwards; }
.ck-fly-1 { animation: ck-fly1 0.9s ease-out forwards; }
.ck-fly-2 { animation: ck-fly2 0.9s ease-out forwards; }
.ck-fly-3 { animation: ck-fly3 0.9s ease-out forwards; }
.ck-fly-4 { animation: ck-fly4 0.9s ease-out forwards; }
.ck-fly-5 { animation: ck-fly5 0.9s ease-out forwards; }
@keyframes ck-fly0 { to { transform: translate(150rpx, -180rpx) rotate(160deg); opacity: 0; } }
@keyframes ck-fly1 { to { transform: translate(-160rpx, -150rpx) rotate(-160deg); opacity: 0; } }
@keyframes ck-fly2 { to { transform: translate(190rpx, -60rpx) rotate(200deg); opacity: 0; } }
@keyframes ck-fly3 { to { transform: translate(-190rpx, -50rpx) rotate(-200deg); opacity: 0; } }
@keyframes ck-fly4 { to { transform: translate(80rpx, -210rpx) rotate(260deg); opacity: 0; } }
@keyframes ck-fly5 { to { transform: translate(-80rpx, -200rpx) rotate(-260deg); opacity: 0; } }
/* 横幅 pop（带 translateX(-50%) 居中保持） */
@keyframes ck-pop {
  0% {
    transform: translateX(-50%) scale(0.6);
    opacity: 0;
  }
  60% {
    transform: translateX(-50%) scale(1.15);
  }
  100% {
    transform: translateX(-50%) scale(1);
    opacity: 1;
  }
}
/* ④ CTA 呼吸脉冲 */
.ck-pulse {
  animation: ck-pulse 1.6s ease-in-out infinite;
}
@keyframes ck-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.04);
  }
}
</style>
