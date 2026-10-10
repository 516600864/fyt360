// 商品点击统一协议（画布 mini-03/16 流程：列表/商品流点击 → 商详页 → 领券购买 → 转链）
// - self：团购 SKU 详情页（pages/goods/self-detail，交易链）
// - CPS（jd/tb/pdd/vip）：CPS 商详页（pages/goods/detail，画布 mini-03）→ 页内「领券购买」触发转链
// 转链跳转矩阵（2026-09-22 D先生定稿）：
//   pdd 响应带 we_app_info{app_id, page_path} → navigateToMiniProgram（appId/path 均动态）
//   jd  官方小程序 wx91d27dbf599dff74 固定包装：/pages/union/proxy/proxy?spreadUrl=<转链短链>
//   vip 官方小程序 wxe9714e742209d35f：path 直接用上游 vipWxUrl（内页路径，与 appId 成对返回，不包装）
//   tb  返回淘口令 coupon_full_tpwd（微信生态无淘宝官方小程序）→ web-view 站内口令页（mini-04/决策#14）
import { request, API_BASE } from '../utils/request';
import { SITE_CODE } from './bootstrap';

// 平台官方小程序固定映射（jd/vip 由 D先生提供；pdd 动态appId 的两个候选也列入白名单）
// 注意：navigateToMiniProgram 的目标 appId 必须在 manifest.json 的
// navigateToMiniProgramAppIdList 中声明（上限 10 个），两处需同步维护
const MINI_APP = {
  jd: { appId: 'wx91d27dbf599dff74', buildPath: (url) => '/pages/union/proxy/proxy?spreadUrl=' + encodeURIComponent(url) + '&EA_PTAG=17078.27.206' },
  // vip：响应 urlInfoList[0] 里 vipWxUrl（官方小程序内页路径）与 appId 成对返回，直接作 path 跳，
  // 不套 special 包装（special?url= 是装 H5 专题链接的容器页，套内页路径打不开）
  vip: { appId: 'wxe9714e742209d35f' },
};

function copyText(text, tip) {
  uni.setClipboardData({
    data: text,
    success: () => uni.showToast({ title: tip, icon: 'none', duration: 2500 }),
    fail: () => uni.showToast({ title: '复制失败，请重试', icon: 'none' }),
  });
}

// 小程序运行时无 URLSearchParams，手拼 query（值简单，无需深度转义；goods_sign 含 _ 安全）
function buildQuery(platform, g) {
  const parts = ['site=' + encodeURIComponent(SITE_CODE)];
  if (platform === 'jd' || platform === 'vip') parts.push('goods_id=' + encodeURIComponent(g.id));
  if (platform === 'tb') {
    parts.push('item_id=' + encodeURIComponent(g.id));
    parts.push('title=' + encodeURIComponent(g.title || 'FYT360 精选好物'));
  }
  if (platform === 'pdd') parts.push('goods_sign=' + encodeURIComponent(g.raw?.goods_sign ?? g.sign ?? ''));
  return parts.join('&');
}

/** 商详页离线载荷：storage 缓存（商详冷启/分享进入时兜底由 detail 端点回源） */
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

/** 列表/商品流点击 → 商详页（画布 mini-03 CPS / mini-16 团购） */
export function onGoodsTap(g) {
  if (!g || !g.id) return;
  const platform = g.platform;
  if (!platform) return;
  if (platform === 'self') {
    // 团购：进团购 SKU 详情页（交易链，画布 mini-16）
    uni.navigateTo({ url: `/pkg-goods/pages/goods/self-detail?id=${g.raw?.goods_id ?? g.id}` });
    return;
  }
  cacheGoods(platform, g);
  uni.navigateTo({ url: `/pkg-goods/pages/goods/detail?platform=${platform}&id=${encodeURIComponent(g.id)}` });
}

/**
 * parse_card 主卡直跳（2026-10-09 D先生 定稿）：转链结果已带官方小程序信息，直接跳转，不二次转链。
 * - tb：微信生态无淘宝官方小程序 → 返回 false（调用方保持「复制口令」）
 * - jd/pdd/vip/美团：appId+path 齐（unionToCard 归一化字段）→ navigateToMiniProgram，失败兜底复制链接
 * - 信息不全（异常响应/旧历史卡）→ 返回 false，调用方自行降级
 * 注意：目标 appId 必须在 manifest.json navigateToMiniProgramAppIdList 内（美团 wxde8ac0a21135c07d 等已声明）。
 * @returns {boolean} 是否已发起小程序跳转
 */
export function jumpConverted(link) {
  if (!link || link.platform === 'tb') return false;
  const appId = link.miniAppId || '';
  // vip：官方小程序内页路径优先（urlInfoList[0].vipWxUrl，与 goUnion 同构），退化用 we_app_info.path
  const path = (link.platform === 'vip' && link.vipWxUrl) ? link.vipWxUrl : (link.miniPath || '');
  if (!appId || !path) return false;
  uni.navigateToMiniProgram({
    appId,
    path,
    fail: () => copyText(link.url || link.tkl || '', '链接已复制，请在浏览器打开'),
  });
  return true;
}

/** 转链跳转（商详「领券购买」/ 旧直跳入口共用）：union → 按平台跳官方小程序 / 口令页 / 复制兜底 */
export async function goUnion(g) {
  const platform = g.platform;
  if (!platform || platform === 'self') return;
  if (platform === 'pdd' && !(g.raw?.goods_sign ?? g.sign)) {
    uni.showToast({ title: '商品参数缺失，请重试', icon: 'none' });
    return;
  }
  uni.showLoading({ title: '跳转中…', mask: true });
  try {
    const d = await request(`/api/link/${platform}/union?${buildQuery(platform, g)}`);

    if (platform === 'tb') {
      // 淘宝：跳 web-view 站内口令页（画布 mini-04 / 决策#14）
      const tkl = d.tkl || '';
      if (!tkl) throw new Error('淘口令获取失败，请重试');
      const price = g.price ?? g.pay_price ?? '';
      const rebate = price !== '' ? Math.floor(Number(price) * 100) : ''; // 决策#21：1元=100元宝
      const tklQs =
        'tkl=' + encodeURIComponent(tkl) +
        '&title=' + encodeURIComponent(g.title || 'FYT360 精选好物') +
        '&price=' + encodeURIComponent(price) +
        '&rebate=' + encodeURIComponent(rebate);
      uni.navigateTo({
        url: '/pages/tkl/index?url=' + encodeURIComponent(API_BASE + '/tkl.html?' + tklQs),
        fail: () => copyText(tkl, '淘口令已复制，打开淘宝粘贴'), // 页面栈满等极端场景兜底
      });
      return;
    }

    if (platform === 'pdd' && d.miniAppId && d.miniPath) {
      // 拼多多：跳多多进宝官方小程序（appId/path 均来自上游响应，动态值）
      uni.navigateToMiniProgram({
        appId: d.miniAppId,
        path: d.miniPath,
        fail: () => copyText(d.url, '链接已复制，请在浏览器打开'),
      });
      return;
    }

    // jd / vip：官方小程序跳转（appId 静态映射；jd 包装 spreadUrl，vip 直接跳内页路径）
    const app = MINI_APP[platform];
    if (app && d.url) {
      const path =
        platform === 'vip' && d.vipWxUrl
          ? d.vipWxUrl
          : app.buildPath
            ? app.buildPath(d.url)
            : d.url;
      uni.navigateToMiniProgram({
        appId: app.appId,
        path,
        fail: () => copyText(d.url, '链接已复制，请在浏览器打开'),
      });
      return;
    }

    // 兜底：无小程序信息 → 复制链接
    copyText(d.url, '链接已复制，请在浏览器打开');
  } catch (e) {
    uni.showToast({ title: e?.message ?? '转链失败，请重试', icon: 'none' });
  } finally {
    uni.hideLoading();
  }
}
