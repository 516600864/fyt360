// CPS 转链跳转（H5）：商品卡点击 → /api/link/:platform/union → location.href 直跳
// 从旧 H5 空壳逐行平移（convertJump），tb 分支按决策#14/#26：跳站内 H5 口令页（根路径 /tkl.html）
// 其余平台（jd/vip/pdd）：H5 端直接跳联盟 H5 链接（d.url），无小程序跳转
import { request, API_BASE, SITE_CODE } from '../utils/request';

/** 商详页离线载荷：storage 缓存（商详冷启/分享进入时兜底由 detail 端点回源；键与 mini 一致） */
function cacheGoods(platform, g) {
  try {
    uni.setStorageSync(`fyt_gd_${platform}_${g.id}`, JSON.stringify({
      id: g.id,
      title: g.title,
      price: g.price,
      finalPrice: g.finalPrice,
      coupon: g.coupon,
      pic: g.pic,
      sales: g.sales,
      shop: g.shop,
      platform,
      sign: g.raw?.goods_sign ?? '',
    }));
  } catch (e) { /* 存储失败不阻塞，商详走端点回源 */ }
}

/**
 * 商品卡点击统一协议（与 mini core/link 对齐，2026-09-28 补齐）：
 * - self：H5 无交易链（决策：交易闭环在小程序）→ 引导去小程序
 * - CPS：先进商详页（pages/goods/detail，画布 mini-03 同稿）→ 页内「领券购买」触发 convertJump
 */
export function onGoodsTap(g, platform) {
  if (!g || !g.id) return;
  const p = platform ?? g.platform;
  if (!p || p === 'self') {
    // 自营：H5 无交易链（决策：交易闭环在小程序）→ 直接呼起小程序到对应商品页
    // （URL Scheme generateScheme，30min 有效；小程序提审发布前需 env=trial 且仅体验成员可开）
    const goodsId = g.raw?.goods_id ?? g.id;
    uni.showLoading({ title: '正在打开小程序…', mask: true });
    request(`/api/link/self/launch?goods_id=${encodeURIComponent(String(goodsId))}&site=${encodeURIComponent(SITE_CODE)}`)
      .then((d) => {
        uni.hideLoading();
        if (d?.openlink) {
          window.location.href = d.openlink;
          return;
        }
        throw new Error('呼起链接生成失败');
      })
      .catch((e) => {
        uni.hideLoading();
        uni.showToast({ title: e?.message ?? '请到「FYT360」小程序购买', icon: 'none', duration: 2500 });
      });
    return;
  }
  cacheGoods(p, g);
  uni.navigateTo({ url: `/pages/goods/detail?platform=${p}&id=${encodeURIComponent(g.id)}` });
}

function buildQuery(platform, g) {
  const parts = ['site=' + encodeURIComponent(SITE_CODE)];
  if (platform === 'jd' || platform === 'vip') parts.push('goods_id=' + encodeURIComponent(g.id));
  if (platform === 'tb') {
    parts.push('item_id=' + encodeURIComponent(g.id));
    parts.push('title=' + encodeURIComponent(g.title || 'FYT360 精选好物'));
  }
  if (platform === 'pdd') parts.push('goods_sign=' + encodeURIComponent(g.raw?.goods_sign ?? ''));
  return parts.join('&');
}

export async function convertJump(g, platform) {
  if (!g || !g.id) return;
  if (!platform || platform === 'self') {
    // H5 端无自营交易链（决策：交易闭环在小程序）；引导去小程序
    uni.showToast({ title: '到店团购商品请到「FYT360」小程序购买', icon: 'none', duration: 2500 });
    return;
  }
  uni.showLoading({ title: '跳转中…', mask: true });
  try {
    const d = await request(`/api/link/${platform}/union?${buildQuery(platform, g)}`);
    if (!d?.url && platform !== 'tb') throw new Error('转链失败，请重试');

    // tb：跳站内 H5 口令页（画布 h5-45 / 决策#14，根路径 URL 全仓统一）
    if (platform === 'tb') {
      const tkl = d.tkl || '';
      if (!tkl) throw new Error('淘口令获取失败，请重试');
      const price = g.price ?? g.pay_price ?? '';
      const rebate = price !== '' ? Math.floor(Number(price) * 100) : ''; // 决策#21：1元=100元宝
      const tklQs =
        'tkl=' + encodeURIComponent(tkl) +
        '&title=' + encodeURIComponent(g.title || 'FYT360 精选好物') +
        '&price=' + encodeURIComponent(price) +
        '&rebate=' + encodeURIComponent(rebate);
      window.location.href = API_BASE + '/tkl.html?' + tklQs;
      return;
    }

    window.location.href = d.url;
  } catch (e) {
    uni.showToast({ title: e?.message ?? '转链失败，请重试', icon: 'none' });
  } finally {
    uni.hideLoading();
  }
}
