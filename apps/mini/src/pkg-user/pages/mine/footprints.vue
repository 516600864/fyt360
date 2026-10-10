<template>
  <view class="fp-page" :style="pageTheme">
    <!-- 顶部：共 N 条 + 清空（红色描边） -->
    <view class="topbar">
      <text class="cnt">共 {{ total }} 条</text>
      <view v-if="total > 0" class="clear-btn" @tap="onClearTap">
        <text class="clear-t">清空</text>
      </view>
    </view>

    <!-- 按「今天 / 昨天 / 更早」分组（对标 rights/records.vue 分栏范式） -->
    <view v-if="loading" class="empty"><text class="empty-t">加载中…</text></view>

    <view v-else-if="!total" class="empty">
      <text class="empty-t">还没有浏览足迹\n去逛逛喜欢的服务，这里会留下记录</text>
    </view>

    <view v-for="g in GROUPS" :key="g.key">
      <view v-if="groups[g.key].length" class="grp">
        <text class="grp-name">{{ g.label }}</text>
        <text class="grp-cnt">{{ groups[g.key].length }} 条</text>
      </view>
      <view class="list">
        <view
          v-for="it in groups[g.key]"
          :key="it.id"
          class="fp-item"
          :class="{ off: !it.alive }"
          @tap="open(it)"
        >
          <view class="fi-icon" :class="{ dead: !it.alive }">
            <text class="fi-char">{{ it.alive ? iconOf(it) : '?' }}</text>
          </view>
          <view class="fi-main">
            <text class="fi-title">{{ it.title }}</text>
            <text class="fi-sub">
              <template v-if="it.alive">{{ kindLabel(it.kind) }} · {{ hm(it.viewed_at) }} 浏览</template>
              <template v-else>已下架 · {{ md(it.viewed_at) }} 浏览</template>
            </text>
          </view>
          <view class="fi-del" @tap.stop="remove(it)"><text class="fi-del-t">删除</text></view>
        </view>
      </view>
    </view>

    <!-- 隐私说明双行（产品红线：行为数据必须给清空入口 + 用途说明） -->
    <view v-if="total > 0" class="privacy">
      <text class="pv-l">足迹仅保存在你的账号内，用于方便你回看</text>
      <text class="pv-l">最多保留 {{ limits.max_rows }} 条 / {{ limits.keep_days }} 天，不做任何推荐用途</text>
    </view>

    <!-- 清空二次确认弹层（写明条数 + 不可恢复） -->
    <view v-if="showConfirm" class="mask" @tap="showConfirm = false">
      <view class="dialog" @tap.stop>
        <text class="dlg-title">清空浏览足迹？</text>
        <text class="dlg-desc">共 {{ total }} 条记录将被删除，且无法恢复</text>
        <view class="dlg-actions">
          <view class="dlg-btn ghost" @tap="showConfirm = false"><text class="dlg-btn-t">取消</text></view>
          <view class="dlg-btn solid" @tap="doClear"><text class="dlg-btn-t on">确认清空</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
/**
 * 浏览足迹（画布 mini-06C 增补稿，决策 #41）
 * GET /api/me/footprints、DELETE /api/me/footprints[/:id]
 *
 * ⛔ 三条硬规则（这页的设计含量都在这）：
 *  ① **上限最近 200 条 + 保留 30 天** —— 足迹会膨胀，服务端写入时prune（铁律④）
 *  ② **按「今天 / 昨天 / 更早」分组** —— 服务端算好 group 字段再返回，
 *     端上**不自己算日界**（toISOString 是 UTC，差 8 小时的老坑，见 project memory）
 *  ③ **单条删除 + 全部清空** —— 行为数据，隐私上必须给清空入口 + 用途说明
 *
 * ⛔ 隐私红线：足迹**仅供用户自己回看**，不得用于推荐 / 运营展示。
 *    底部那句「不做任何推荐用途」是产品承诺，不是装饰文案，不要删。
 */
import { request } from '@/utils/request';
import { handleAction } from '@/core/action';

export default {
  data() {
    return {
      loading: true,
      items: [],
      limits: { max_rows: 200, keep_days: 30 },
      showConfirm: false,
      // 上限文案与服务端同源（服务端 limits 字段返回），不要在前端写死
      GROUPS: [
        { key: 'today', label: '今天' },
        { key: 'yesterday', label: '昨天' },
        { key: 'earlier', label: '更早' },
      ],
    };
  },
  computed: {
    total() {
      return this.items.length;
    },
    /** 三分组（服务端已按 group 字段归好，这里只做展示顺序，不重算日界） */
    groups() {
      const g = { today: [], yesterday: [], earlier: [] };
      for (const it of this.items) {
        const k = ['today', 'yesterday', 'earlier'].includes(it.group) ? it.group : 'earlier';
        g[k].push(it);
      }
      return g;
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
    hm(t) {
      const d = new Date(t);
      if (Number.isNaN(d.getTime())) return '--:--';
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
    md(t) {
      const d = new Date(t);
      if (Number.isNaN(d.getTime())) return '--';
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    async load() {
      this.loading = true;
      try {
        const d = await request('/api/me/footprints');
        this.items = d.items ?? [];
        if (d.limits) this.limits = d.limits;
      } catch (e) {
        this.items = [];
        uni.showToast({ title: e.message ?? '加载失败', icon: 'none' });
      }
      this.loading = false;
    },
    open(it) {
      if (!it.alive) {
        uni.showToast({ title: '该服务已下架', icon: 'none' });
        return;
      }
      if (it.kind === 'self_goods') {
        uni.navigateTo({ url: `/pkg-goods/pages/goods/self-detail?id=${encodeURIComponent(it.ref_id)}` });
        return;
      }
      if (it.kind === 'cps_goods') {
        const [platform, ...rest] = String(it.ref_id).split('_');
        const goodsId = rest.join('_');
        uni.navigateTo({ url: `/pkg-goods/pages/goods/detail?platform=${encodeURIComponent(platform)}&id=${encodeURIComponent(goodsId)}` });
        return;
      }
      handleAction({ type: 'plugin-launch', value: it.ref_id });
    },
    async remove(it) {
      try {
        await request(`/api/me/footprints/${encodeURIComponent(String(it.id))}`, { method: 'DELETE' });
        this.items = this.items.filter((x) => x.id !== it.id);
        uni.showToast({ title: '已删除', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: e.message ?? '删除失败', icon: 'none' });
      }
    },
    onClearTap() {
      this.showConfirm = true;
    },
    async doClear() {
      this.showConfirm = false;
      try {
        await request('/api/me/footprints', { method: 'DELETE' });
        this.items = [];
        uni.showToast({ title: '已清空', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: e.message ?? '清空失败', icon: 'none' });
      }
    },
  },
};
</script>

<style lang="scss" scoped>
/* 视觉零发明：照抄 MineView + 画布 06C */
.fp-page {
  min-height: 100vh;
  background: var(--fyt-surface, #FFF6E9);
  padding-bottom: 120rpx; /* 底部留给毛玻璃 tabBar 穿透 */
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx 0;
}
.cnt { font-size: 26rpx; color: var(--fyt-text-2, #8C8577); }
.clear-btn {
  border: 2rpx solid var(--fyt-primary, #E8336D);
  border-radius: 999rpx;
  padding: 8rpx 28rpx;
}
.clear-t { font-size: 24rpx; font-weight: 700; color: var(--fyt-primary, #E8336D); }

.grp {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 0;
}
.grp-name { font-size: 28rpx; font-weight: 900; color: var(--fyt-primary-dark, #A31245); }
.grp-cnt { font-size: 22rpx; color: var(--fyt-text-2, #8C8577); }

.list { padding: 16rpx 32rpx 0; display: flex; flex-direction: column; gap: 20rpx; }

.fp-item {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 28rpx;
  background: #fff;
  border: 3rpx solid var(--fyt-primary, #E8336D);
  border-radius: 28rpx;
  box-shadow: 0 8rpx 24rpx rgba(163, 18, 69, 0.18);
}
.fp-item.off { background: #F7F2EC; border-color: #E3D9CD; box-shadow: none; }

.fi-icon {
  width: 76rpx; height: 76rpx;
  border-radius: 50%;
  background: #FDE7EF;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.fi-icon.dead { background: #ECE4D9; }
.fi-char { font-size: 34rpx; font-weight: 900; color: var(--fyt-primary, #E8336D); }
.fi-icon.dead .fi-char { color: #B59AA1; }

.fi-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8rpx; }
.fi-title {
  font-size: 28rpx; font-weight: 800; color: var(--fyt-primary-dark, #A31245);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.fi-sub { font-size: 22rpx; color: var(--fyt-text-2, #8C8577); }
.fp-item.off .fi-title, .fp-item.off .fi-sub { color: #B59AA1; }

.fi-del { flex-shrink: 0; padding: 8rpx 0 8rpx 16rpx; }
.fi-del-t { font-size: 22rpx; color: var(--fyt-text-2, #8C8577); text-decoration: underline; }

.empty {
  margin: 32rpx;
  border: 3rpx dashed #E8D9C5;
  border-radius: 28rpx;
  padding: 64rpx 32rpx;
  text-align: center;
}
.empty-t { font-size: 26rpx; color: var(--fyt-text-2, #8C8577); line-height: 1.7; white-space: pre-line; }

/* 隐私说明双行 */
.privacy { margin: 32rpx 32rpx 0; display: flex; flex-direction: column; gap: 8rpx; }
.pv-l { font-size: 22rpx; color: var(--fyt-text-2, #8C8577); text-align: center; line-height: 1.6; }

/* 清空二次确认弹层 */
.mask {
  position: fixed; left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(61, 37, 48, 0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 900;
}
.dialog {
  width: 620rpx;
  background: var(--fyt-surface, #FFF6E9);
  border: 3rpx solid var(--fyt-primary, #E8336D);
  border-radius: 28rpx;
  padding: 40rpx 32rpx 32rpx;
  box-shadow: 0 12rpx 32rpx rgba(163, 18, 69, 0.24);
}
.dlg-title {
  display: block; text-align: center;
  font-size: 32rpx; font-weight: 900; color: var(--fyt-primary-dark, #A31245);
}
.dlg-desc {
  display: block; text-align: center;
  margin-top: 16rpx;
  font-size: 24rpx; color: var(--fyt-text-2, #8C8577);
}
.dlg-actions { display: flex; gap: 20rpx; margin-top: 32rpx; }
.dlg-btn {
  flex: 1; border-radius: 999rpx; padding: 18rpx 0; text-align: center;
}
.dlg-btn.ghost { border: 3rpx solid var(--fyt-primary, #E8336D); background: transparent; }
.dlg-btn.solid { background: var(--fyt-primary, #E8336D); border: 3rpx solid var(--fyt-primary, #E8336D); }
.dlg-btn-t { font-size: 28rpx; font-weight: 800; color: var(--fyt-primary, #E8336D); }
.dlg-btn-t.on { color: #fff; }
</style>