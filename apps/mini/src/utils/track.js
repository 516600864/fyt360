import { request } from './request';

/**
 * 统一浏览埋点（决策 #41：足迹写入的唯一入口）
 *
 * ⛔ 为什么要有这个文件：
 *   足迹要「谁点了什么」都记下来，若每页手动埋，必然漏 + 重复。
 *   统一挂在这里 → 任何页面想记足迹只调 trackView()，不关心传输细节。
 *
 * ⛔ 铁律：埋点**永远不能阻塞用户跳转**
 *   - 不await（调用方不等待）
 *   - 失败静默（吞异常，绝不弹 toast）
 *   足迹是辅助功能，写库失败也不能让用户点不动商品。
 *
 * ⛔ kind 口径（决策 #35：两类性质不同，不得混）：
 *   self_goods   = 到店服务（自营团购商品）
 *   rights_brand = 权益兑换（fasttype 权益品牌 / 决策 #35 分类）
 * 传错 kind 会进错筛选分块，端上分类就乱了。
 *
 * ⛔ 只存指针：这里只传 ref_id + 冗余 title，**不传价格 / 库存 / 图片**。
 *   铁律② —— title 冗余是为了列表不用逐行请求，绝不是当业务快照用。
 */

/**
 * 记录一次浏览
 * @param {string} kind     self_goods | rights_brand
 * @param {string} refId    指针：self_goods=goods_id / rights_brand=brand code
 * @param {string} title    展示名（冗余一份，供列表直接渲染）
 * @param {string} iconChar 首字/emoji 图标（上游无图，403 高发 → 只存字符）
 */
export function trackView(kind, refId, title, iconChar = '') {
  if (!kind || !refId) return;
  try {
    request('/api/me/footprints', {
      method: 'POST',
      data: { kind, ref_id: String(refId), title: String(title ?? ''), icon_char: iconChar },
    }).catch(() => {});
  } catch (e) {
    /* 静默 */
  }
}

/** 收藏态查询（商详页那颗 ♡ 的初始实心/空心） */
export async function fetchFavoriteState(kind, refId) {
  if (!kind || !refId) return false;
  try {
    const d = await request(`/api/me/favorites/state?kind=${encodeURIComponent(kind)}&ref_id=${encodeURIComponent(refId)}`);
    return !!d?.favorited;
  } catch (e) {
    return false; // 未登录 / 网络失败 → 一律按未收藏，不报错
  }
}

/**
 * 切换收藏态（商详页那颗 ♡ 的点击）
 * @returns {Promise<boolean>} 切换后的收藏态
 */
export async function toggleFavorite(kind, refId, title, iconChar = '') {
  const on = await fetchFavoriteState(kind, refId);
  if (on) {
    await request(`/api/me/favorites/${encodeURIComponent(String(refId))}?kind=${encodeURIComponent(kind)}&ref_id=${encodeURIComponent(refId)}`, {
      method: 'DELETE',
    });
    uni.showToast({ title: '已取消收藏', icon: 'none' });
    return false;
  }
  await request('/api/me/favorites', {
    method: 'POST',
    data: { kind, ref_id: String(refId), title: String(title ?? ''), icon_char: iconChar },
  });
  uni.showToast({ title: '已收藏', icon: 'none' });
  return true;
}