<template>
  <view class="fav-page" :style="pageTheme">
    <!-- 顶部三筛选（决策 #35：到店服务 / 权益兑换性质不同，不混块） -->
    <view class="filters">
      <view
        v-for="f in FILTERS"
        :key="f.key"
        class="chip"
        :class="{ on: filter === f.key }"
        @tap="filter = f.key"
      >
        <text class="chip-t">{{ f.label }}</text>
      </view>
    </view>

    <!-- 计数行 -->
    <text class="count">共 {{ visible.length }} 个收藏</text>

    <!-- 列表 -->
    <view class="list">
      <view v-if="loading" class="empty"><text class="empty-t">加载中…</text></view>

      <view v-else-if="!visible.length" class="empty">
        <text class="empty-t">{{ emptyText }}</text>
      </view>

      <view
        v-for="it in visible"
        :key="it.id"
        class="fav-item"
        :class="{ off: !it.alive }"
        @tap="open(it)"
      >
        <!-- 圆形首字图标（上游无图，403 高发 → 统一首字/emoji，失效态用? 占位） -->
        <view class="fi-icon" :class="{ dead: !it.alive }">
          <text class="fi-char">{{ it.alive ? iconOf(it) : '?' }}</text>
        </view>
        <view class="fi-main">
          <text class="fi-title">{{ it.title }}</text>
          <text class="fi-sub">
            <template v-if="it.alive">{{ kindLabel(it.kind) }} · 收藏于 {{ mmdd(it.created_at) }}</template>
            <template v-else>已下架 · 收藏于 {{ mmdd(it.created_at) }}</template>
          </text>
        </view>
        <!-- 收藏态爱心：矢量重画（emoji 在 flex 容器里会与兄弟节点并排，渲成两个分离小方块） -->
        <view class="fi-heart" @tap.stop="toggle(it)">
          <text class="fi-heart-t">{{ it._fav ? '♥' : '♡' }}</text>
        </view>
      </view>
    </view>

    <!-- 底部口径注：收藏存的是入口，不是商品副本 -->
    <text class="footnote">收藏保存的是服务入口，价格与库存以打开时为准</text>
  </view>
</template>

<script>
/**
 * 我的收藏（画布 mini-06B 增补稿，决策 #41）
 * GET /api/me/favorites?kind=all|self_goods|rights_brand
 *
 * ⛔ 口径：只存指针不存快照 → **必须有失效态**。
 *    服务/商品被下架后指针还在但打不开，这里显示灰底「已下架」+ 空心♡，仍可取消收藏。
 *    这不是 bug，是铁律①「不存快照」的必然结果。
 * ⛔ 三筛选在端上切分（服务端一次返回全量），两类性质不同不混块（决策 #35）。
 */
import { request } from '../../utils/request';
import { toggleFavorite } from '../../utils/track';
import { handleAction } from '../../core/action';

export default {
  data() {
    return {
      loading: true,
      filter: 'all',
      items: [],
      FILTERS: [
        { key: 'all', label: '全部' },
        { key: 'self_goods', label: '到店服务' },
        { key: 'rights_brand', label: '权益兑换' },
      ],
    };
  },
  computed: {
    visible() {
      return this.filter === 'all' ? this.items : this.items.filter((i) => i.kind === this.filter);
    },
    /** 空态分两种文案：没收藏过 ≠ 筛选后为空（口径不同，误导用户） */
    emptyText() {
      if (this.filter === 'all') return '还没有收藏过喜欢的服务\n逛逛到店服务或权益兑换，点 ♥ 收藏';
      return `「${(this.FILTERS.find((f) => f.key === this.filter) || {}).label}」下还没有收藏`;
    },
  },
  onShow() {
    this.load();
  },
  methods: {
    kindLabel(kind) {
      if (kind === 'rights_brand') return '权益兑换';
      if (kind === 'cps_goods') return 'CPS 好物';
      return '到店服务';
    },
    iconOf(it) {
      if (it.icon_char) return it.icon_char;
      return String(it.title ?? '?').trim().charAt(0) || '?';
    },
    mmdd(t) {
      const d = new Date(t);
      if (Number.isNaN(d.getTime())) return '--';
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    async load() {
      this.loading = true;
      try {
        const d = await request('/api/me/favorites');
        // _fav：列表项天然都在收藏里，统一置true；取消收藏后本地移除
        this.items = (d.items ?? []).map((i) => ({ ...i, _fav: true }));
      } catch (e) {
        this.items = [];
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      }
      this.loading = false;
    },
    /** 点条目：重新透传拿最新价（不信任任何本地缓存的价格/库存） */
    open(it) {
      if (!it.alive) {
        uni.showToast({ title: '该服务已下架', icon: 'none' });
        return;
      }
      if (it.kind === 'self_goods') {
        uni.navigateTo({ url: `/pages/goods/self-detail?id=${encodeURIComponent(it.ref_id)}` });
        return;
      }
      if (it.kind === 'cps_goods') {
        // ref_id = `${platform}_${goodsId}`；不同平台同ID 不同商品，平台前缀不可省
        const [platform, ...rest] = String(it.ref_id).split('_');
        const goodsId = rest.join('_');
        uni.navigateTo({ url: `/pages/goods/detail?platform=${encodeURIComponent(platform)}&id=${encodeURIComponent(goodsId)}` });
        return;
      }
      // 权益兑换：走决策 #35 的统一分发（brand_code → handleAction → brand-launch 半屏/全屏）
      handleAction({ type: 'plugin-launch', value: it.ref_id });
    },
    async toggle(it) {
      if (it._busy) return;
      it._busy = true;
      try {
        if (it._fav) {
          await request(`/api/me/favorites/${encodeURIComponent(String(it.id))}`, { method: 'DELETE' });
          this.items = this.items.filter((x) => x.id !== it.id);
          uni.showToast({ title: '已取消收藏', icon: 'none' });
        } else {
          await toggleFavorite(it.kind, it.ref_id, it.title, it.icon_char ?? '');
          it._fav = true;
        }
      } catch (e) {
        uni.showToast({ title: e.message ?? '操作失败', icon: 'none' });
      }
      it._busy = false;
    },
  },
};
</script>

<style lang="scss" scoped>
/* 视觉零发明：圆角/描边/阴影/底色全部照抄 MineView + 画布 06B */
.fav-page {
  min-height: 100vh;
  background: var(--fyt-surface, #FFF6E9);
  padding-bottom: 120rpx; /* 底部留给毛玻璃 tabBar 穿透 */
}

.filters {
  display: flex;
  gap: 20rpx;
  padding: 24rpx 32rpx 0;
}
.chip {
  padding: 14rpx 40rpx;
  border-radius: 999rpx;
  border: 2rpx solid var(--fyt-primary, #E8336D);
  background: var(--fyt-surface, #FFF6E9);
}
.chip.on { background: var(--fyt-primary, #E8336D); }
.chip-t { font-size: 26rpx; font-weight: 700; color: var(--fyt-primary, #E8336D); }
.chip.on .chip-t { color: #fff; }

.count {
  display: block;
  padding: 28rpx 32rpx 0;
  font-size: 24rpx;
  color: var(--fyt-text-2, #8C8577);
}

.list { padding: 20rpx 32rpx 0; display: flex; flex-direction: column; gap: 24rpx; }

.fav-item {
  display: flex;
  align-items: center;
  gap: 24rpx;
  padding: 28rpx;
  background: #fff;
  border: 3rpx solid var(--fyt-primary, #E8336D);
  border-radius: 28rpx;
  box-shadow: 0 8rpx 24rpx rgba(163, 18, 69, 0.18);
}
/* 失效态（画稿 #F7F2EC 灰底 + 置灰 + 「已下架」） */
.fav-item.off {
  background: #F7F2EC;
  border-color: #E3D9CD;
  box-shadow: none;
}

.fi-icon {
  width: 88rpx; height: 88rpx;
  border-radius: 50%;
  background: #FDE7EF;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.fi-icon.dead { background: #ECE4D9; }
.fi-char { font-size: 40rpx; font-weight: 900; color: var(--fyt-primary, #E8336D); }
.fi-icon.dead .fi-char { color: #B59AA1; }

.fi-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10rpx; }
.fi-title {
  font-size: 30rpx; font-weight: 800; color: var(--fyt-primary-dark, #A31245);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fi-sub { font-size: 22rpx; color: var(--fyt-text-2, #8C8577); }
.fav-item.off .fi-title, .fav-item.off .fi-sub { color: #B59AA1; }

.fi-heart { flex-shrink: 0; padding: 8rpx; }
.fi-heart-t { font-size: 44rpx; color: var(--fyt-primary, #E8336D); }
.fav-item.off .fi-heart-t { color: #B59AA1; }

.empty {
  border: 3rpx dashed #E8D9C5;
  border-radius: 28rpx;
  padding: 64rpx 32rpx;
  text-align: center;
}
.empty-t { font-size: 26rpx; color: var(--fyt-text-2, #8C8577); line-height: 1.7; white-space: pre-line; }

.footnote {
  display: block;
  margin: 32rpx 32rpx 0;
  font-size: 22rpx;
  color: var(--fyt-text-2, #8C8577);
  text-align: center;
}
</style>