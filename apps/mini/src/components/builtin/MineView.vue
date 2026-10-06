<template>
  <view class="mine">
    <!-- 玫红渐变头部：头像 / 昵称 / ID / 等级徽标 / 设置 -->
    <view class="hero">
      <view class="hero-top">
        <image class="avatar" :src="ov.avatar" mode="aspectFill" />
        <view class="who">
          <text class="nick">{{ ov.nickname }}</text>
          <view class="idrow">
            <text class="uid">ID: {{ ov.user_id }}</text>
            <text class="lv-badge" @tap.stop="go('/pages/rights/levels')">{{ ov.level_name }}</text>
          </view>
          <!-- 邀请码（后台新增核销员/邀请绑定凭此码，C 端唯一可查处） -->
          <view v-if="ov.invite_code" class="inv-row" @tap="copyInvite">
            <text class="inv-code">邀请码 {{ ov.invite_code }}</text>
            <text class="inv-copy">复制</text>
          </view>
        </view>
        <view class="gear" @tap="go('/pages/profile/settings')"><text class="gear-i">⚙</text></view>
      </view>
      <!-- 白卡三格统计（压头） -->
      <view class="stat-card">
        <view class="stat" @tap="go('/pages/commission/wallet')">
          <text class="num">¥{{ fmt(ov.balance) }}</text>
          <text class="lab">余额</text>
        </view>
        <view class="stat" @tap="go('/pages/rights/ingot')">
          <text class="num">{{ fmt(ov.ingot) }}</text>
          <text class="lab">元宝</text>
        </view>
        <view class="stat" @tap="go('/pages/rights/coupons')">
          <text class="num">{{ fmt(ov.coupons) }}</text>
          <text class="lab">优惠券</text>
        </view>
      </view>
    </view>

    <view class="body">
      <!-- 我的订单卡 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">我的订单</text>
          <text class="card-more" @tap="go('/pages/orders/index?tab=all')">全部订单 ›</text>
        </view>
        <view class="order-grid">
          <view v-for="t in orderTabs" :key="t.key" class="order-cell" @tap="go('/pages/orders/index?tab=' + t.key)">
            <view class="o-icon"><text class="o-emoji">{{ t.emoji }}</text><text v-if="badges[t.key] > 0" class="badge">{{ badges[t.key] }}</text></view>
            <text class="o-lab">{{ t.name }}</text>
          </view>
        </view>
      </view>

      <!-- 功能宫格 3×2 六项（mini-06 2026-10-04 调整：删「口令记录」——决策 #41 口令实时生成用完即弃零落库，攒记录无价值且误连淘口令中转页；收藏/足迹已接线 #41） -->
      <view class="card grid-card">
        <view class="grid">
          <view v-for="g in grids" :key="g.name" class="cell" @tap="onGridTap(g)">
            <text class="g-emoji">{{ g.emoji }}</text>
            <text class="g-lab">{{ g.name }}</text>
          </view>
          <view v-if="isAgent" class="cell" @tap="onScanVerify">
            <text class="g-emoji">📷</text>
            <text class="g-lab hl">扫码核销</text>
          </view>
        </view>
      </view>

      <!-- 邀请好友横幅（鎏金） -->
      <view class="invite-banner">
        <view class="ib-left">
          <text class="ib-title">邀请好友</text>
          <text class="ib-desc">好友下单返利 3 级分成，收益自动入余额</text>
        </view>
        <view class="ib-btn" @tap="go('/pages/commission/invite')"><text class="ib-btn-t">去邀请</text></view>
      </view>
    </view>

    <!-- 构建版本号（排查真机缓存：看到的号≠最新号=旧包） -->
    <view class="build-tag"><text>BUILD {{ build }}</text></view>
  </view>
</template>

<script>
/**
 * 我的页内容（画布 mini-06 个人中心，M6）。
 * 双挂载：pages/mine/index.vue（navigateTo 独立页）+ ShellView builtin:mine（tab 壳页内嵌）。
 * 数据：GET /api/me/member/overview 一次拿头卡；订单角标复用 GET /api/me/orders 的 badges。
 */
import { request } from '../../utils/request';
import { copyText } from '../../utils/clip';
import { openCustomerService } from '../../utils/kefu';

const EMPTY = { user_id: '', nickname: '微信用户', avatar: '', balance: 0, ingot: 0, coupons: 0, level_name: '注册会员', invite_code: '' };
/** 构建版本号：每次重编 mini 包时手工更新（真机缓存排查锚点） */
const BUILD = '20261006.1130';

export default {
  data() {
    return {
      build: BUILD,
      ov: { ...EMPTY },
      badges: { pending: 0, paid: 0, completed: 0, refund: 0 },
      orderTabs: [
        { key: 'pending', name: '待付款', emoji: '✅' },
        { key: 'paid', name: '已付款', emoji: '💳' },
        { key: 'completed', name: '已完成', emoji: '🎉' },
        { key: 'refund', name: '退款/售后', emoji: '↩️' },
      ],
      grids: [
        { name: '我的收藏', emoji: '💖', url: '/pages/mine/favorites' },
        { name: '浏览足迹', emoji: '👣', url: '/pages/mine/footprints' },
        { name: '联系客服', emoji: '🎧', kefu: true },   // kefu 标记 → 点它走企微客服，不当死占位
        { name: '权益兑换', emoji: '🎟️', url: '/pages/rights/index' },
        { name: '邀请好友', emoji: '👋', url: '/pages/commission/invite' },
        { name: '设置', emoji: '🎯', url: '/pages/profile/settings' },
      ],
      isAgent: false,
    };
  },
  mounted() {
    this.load();
  },
  methods: {
    go(url) {
      uni.navigateTo({ url, fail: () => uni.showToast({ title: '页面建设中', icon: 'none' }) });
    },
    /** 宫格分发：有 url 走页面；kefu 标记走企微客服（迁移 040）；其余才是死占位 */
    onGridTap(g) {
      if (g.url) { this.go(g.url); return; }
      if (g.kefu) { openCustomerService(); return; }
      this.todo(g.name);
    },
    todo(name) {
      uni.showToast({ title: `${name}建设中`, icon: 'none' });
    },
    onScanVerify() {
      uni.scanCode({
        onlyFromCamera: false,
        scanType: ['qrCode'],
        success: (r) => {
          const code = String(r.result ?? '').trim();
          if (!code) return;
          uni.navigateTo({ url: `/pages/verify/scan?code=${encodeURIComponent(code.toUpperCase())}` });
        },
        fail: () => {
          // 用户拒绝相机/取消 → 进手动输码页兜底
          uni.navigateTo({ url: '/pages/verify/scan' });
        },
      });
    },
    copyInvite() {
      copyText(this.ov.invite_code, '邀请码已复制');
    },
    fmt(n) {
      return Number(n ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    },
    async load() {
      try {
        const d = await request('/api/me/member/overview');
        this.ov = d ?? { ...EMPTY };
      } catch (e) { /* 未登录静默：保留空态 */ }
      try {
        const d2 = await request('/api/me/orders?tab=all');
        this.badges = d2.badges ?? this.badges;
      } catch (e) { /* 角标失败不阻塞 */ }
      // 核销员身份（非核销员返回 is_agent:false，静默）
      try {
        const d3 = await request('/api/me/verify/agent-status');
        this.isAgent = !!d3?.is_agent;
      } catch (e) { /* 未登录静默 */ }
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.mine { min-height: 100vh; background: $fyt-surface; padding-bottom: 40rpx; }

.hero {
  background: linear-gradient(180deg, var(--fyt-primary, #e8336d) 0%, var(--fyt-primary-dark, #a31245) 100%);
  padding: 40rpx 32rpx 60rpx;
}
.hero-top { display: flex; align-items: center; gap: 24rpx; }
.avatar {
  width: 116rpx; height: 116rpx; border-radius: 50%;
  background: var(--fyt-bg, #fff6e9); border: 4rpx solid rgba(255, 255, 255, 0.7); flex-shrink: 0;
}
.who { flex: 1; min-width: 0; }
.nick { display: block; font-size: 36rpx; font-weight: 900; color: #fff; }
.idrow { display: flex; align-items: center; gap: 16rpx; margin-top: 12rpx; }
.uid { font-size: 24rpx; color: rgba(255, 255, 255, 0.85); }
.inv-row { display: flex; align-items: center; gap: 14rpx; margin-top: 10rpx; }
.inv-code {
  font-size: 22rpx; font-weight: 700; color: var(--fyt-primary-dark, #a31245);
  background: rgba(255, 255, 255, 0.92); border-radius: 8rpx; padding: 4rpx 14rpx;
}
.inv-copy {
  font-size: 20rpx; font-weight: 700; color: var(--fyt-secondary, #ffaa1d);
  border: 2rpx solid rgba(255, 255, 255, 0.85); border-radius: 999rpx; padding: 2rpx 14rpx;
}
.lv-badge {
  font-size: 22rpx; font-weight: 800; color: var(--fyt-primary-dark, #a31245);
  background: var(--fyt-secondary, #ffaa1d); border-radius: 999rpx; padding: 4rpx 18rpx;
}
.gear {
  width: 72rpx; height: 72rpx; border-radius: 50%;
  background: rgba(255, 255, 255, 0.22); display: flex; align-items: center; justify-content: center;
}
.gear-i { font-size: 36rpx; color: #fff; }

.stat-card {
  margin-top: 32rpx; background: #fff; border-radius: 28rpx;
  display: flex; padding: 32rpx 0;
  box-shadow: 0 8rpx 24rpx rgba(163, 18, 69, 0.18);
}
.stat { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8rpx; }
.num { font-size: 40rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.lab { font-size: 24rpx; color: #999; }

.body { padding: 24rpx 32rpx 0; display: flex; flex-direction: column; gap: 24rpx; }
.card {
  background: #fff; border: 3rpx solid var(--fyt-primary, #e8336d); border-radius: 28rpx; padding: 28rpx;
}
.card-head { display: flex; align-items: center; justify-content: space-between; }
.card-title { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }
.card-more { font-size: 24rpx; color: #999; }

.order-grid { display: flex; margin-top: 28rpx; }
.order-cell { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 12rpx; }
.o-icon { position: relative; width: 88rpx; height: 88rpx; border-radius: 24rpx; background: var(--fyt-bg, #fff6e9); display: flex; align-items: center; justify-content: center; }
.o-emoji { font-size: 44rpx; }
.badge {
  position: absolute; top: -10rpx; right: -10rpx; min-width: 34rpx; height: 34rpx;
  border-radius: 999rpx; background: var(--fyt-primary, #e8336d); color: #fff; font-size: 20rpx; font-weight: 800;
  display: flex; align-items: center; justify-content: center; padding: 0 8rpx;
}
.o-lab { font-size: 24rpx; color: #333; }

.grid { display: flex; flex-wrap: wrap; }
.cell { width: 33.333%; display: flex; flex-direction: column; align-items: center; gap: 12rpx; padding: 20rpx 0; }
.g-emoji { font-size: 48rpx; }
.g-lab { font-size: 24rpx; color: #333; }
.g-lab.hl { color: $fyt-primary; font-weight: Bold; }

.invite-banner {
  background: linear-gradient(135deg, #ffc93d 0%, var(--fyt-secondary, #ffaa1d) 100%);
  border-radius: 28rpx; padding: 28rpx 32rpx;
  display: flex; align-items: center; justify-content: space-between; gap: 24rpx;
}
.ib-left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8rpx; }
.ib-title { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }
.ib-desc { font-size: 22rpx; color: #7a4a00; }
.ib-btn {
  background: var(--fyt-primary, #e8336d); border-radius: 999rpx; padding: 16rpx 36rpx; flex-shrink: 0;
  box-shadow: 0 6rpx 16rpx rgba(163, 18, 69, 0.35);
}
.ib-btn-t { font-size: 28rpx; font-weight: 800; color: #fff; }

/* 构建版本号（底部小字） */
.build-tag { padding: 24rpx 0 40rpx; text-align: center; }
.build-tag text { font-size: 20rpx; color: #b9a99a; letter-spacing: 2rpx; }
</style>
