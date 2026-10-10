import { request, setToken } from '../utils/request';

/**
 * 启动流程（M2.2）：
 * 微信登录（uni.login → code）→ POST /api/auth/clogin → 存 token（30d C 端 JWT）
 * 登录失败静默跳过（匿名态可浏览/转链，仅无推广位归因）
 * appid/站点 code 属构建期差异（sites/<site>/config.json），M2.2 默认 site-a
 */
export const SITE_CODE = 'site-a';

export async function bootstrap(_app) {
  // #ifdef MP-WEIXIN
  try {
    // 邀请码：分享卡 path 上的 ?invite=（冷启动场景；仅登录请求透传，绑定在服务端）
    let invite = '';
    try { invite = String(uni.getLaunchOptionsSync()?.query?.invite ?? ''); } catch (e) { /* 忽略 */ }
    if (!invite) {
      try { invite = String(uni.getStorageSync('fyt_invite') ?? ''); } catch (e) { /* 忽略 */ }
    }
    const loginRes = await uni.login({ provider: 'weixin' });
    // uni.login 兼容三种返回形态：{code} / [err, res] / 直接 res
    const code =
      loginRes?.code ?? (Array.isArray(loginRes) ? loginRes[1]?.code : undefined) ?? loginRes?.[1]?.code;
    if (!code) {
      console.warn('[bootstrap] uni.login 未返回 code，保持匿名');
      return;
    }
    const d = await request('/api/auth/clogin', { method: 'POST', data: { site: SITE_CODE, code, invite } });
    setToken(d.token);
    if (d.inviteCode) {
      // 自己的邀请码（2026-10-09）：main.js 全局 onShareAppMessage 分享 path 带 ?invite= 消费，
      // 被邀请人访问后上级=发起人（绑定走既有首页 bind-invite / 冷启 clogin 透传链路，服务端零改动）
      try { uni.setStorageSync('fyt_invite_code', d.inviteCode); } catch (e) { /* 存储失败仅分享不带码 */ }
    }
    console.log('[bootstrap] clogin ok, userId =', d.userId, d.isNew ? '(新用户)' : '');
  } catch (e) {
    console.warn('[bootstrap] C 端登录失败（匿名继续）', e?.message ?? e);
  }
  // #endif
}

export async function loadSiteConfig() {
  return request(`/api/site/config?code=${SITE_CODE}`);
}
