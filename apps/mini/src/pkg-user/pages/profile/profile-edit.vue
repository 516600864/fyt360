<template>
  <view class="edit-page" :style="pageTheme">
    <view class="form-card">
      <!-- 头像：微信头像填写能力（open-type=chooseAvatar，官方合规通道） -->
      <view class="f-row avatar-row">
        <text class="f-label">头像</text>
        <button class="avatar-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
          <image v-if="avatar" class="avatar-img" :src="avatar" mode="aspectFill" />
          <text v-else class="avatar-ph">📷</text>
        </button>
      </view>
      <!-- 昵称：微信昵称填写能力（type=nickname 官方合规通道） -->
      <view class="f-row">
        <text class="f-label">昵称</text>
        <input class="f-input" v-model="nickname" type="nickname" maxlength="20" placeholder="请输入昵称" placeholder-class="ph" />
      </view>
    </view>

    <view class="bottom-bar">
      <button class="save-btn" @click="onSave" :disabled="busy">保存资料</button>
    </view>
  </view>
</template>

<script>
/**
 * 个人资料编辑（画布 28「个人资料」配套）：
 * 微信官方头像昵称填写能力（chooseAvatar + type=nickname，合规拿真实头像昵称，无需 scope.userInfo）。
 * 保存 = POST /api/profile { nickname, avatar }（chooseAvatar 返回临时路径 → uni.uploadFile 传 server？）
 * 简化：临时文件先 uni.uploadFile 到 /api/profile/avatar 再 POST /profile 存 URL。
 */
import { request } from '@/utils/request';

export default {
  data() {
    return { nickname: '', avatar: '', avatarTmp: '', busy: false };
  },
  onLoad(q) {
    this.nickname = decodeURIComponent(String(q.nickname ?? ''));
    this.avatar = decodeURIComponent(String(q.avatar ?? ''));
  },
  methods: {
    onChooseAvatar(e) {
      this.avatarTmp = e?.detail?.avatarUrl ?? '';
      this.avatar = this.avatarTmp || this.avatar;
    },
    async onSave() {
      if (this.busy) return;
      if (!this.nickname.trim()) return uni.showToast({ title: '请填写昵称', icon: 'none' });
      this.busy = true;
      try {
        let avatarUrl = this.avatar;
        // 临时文件 → base64 → /api/profile/avatar（云存储，返回持久 /api/media URL）
        if (this.avatarTmp) {
          const fs = uni.getFileSystemManager();
          const b64 = fs.readFileSync(this.avatarTmp, 'base64');
          const j = await request('/api/profile/avatar', {
            method: 'POST',
            data: { filename: 'avatar.png', data: b64 },
          });
          avatarUrl = j.url;
        }
        await request('/api/profile', { method: 'POST', data: { nickname: this.nickname.trim(), avatar: avatarUrl } });
        uni.showToast({ title: '资料已保存', icon: 'success' });
        setTimeout(() => uni.navigateBack(), 600);
      } catch (e) {
        uni.showToast({ title: e.message ?? '保存失败', icon: 'none' });
      }
      this.busy = false;
    },
  },
};
</script>

<style scoped>
.edit-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding: 24rpx 32rpx 160rpx;
}
.form-card {
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 20rpx;
  padding: 4rpx 28rpx;
}
.f-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 26rpx 0;
  border-bottom: 2rpx solid #fdeef4;
}
.f-row:last-child { border-bottom: none; }
.avatar-row { padding: 20rpx 0; }
.f-label { width: 140rpx; flex-shrink: 0; font-size: 28rpx; font-weight: 700; color: #2b2b2b; }
.f-input { flex: 1; font-size: 28rpx; color: #2b2b2b; }
.ph { color: #b3a89a; }
.avatar-btn {
  width: 128rpx;
  height: 128rpx;
  border-radius: 50%;
  background: #fdeef4;
  border: none;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.avatar-btn::after { border: none; }
.avatar-img { width: 128rpx; height: 128rpx; }
.avatar-ph { font-size: 48rpx; }
.bottom-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #ffffff;
  padding: 20rpx 32rpx calc(20rpx + env(safe-area-inset-bottom));
  border-top: 2rpx solid #f7c2d6;
}
.save-btn {
  background: linear-gradient(160deg, #f0568b, var(--fyt-primary, #e8336d));
  color: #ffffff;
  font-size: 32rpx;
  font-weight: 900;
  border-radius: 999rpx;
  padding: 22rpx 0;
  border: none;
}
</style>
