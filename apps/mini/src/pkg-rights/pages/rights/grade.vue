<template>
  <view class="grade-page" :style="pageTheme">
    <!-- 品牌概要卡（画布 11 顶部） -->
    <view class="brand-hero">
      <view class="bh-icon"><text class="bh-char">{{ heroChar }}</text></view>
      <view class="bh-main">
        <text class="bh-name">{{ group.name }}</text>
        <text class="bh-meta">官方直充 · 10 分钟内到账</text>
        <view class="bh-tags">
          <view v-if="group.max_save > 0" class="bh-tag gold"><text class="bh-tag-text">最高省 ¥{{ group.max_save }}</text></view>
          <view class="bh-tag plain"><text class="bh-tag-text">共 {{ group.count }} 档可选</text></view>
        </view>
      </view>
    </view>

    <!-- 档位选择卡 -->
    <view class="grade-card">
      <view class="gc-head">
        <text class="gc-title">选择充值档位</text>
        <text class="gc-ratio">由蚂蚁星球履约</text>
      </view>
      <view v-if="loading" class="gc-empty"><text>档位加载中…</text></view>
      <view v-else-if="!items.length" class="gc-empty"><text>档位加载失败，请返回重试</text></view>
      <view
        v-for="it in items"
        :key="it.cid"
        class="grade-item"
        :class="{ selected: picked === it.cid }"
        @click="picked = it.cid"
      >
        <view class="gi-main">
          <text class="gi-name">{{ it.name }}</text>
          <text class="gi-sub">{{ it.brand }}</text>
        </view>
        <view class="gi-right">
          <view class="gi-points"><text class="gi-num">{{ fmt(it.min_points) }}</text><text class="gi-unit">积分</text></view>
          <view v-if="it.max_save > 0" class="gi-save"><text class="gi-save-text">省 ¥{{ it.max_save }}</text></view>
        </view>
        <view v-if="picked === it.cid" class="gi-check"><text class="gi-check-text">✓</text></view>
      </view>
    </view>

    <!-- 我的元宝条（画布底条：积分余额改为我方元宝，蚂蚁积分我方无数据不造假） -->
    <view class="ingot-bar" @click="goIngot">
      <text class="ib-left">🪙 我的元宝 {{ fmt(balance) }}</text>
      <text class="ib-right">元宝仅用于兑换等级 ›</text>
    </view>

    <!-- 底部固定兑换条 -->
    <view class="bottom-bar">
      <view class="bb-left">
        <text class="bb-label">合计消耗</text>
        <view class="bb-amount-row">
          <text class="bb-amount">{{ pickedItem ? fmt(pickedItem.min_points) : '—' }}</text>
          <text class="bb-unit">积分</text>
        </view>
      </view>
      <button class="bb-btn" :disabled="!pickedItem" @click="onRedeem">立即兑换</button>
    </view>
  </view>
</template>

<script>
/**
 * 画布 11 权益档位选择页（M5·权益会员）：
 * 数据 = /api/rights/catalog 中该分组明细（fasttype 实时，不落库）；
 * 立即兑换 = brand-launch(life_05) 半屏呼起 + cid 弹窗参数（f-redeem-entry 同款协议，真机已验证）。
 * 积分消耗发生在蚂蚁星球侧（业务铁律：蚂蚁积分与我方零关系），本页仅展示与呼起。
 */
import { request } from '@/utils/request';

const EMOJI_MAP = { 视频: '🎬', 影音: '🎬', 音频: '🎧', 音乐: '🎧', 读书: '📚', 学习: '📚', 餐饮: '🍔', 美食: '🍔', 外卖: '🛵', 出行: '🚗', 生活: '🧡', 其他: '🎁' };

export default {
  data() {
    return {
      loading: true,
      groupKey: '',
      group: { name: '', count: 0, max_save: 0, icon: '' },
      items: [],
      picked: 0,
      balance: 0,
      focusBrand: '',
    };
  },
  computed: {
    /** 品牌 logo = 品牌名首字（首字方案，不在模板里做方法调用，防编译错位） */
    heroChar() {
      return String(this.group?.name ?? '权').charAt(0) || '权';
    },
    pickedItem() {
      return this.items.find((i) => i.cid === this.picked) ?? null;
    },
  },
  onLoad(q) {
    this.groupKey = String(q.key ?? '');
    if (q.name) this.group.name = decodeURIComponent(String(q.name));
    if (q.brand) this.focusBrand = decodeURIComponent(String(q.brand)); // 分类页 chip 直点定位
    this.load();
  },
  onShow() {
    this.loadBalance();
  },
  methods: {
    emojiOf(name) {
      for (const [k, v] of Object.entries(EMOJI_MAP)) {
        if (String(name).includes(k)) return v;
      }
      return '🎁';
    },
    fmt(n) {
      return Number(n ?? 0).toLocaleString();
    },
    async load() {
      this.loading = true;
      try {
        const d = await request('/api/rights/catalog');
        const g = (d.groups ?? []).find((x) => x.key === this.groupKey);
        if (g) {
          this.group = { name: g.name, count: g.count, max_save: g.max_save, icon: (g.items ?? []).find((i) => i.img)?.img ?? '' };
          this.items = g.items ?? [];
          // 分类页带 brand 进入：默认选中该品牌首个档位，否则选第一档
          const hit = this.focusBrand ? this.items.find((i) => i.brand === this.focusBrand) : null;
          this.picked = (hit ?? this.items[0])?.cid ?? 0;
        }
      } catch (e) {
        uni.showToast({ title: e.message ?? '档位加载失败', icon: 'none' });
      }
      this.loading = false;
    },
    async loadBalance() {
      try {
        const d = await request('/api/me/member/ingot/summary');
        this.balance = d.balance ?? 0;
      } catch (e) {
        this.balance = 0; // 未登录/接口异常不阻塞展示
      }
    },
    goIngot() {
      uni.navigateTo({ url: '/pkg-rights/pages/rights/ingot' });
    },
    onRedeem() {
      if (!this.pickedItem) return;
      // #ifndef MP-WEIXIN
      uni.showToast({ title: '请前往小程序完成兑换', icon: 'none' });
      return;
      // #endif
      // #ifdef MP-WEIXIN
      request('/api/site/brand-launch?code=life_05')
        .then((d) => {
          if (!d || !d.path) {
            uni.showToast({ title: '呼起配置未就绪', icon: 'none' });
            return;
          }
          const sep = d.path.includes('?') ? '&' : '?';
          const fullPath = `${d.path}${sep}cid=${this.pickedItem.cid}`;
          if (d.mode === 'halfscreen' && typeof wx !== 'undefined' && wx.openEmbeddedMiniProgram) {
            wx.openEmbeddedMiniProgram({
              appId: d.appid,
              path: fullPath,
              envVersion: 'release',
              fail: () => uni.showToast({ title: '呼起失败，请更新小程序版本', icon: 'none' }),
            });
          } else {
            uni.navigateToMiniProgram({
              appId: d.appid,
              path: fullPath,
              fail: () => uni.showToast({ title: '小程序跳转失败', icon: 'none' }),
            });
          }
        })
        .catch((e) => uni.showToast({ title: e.message ?? '呼起失败', icon: 'none' }));
      // #endif
    },
  },
};
</script>

<style scoped>
.grade-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding: 24rpx 32rpx 200rpx;
}
.brand-hero {
  background: #fffdf7;
  border: 3rpx solid var(--fyt-primary, #e8336d);
  border-radius: 24rpx;
  padding: 28rpx;
  display: flex;
  align-items: center;
  gap: 24rpx;
}
.bh-icon {
  width: 108rpx;
  height: 108rpx;
  border-radius: 24rpx;
  background: linear-gradient(160deg, #f0568b 0%, var(--fyt-primary, #e8336d) 100%);
  border: 3rpx solid #c9225a;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
/* 品牌 logo = 品牌名首字（上游 img 整站 403，弃图用字） */
.bh-char { font-size: 52rpx; font-weight: 900; color: #ffffff; }
.bh-main { flex: 1; display: flex; flex-direction: column; gap: 8rpx; min-width: 0; }
.bh-name { font-size: 34rpx; font-weight: 900; color: #2b2b2b; }
.bh-meta { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); }
.bh-tags { display: flex; gap: 12rpx; margin-top: 4rpx; flex-wrap: wrap; }
.bh-tag { border-radius: 8rpx; padding: 4rpx 12rpx; }
.bh-tag.gold { background: var(--fyt-secondary, #ffaa1d); }
.bh-tag.plain { background: #fdeef4; }
.bh-tag-text { font-size: 22rpx; font-weight: 800; color: #7a3c00; }
.bh-tag.plain .bh-tag-text { color: var(--fyt-primary-dark, #a31245); }
.grade-card {
  margin-top: 24rpx;
  background: #fffdf7;
  border: 3rpx solid var(--fyt-primary, #e8336d);
  border-radius: 24rpx;
  padding: 28rpx;
}
.gc-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20rpx; }
.gc-title { font-size: 32rpx; font-weight: 900; color: #2b2b2b; }
.gc-ratio { font-size: 22rpx; color: #b3a89a; }
.gc-empty {
  border: 2rpx dashed #e8d9c5;
  border-radius: 16rpx;
  padding: 48rpx 0;
  text-align: center;
  color: var(--fyt-text-2, #8c8577);
  font-size: 26rpx;
}
.grade-item {
  position: relative;
  border: 3rpx solid #eadfce;
  border-radius: 20rpx;
  background: #ffffff;
  padding: 24rpx;
  margin-bottom: 20rpx;
  display: flex;
  align-items: center;
  gap: 16rpx;
}
.grade-item.selected { border-color: var(--fyt-primary, #e8336d); background: #fdeef4; }
.gi-main { flex: 1; display: flex; flex-direction: column; gap: 6rpx; min-width: 0; }
.gi-name { font-size: 30rpx; font-weight: 800; color: #2b2b2b; }
.gi-sub { font-size: 22rpx; color: var(--fyt-text-2, #8c8577); }
.gi-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8rpx; flex-shrink: 0; }
.gi-points { display: flex; align-items: baseline; gap: 4rpx; }
.gi-num { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.gi-unit { font-size: 20rpx; color: var(--fyt-primary, #e8336d); }
.gi-save { background: var(--fyt-secondary, #ffaa1d); border-radius: 8rpx; padding: 2rpx 10rpx; }
.gi-save-text { font-size: 20rpx; font-weight: 800; color: #7a3c00; }
.gi-check {
  position: absolute;
  right: -6rpx;
  top: -6rpx;
  width: 44rpx;
  height: 44rpx;
  border-radius: 50%;
  background: var(--fyt-primary, #e8336d);
  display: flex;
  align-items: center;
  justify-content: center;
}
.gi-check-text { color: #ffffff; font-size: 26rpx; font-weight: 900; }
.ingot-bar {
  margin-top: 8rpx;
  background: #fdeef4;
  border-radius: 16rpx;
  padding: 22rpx 28rpx;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ib-left { font-size: 26rpx; font-weight: 800; color: var(--fyt-primary-dark, #a31245); }
.ib-right { font-size: 22rpx; color: #c9778f; }
.bottom-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fffdf7;
  border-top: 2rpx solid #f0e6d8;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bb-left { display: flex; flex-direction: column; gap: 4rpx; }
.bb-label { font-size: 22rpx; color: var(--fyt-text-2, #8c8577); }
.bb-amount-row { display: flex; align-items: baseline; gap: 6rpx; }
.bb-amount { font-size: 40rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.bb-unit { font-size: 22rpx; color: var(--fyt-primary, #e8336d); }
.bb-btn {
  background: var(--fyt-primary, #e8336d);
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 800;
  border-radius: 999rpx;
  padding: 0 64rpx;
  line-height: 88rpx;
}
.bb-btn[disabled] { background: #e9d5cd; color: #b3a89a; }
</style>
