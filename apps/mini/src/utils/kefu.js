/**
 * 企业微信客服统一入口（迁移 040 · D先生 2026-10-05）
 *
 * 为什么单独一个文件：客服入口散在 4 处（我的宫格 / 商品详情页底栏 / H5 详情页底栏 /
 * 帮助与反馈页），每处各写一遍必然出现"小程序跳了 H5 没跳"这种不一致。
 * 统一到 openCustomerService()，两端只传场景名。
 *
 * 两端能力差异（**这是事实，不是选择**）：
 *   小程序：wx.openCustomerServiceChat({ extInfo:{url}, corpId }) —— 唤起微信原生客服会话
 *   H5    ：该 API 不存在。只能整页跳转到客服链接（用户离开本站，在微信/浏览器里打开）
 *          → 这是**降级路径**不是等价路径，所以有"即将跳转"提示
 *
 * 降级链路（D先生 2026-10-05 拍板：未配置/调用失败都要给出路，不能点了没反应）：
 *   未开通        → toast「客服暂未开通」（H5 且有商家地址时给地址兜底）
 *   小程序调用失败 → 复制客服链接 + 提示"在微信中打开"
 *   H5           → 始终整页跳转
 */
import { request } from './request';
import { SITE_CODE } from '../core/bootstrap';

/** H5 端没有 openCustomerServiceChat，用运行时 API 存在性判定（比编译宏更保险） */
const IS_H5 = typeof window !== 'undefined' && typeof document !== 'undefined' && !uni.openCustomerServiceChat;

const TTL = 5 * 60 * 1000;   // 配置 5 分钟内复用，避免每次点客服都发请求
let cache = null;             // { at, data }
let inflight = null;          // 在途去重：连点两次不该发两次请求

function fetchKf(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL) return Promise.resolve(cache.data);
  if (inflight) return inflight;

  inflight = request(`/api/site/kf?code=${encodeURIComponent(SITE_CODE)}`, { timeout: 8000 })
    .then((d) => {
      cache = { at: Date.now(), data: d || {} };
      return cache.data;
    })
    .catch(() => {
      // 拿不到配置 ≠ 中断：降级成"未开通"，端上给明确提示而不是无反应
      cache = { at: Date.now(), data: { enabled: false, corp_id: null, kf_url: null, shop_addr: null } };
      return cache.data;
    })
    .finally(() => { inflight = null; });

  return inflight;
}

function copyAndHint(url) {
  uni.setClipboardData({
    data: url,
    success: () => uni.showToast({ title: '客服链接已复制，请在微信中打开', icon: 'none', duration: 2600 }),
    fail: () => uni.showToast({ title: '复制失败，请稍后重试', icon: 'none' }),
  });
}

/**
 * 打开客服（小程序 / H5 通用）
 * @returns {Promise<'opened'|'copied'|'unavailable'>} 实际动作，供调用方埋点
 */
export async function openCustomerService() {
  const d = await fetchKf();
  const url = d?.kf_url || '';

  // 未开通：明确告知，不静默
  if (!d?.enabled || !url) {
    if (IS_H5 && d?.shop_addr) {
      uni.showModal({ title: '联系客服', content: `客服暂未开通。商家地址：${d.shop_addr}`, showCancel: false });
      return 'unavailable';
    }
    uni.showToast({ title: '客服暂未开通', icon: 'none' });
    return 'unavailable';
  }

  // ── H5：整页跳转（唯一可用路径）──
  if (IS_H5) {
    uni.showToast({ title: '即将跳转客服会话…', icon: 'none' });
    // 延后跳转，让 toast 先渲染（否则同帧跳转 toast 看不到）
    setTimeout(() => { window.location.href = url; }, 120);
    return 'opened';
  }

  // ── 小程序：唤起微信原生客服会话 ──
  return new Promise((resolve) => {
    uni.openCustomerServiceChat({
      extInfo: { url },
      corpId: d.corp_id,
      showMessageCard: false,
      success: () => resolve('opened'),
      fail: (err) => {
        // 失败常见原因：基础库 < 2.19.0 / 公众平台未绑定企业ID / 客服链接已失效
        const msg = String((err && err.errMsg) ?? '');
        if (/cancel/i.test(msg)) { resolve('unavailable'); return; }
        copyAndHint(url);   // 非主动取消 → 给用户一条可走的路
        resolve('copied');
      },
    });
  });
}

/** 预取（进详情页时静默拉一次，点客服零等待） */
export function prefetchKf() {
  return fetchKf().catch(() => null);
}

/** 客服是否已开通（用于按需隐藏入口） */
export async function isKfEnabled() {
  const d = await fetchKf();
  return Boolean(d && d.enabled);
}
