/**
 * 企业微信客服 · H5 端（迁移 040 · D先生 2026-10-05）
 *
 * ⚠️ 与小程序端的能力差异（**事实，不是选择**）：
 *   wx.openCustomerServiceChat 是**小程序专属 API，H5 不存在**。
 *   H5 唯一可行的方式是**整页跳转**到企业微信客服链接
 *   （用户在微信内置浏览器里点，会被拉起会话；在外部浏览器则打开企微网页版）。
 *   所以 H5 的实现比小程序"弱"是正常的，不要试图在 H5 上找更强的方案。
 *
 * 为什么和 mini 各写一份而不是抽公共包：
 *   两端 utils/request.js 的 SITE_CODE 来源不同（mini 从 core/bootstrap 导出，
 *   h5 从 utils/request 导出），强行共用会引入跨应用路径依赖。
 *   逻辑本身保持一致：读同一接口 /api/site/kf，未开通给明确提示。
 *
 * 降级链路（与小程序口径一致，D先生 2026-10-05 拍板）：
 *   未开通        → toast（H5 端有商家地址时弹 modal 给地址）
 *   已开通        → 整页跳转（"即将跳转客服会话…" 提示，避免用户以为没点上）
 */
import { request, SITE_CODE } from './request';

const TTL = 5 * 60 * 1000;
let cache = null;
let inflight = null;

function fetchKf(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL) return Promise.resolve(cache.data);
  if (inflight) return inflight;

  inflight = request(`/api/site/kf?code=${encodeURIComponent(SITE_CODE)}`, { timeout: 8000 })
    .then((d) => {
      cache = { at: Date.now(), data: d || {} };
      return cache.data;
    })
    .catch(() => {
      cache = { at: Date.now(), data: { enabled: false, kf_url: null, shop_addr: null } };
      return cache.data;
    })
    .finally(() => { inflight = null; });

  return inflight;
}

/**
 * 打开客服：H5 只能整页跳转
 * @returns {Promise<'opened'|'unavailable'>}
 */
export async function openCustomerService() {
  const d = await fetchKf();
  const url = d && d.kf_url;

  if (!(d && d.enabled) || !url) {
    if (d && d.shop_addr) {
      uni.showModal({ title: '联系客服', content: `客服暂未开通。商家地址：${d.shop_addr}`, showCancel: false });
      return 'unavailable';
    }
    uni.showToast({ title: '客服暂未开通', icon: 'none' });
    return 'unavailable';
  }

  uni.showToast({ title: '即将跳转客服会话…', icon: 'none' });
  // 延后跳转让 toast 先渲染（同帧跳转会看不到提示）
  setTimeout(() => { window.location.href = url; }, 120);
  return 'opened';
}

/** 预取（进详情页静默拉一次，点客服零等待） */
export function prefetchKf() {
  return fetchKf().catch(() => null);
}
