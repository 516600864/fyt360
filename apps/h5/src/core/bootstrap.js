// C 端身份（H5）：从旧 H5 空壳逐行平移，不改语义（铁律：OAuth 回归风险最低化）
// - snsapi_base 静默授权拿 code → /api/auth/hlogin → token 存 localStorage
// - 静默被拒自动降级 snsapi_userinfo 显式授权（每会话一次）
// - 失败不阻断浏览：降级匿名可浏览/转链，仅无推广位归因
// - fyt_oauth_skip 防死循环；非微信环境跳过
import { API_BASE, SITE_CODE, setToken, request } from '../utils/request';

const TOKEN_KEY = 'fyt_token_' + SITE_CODE;

function getToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch (e) {
    return '';
  }
}

function stripOAuthParams() {
  const u = new URL(location.href);
  u.searchParams.delete('code');
  u.searchParams.delete('state');
  history.replaceState(null, '', u.toString());
}

// 发起 OAuth：scope=snsapi_base 静默 / snsapi_userinfo 显式弹窗；取站点公众号 appid → 跳 authorize
function startOAuth(scope, invite) {
  return fetch(API_BASE + '/api/auth/mpconfig?site=' + encodeURIComponent(SITE_CODE))
    .then(function (r) {
      return r.json();
    })
    .then(function (body) {
      if (!body.ok || !body.data.appid) throw new Error(body.message || '站点未配置公众号');
      // hash 路由下 pathname 恒为 /h5/，code/state 落在 search，回跳后页面照常加载
      // 邀请码须随 redirect_uri 保留（微信回跳原样带回），否则授权一轮后 invite 丢失
      const redirectUri =
        location.origin + location.pathname + (invite ? '?invite=' + encodeURIComponent(invite) : '');
      const authUrl =
        'https://open.weixin.qq.com/connect/oauth2/authorize' +
        '?appid=' + encodeURIComponent(body.data.appid) +
        '&redirect_uri=' + encodeURIComponent(redirectUri) +
        '&response_type=code&scope=' + scope + '&state=fyt#wechat_redirect';
      location.replace(authUrl);
      return new Promise(function () {}); // 已跳走，挂起后续渲染
    })
    .catch(function () {
      try {
        sessionStorage.setItem('fyt_oauth_skip', '1');
      } catch (e) {}
    });
}

async function bootAuth() {
  const qs = new URLSearchParams(location.search);
  const oauthCode = qs.get('code');
  const state = qs.get('state');

  // 已有 token：直接用；带邀请码则补绑（老用户点分享链接，bindInviter 幂等）
  if (getToken()) {
    stripOAuthParams();
    if (invite) {
      request('/api/me/bind-invite', { method: 'POST', data: { invite } })
        .then(function () {
          try { sessionStorage.removeItem('fyt_invite'); } catch (e) {}
        })
        .catch(function () {});
    }
    return;
  }

  const invite = qs.get('invite') || '';
  if (invite) {
    try { sessionStorage.setItem('fyt_invite', invite); } catch (e) {}
  }

  // OAuth 回跳：code 换 token（失败不阻断浏览，降级匿名，跳过本次会话重试防死循环）
  if (oauthCode && state === 'fyt') {
    stripOAuthParams();
    try {
      const r = await fetch(API_BASE + '/api/auth/hlogin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: SITE_CODE, code: oauthCode, invite: invite || sessionStorage.getItem('fyt_invite') || '' }),
      });
      const body = await r.json();
      if (body.ok && body.data.token) setToken(body.data.token);
      else throw new Error(body.message || '授权失败');
      return;
    } catch (e) {
      try {
        sessionStorage.setItem('fyt_oauth_skip', '1');
      } catch (e2) {}
      return;
    }
  }

  // 微信授权失败回跳：降级显式授权一次（snsapi_userinfo 弹窗）
  if (!oauthCode && state === 'fyt' && (qs.get('error') || qs.get('error_code'))) {
    let explicit = null;
    try {
      explicit = sessionStorage.getItem('fyt_oauth_explicit');
    } catch (e) {}
    if (explicit) {
      stripOAuthParams();
      return;
    }
    stripOAuthParams();
    try {
      sessionStorage.setItem('fyt_oauth_explicit', '1');
    } catch (e) {}
    await startOAuth('snsapi_userinfo', invite || sessionStorage.getItem('fyt_invite') || '');
    return;
  }

  // 无 token 无回跳：非微信环境跳过（防御）；本会话已失败过跳过（防死循环）
  if (!/MicroMessenger/i.test(navigator.userAgent)) return;
  try {
    if (sessionStorage.getItem('fyt_oauth_skip')) return;
  } catch (e) {}
  // 发起静默授权（被拒时由降级分支接手）
  await startOAuth('snsapi_base', invite || sessionStorage.getItem('fyt_invite') || '');
}

// 单例：bootAuth 全程只跑一次，页面 await 之（OAuth 跳走时 promise 挂起，回跳后重新走完）
let bootPromise = null;
export function ensureBoot() {
  if (!bootPromise) bootPromise = bootAuth();
  return bootPromise;
}

export async function loadSiteConfig() {
  return request(`/api/site/config?code=${SITE_CODE}`);
}
