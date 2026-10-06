/**
 * 剪贴板统一封装。
 * 铁坑：wx.setClipboardData 是隐私接口——mp 后台《用户隐私保护指引》未声明「剪贴板」类型时
 * 真机调用直接 fail（api scope is not declared in the privacy agreement）。
 * 历史坑：各处裸调 setClipboardData 无 fail 回调 → 静默失败无任何反馈。
 * 统一走这里：成功 toast + 失败可见（含隐私协议提示）。
 */
export function copyText(text, tip = '已复制') {
  const data = String(text ?? '');
  if (!data) {
    uni.showToast({ title: '内容为空，无法复制', icon: 'none' });
    return;
  }
  uni.setClipboardData({
    data,
    success: () => uni.showToast({ title: tip, icon: 'success' }),
    fail: (err) => {
      const msg = String(err?.errMsg ?? '');
      // #ifdef MP-WEIXIN
      if (msg.includes('privacy') || msg.includes('privacy agreement')) {
        uni.showToast({ title: '复制失败：小程序后台隐私指引未声明「剪贴板」', icon: 'none', duration: 3000 });
      } else {
        uni.showToast({ title: '复制失败', icon: 'none' });
      }
      // #endif
      // #ifndef MP-WEIXIN
      uni.showToast({ title: '复制失败', icon: 'none' });
      // #endif
      console.error('[clip] setClipboardData fail:', err);
    },
  });
}
