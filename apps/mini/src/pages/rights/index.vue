<template>
  <view class="rights-page" :style="pageTheme">
    <!-- 福袋兽过渡遮罩（与 07B 同规格）：catalog 走蚂蚁星球实时透传较慢，遮罩防白屏 + BUILD 身份牌 -->
    <view v-if="loading" class="loading-mask">
      <view class="loading-card">
        <text class="loading-beast">🦊</text>
        <text class="loading-coin">💰</text>
        <text class="loading-text">福袋兽搬金币中…</text>
        <text class="loading-ver">{{ buildVer }}</text>
      </view>
    </view>

    <!-- 玫红渐变头（画布 05） -->
    <view class="hero">
      <view class="hero-title-row">
        <text class="hero-crown">👑</text>
        <text class="hero-title">会员权益</text>
      </view>
      <text class="hero-sub">全品类权益兑换 · 影音娱乐 / 读书学习 / 餐饮美食 / 外卖出行</text>
      <view class="hero-pill"><text class="hero-pill-text">⚡ 积分兑换低至 3 折起</text></view>
    </view>

    <!-- 提示条（画布 05：黄底棕字） -->
    <view class="notice">
      <text class="notice-text">已实时加载 {{ total }} 个品牌权益，归为 {{ groups.length }} 大分类。点品牌 → 呼起兑换小程序 → 选档购买完成兑换。</text>
    </view>


    <!-- 分类 chips -->
    <scroll-view scroll-x class="chips-scroll">
      <view class="chips">
        <text class="chip" :class="{ active: cat === '' }" @click="cat = ''">全部</text>
        <text v-for="g in groups" :key="g.key" class="chip" :class="{ active: cat === g.key }" @click="cat = g.key">{{ g.name }}</text>
      </view>
    </scroll-view>

    <!-- 品牌卡列表（画布 05：品牌维度，聚合档位） -->
    <view class="brand-list">
      <view v-if="!loading && !brandCards.length" class="empty"><text>该分类暂无权益，看看其他分类吧</text></view>
      <view v-for="b in brandCards" :key="b.key" class="brand-card" @click="goLaunch(b)">
        <view class="bc-icon"><text class="bc-char">{{ b.char }}</text></view>
        <view class="bc-main">
          <text class="bc-name">{{ b.brand }}</text>
          <text class="bc-meta">共 {{ b.count }} 档可选 · 积分兑换</text>
          <view v-if="b.max_save > 0" class="bc-save"><text class="bc-save-text">最高省 ¥{{ b.max_save }}</text></view>
        </view>
        <view class="bc-btn">
          <text class="bc-btn-num">{{ fmtPoints(b.min_points) }}</text>
          <text class="bc-btn-unit">积分起</text>
        </view>
      </view>
    </view>

    <text class="footnote">本页为兑换入口 · 履约与积分由蚂蚁星球完成，积分价为兑换页内价格（仅展示）</text>
  </view>
</template>

<script>
/**
 * 画布 05 会员权益页（9:250，M5·权益会员）：
 * fasttype 实时透传（/api/rights/catalog，不落库）→ 展平为品牌维度卡片（同品牌多档聚合：共 N 档可选 / 最高省 / 积分起）；
 * 分类 chips 按 6 大分类过滤；点卡 → 档位页（grade，?key=分类&brand=品牌 自动定位首档）→ 呼起蚂蚁星球兑换。
 */
import { request } from '../../utils/request';

const EMOJI_MAP = {
  视频: '🎬', 影音: '🎬', 音频: '🎧', 音乐: '🎧', 读书: '📚', 阅读: '📚', 学习: '📚',
  餐饮: '🍔', 美食: '🍔', 外卖: '🛵', 出行: '🚗', 打车: '🚕', 生活: '🧡', 其他: '🎁',
};

export default {
  data() {
    return {
      loading: true,
      buildVer: 'BUILD 20260930.1135', // 遮罩可见版本身份牌：出遮罩即知跑的是哪版包
      groups: [],
      total: 0,
      cat: '',
    };
  },
  computed: {
    /** 品牌维度卡片：展平全部分类 items，按 (type_code, brand) 聚合档位（画布 05 数据面） */
    brandCards() {
      const out = [];
      const seen = new Map();
      for (const g of this.groups) {
        if (this.cat && g.key !== this.cat) continue;
        for (const it of g.items ?? []) {
          const k = `${g.key}|${it.brand}`;
          const prev = seen.get(k);
          if (prev) {
            prev.count += 1;
            // 低价档优先（first_cid 跟着最低档走；0/无效价不参与比较）
            const np = Number(it.min_points ?? 0);
            if (np > 0 && (prev.min_points <= 0 || np < prev.min_points)) {
              prev.min_points = np;
              prev.first_cid = Number(it.cid ?? prev.first_cid);
            }
            prev.max_save = Math.max(prev.max_save, Number(it.max_save ?? 0));
          } else {
            const brandStr = String(it.brand ?? it.name ?? '权益');
            const card = {
              key: k,
              typeCode: g.key,
              typeName: g.name,
              brand: brandStr,
              char: brandStr.charAt(0) || '权',
              img: String(it.img ?? ''),
              count: 1,
              min_points: Number(it.min_points ?? 0),
              max_save: Number(it.max_save ?? 0),
              first_cid: Number(it.cid ?? 0), // 最低价档 cid（直接半屏呼起的默认档位）
            };
            seen.set(k, card);
            out.push(card);
          }
        }
      }
      return out;
    },
  },
  onLoad() {
    // 独立页直开时触发（内嵌壳页时 onLoad 不执行，由 mounted 兜底；load 内部防双请求）
    this.load();
  },
  mounted() {
    // 壳页内嵌（tab 壳）时仅 mounted 会执行——守卫只看数据是否已加载，不得看 loading 初始态
    if (!this.groups.length) this.load();
  },
  methods: {
    emojiOf(name) {
      for (const [k, v] of Object.entries(EMOJI_MAP)) {
        if (String(name).includes(k)) return v;
      }
      return '🎁';
    },
    fmtPoints(n) {
      return Number(n ?? 0).toLocaleString();
    },
    /** withMask：最短展示 600ms（与 07B 同规格）——快网下遮罩不闪没，慢网时接口本身盖住等待 */
    async withMask(fn) {
      const min = new Promise((r) => setTimeout(r, 600));
      try {
        await Promise.all([fn(), min]);
      } finally {
        this.loading = false;
      }
    },
    load() {
      if (this._reqInFlight) return; // onLoad+mounted 双触发 / 壳页重复挂载防抖
      this._reqInFlight = true;
      this.loading = true;
      this.withMask(async () => {
        try {
          const d = await request('/api/rights/catalog');
          this.groups = d.groups ?? [];
          this.total = d.total ?? 0;
        } catch (e) {
          uni.showToast({ title: e.message ?? '权益加载失败', icon: 'none' });
        }
      }).finally(() => {
        this._reqInFlight = false;
      });
    },
    goLaunch(b) {
      // 点品牌卡 → 直接半屏呼起蚂蚁兑换（D先生 定稿：不再跳内部档位页；默认带最低价档 cid）
      // #ifndef MP-WEIXIN
      uni.navigateTo({ url: `/pkg-rights/pages/rights/grade?key=${encodeURIComponent(b.typeCode)}&name=${encodeURIComponent(b.typeName)}&brand=${encodeURIComponent(b.brand)}` });
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
          const fullPath = `${d.path}${sep}cid=${b.first_cid}`;
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
.rights-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding-bottom: 40rpx;
}
.hero {
  background: linear-gradient(160deg, #f0568b 0%, var(--fyt-primary, #e8336d) 55%, #c9225a 100%);
  padding: 48rpx 32rpx 40rpx;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}
.hero-title-row { display: flex; align-items: center; gap: 14rpx; }
.hero-crown { font-size: 44rpx; }
.hero-title { font-size: 52rpx; font-weight: 900; color: #ffffff; letter-spacing: 2rpx; }
.hero-sub { font-size: 24rpx; color: #ffd9e6; }
.hero-pill {
  align-self: flex-start;
  margin-top: 6rpx;
  background: var(--fyt-secondary, #ffaa1d);
  border-radius: 999rpx;
  padding: 8rpx 24rpx;
  border: 3rpx solid #ffffff;
}
.hero-pill-text { font-size: 24rpx; font-weight: 800; color: #7a3c00; }
.notice {
  margin: 24rpx 32rpx 0;
  background: #fdf3d9;
  border: 2rpx solid #f5e3b8;
  border-radius: 16rpx;
  padding: 20rpx 24rpx;
}
.notice-text { font-size: 24rpx; color: #8a6b3a; line-height: 1.6; }
.chips-scroll { margin-top: 24rpx; white-space: nowrap; }
.chips { display: inline-flex; gap: 16rpx; padding: 0 32rpx; }
.chip {
  background: #fffdf7;
  border: 2rpx solid #e8d9c5;
  border-radius: 999rpx;
  padding: 12rpx 30rpx;
  font-size: 26rpx;
  color: #6b5a4e;
  font-weight: 600;
}
.chip.active { background: #2b2b2b; color: #ffffff; border-color: #2b2b2b; font-weight: 800; }
.chip-cat { background: var(--fyt-primary, #e8336d); color: #ffffff; border-color: var(--fyt-primary, #e8336d); font-weight: 800; }
.brand-list { padding: 24rpx 32rpx 0; display: flex; flex-direction: column; gap: 24rpx; }
.brand-card {
  background: #fffdf7;
  border: 3rpx solid var(--fyt-primary, #e8336d);
  border-radius: 24rpx;
  padding: 28rpx;
  display: flex;
  align-items: center;
  gap: 24rpx;
  box-shadow: 0 4rpx 0 rgba(232, 51, 109, 0.12);
}
.bc-icon {
  width: 96rpx;
  height: 96rpx;
  border-radius: 20rpx;
  background: linear-gradient(160deg, #f0568b 0%, var(--fyt-primary, #e8336d) 100%);
  border: 3rpx solid #c9225a;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
/* 品牌 logo = 品牌名首字（D先生 定稿：上游 img 整站 403 防盗链，弃图用字） */
.bc-char { font-size: 44rpx; font-weight: 900; color: #ffffff; }
.bc-main { flex: 1; display: flex; flex-direction: column; gap: 8rpx; min-width: 0; }
.bc-name { font-size: 32rpx; font-weight: 800; color: #2b2b2b; }
.bc-meta { font-size: 24rpx; color: var(--fyt-text-2, #8c8577); }
.bc-save {
  align-self: flex-start;
  background: #fff3d6;
  border-radius: 8rpx;
  padding: 4rpx 12rpx;
}
.bc-save-text { font-size: 22rpx; font-weight: 800; color: #c77800; }
.bc-btn {
  background: var(--fyt-primary, #e8336d);
  border-radius: 999rpx;
  padding: 14rpx 26rpx;
  display: flex;
  align-items: baseline;
  gap: 4rpx;
  flex-shrink: 0;
}
.bc-btn-num { font-size: 30rpx; font-weight: 900; color: #ffffff; }
.bc-btn-unit { font-size: 20rpx; color: #ffd9e6; }
.empty {
  background: #fffdf7;
  border: 2rpx dashed #e8d9c5;
  border-radius: 16rpx;
  padding: 48rpx 0;
  text-align: center;
  color: var(--fyt-text-2, #8c8577);
  font-size: 26rpx;
}
.footnote {
  display: block;
  margin: 32rpx 32rpx 0;
  font-size: 22rpx;
  color: #b3a89a;
  text-align: center;
  line-height: 1.6;
}

/* ---------- 福袋兽过渡遮罩（与 07B 同款规格） ---------- */
.loading-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(255, 246, 233, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
}
.loading-card { display: flex; flex-direction: column; align-items: center; gap: 20rpx; }
.loading-beast { font-size: 88rpx; animation: beast-bounce 0.9s ease-in-out infinite; }
.loading-coin { font-size: 52rpx; margin-top: -30rpx; animation: coin-sway 0.9s ease-in-out infinite; }
.loading-text { font-size: 30rpx; font-weight: 800; color: var(--fyt-primary, #e8336d); }
.loading-ver { font-size: 20rpx; color: #c9a7b3; margin-top: 8rpx; }
@keyframes beast-bounce {
  0%, 100% { transform: translateY(0) rotate(-6deg); }
  50% { transform: translateY(-24rpx) rotate(6deg); }
}
@keyframes coin-sway {
  0%, 100% { transform: translateX(-14rpx); }
  50% { transform: translateX(14rpx); }
}
</style>
