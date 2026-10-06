// 微信开放能力（M2.2：code2session；M2.2 补：公众号网页授权 oauth2）
// appid/secret 跟 site_id 走 provider_config（wechat_mini / wechat_mp），不落 .env
import { HttpError } from '../middleware/errors.js';

export interface WxSession {
  openid: string;
  unionid?: string;
  sessionKey?: string;
}

const TIMEOUT_MS = 8_000;

/** 小程序登录凭据校验：code → openid（错误归一 401，不透传微信原始错误） */
export async function code2Session(appid: string, secret: string, code: string): Promise<WxSession> {
  const url =
    'https://api.weixin.qq.com/sns/jscode2session?' +
    new URLSearchParams({ appid, secret, js_code: code, grant_type: 'authorization_code' });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = (await res.json()) as { errcode?: number; errmsg?: string; openid?: string; unionid?: string; session_key?: string };
    if (body.errcode && body.errcode !== 0) {
      // 40029=code 无效 45011=频控 40226=高风险用户 等
      throw new HttpError(401, 'WX_CODE_INVALID', `微信登录失败（${body.errcode}）：${body.errmsg ?? 'code 无效'}`);
    }
    if (!body.openid) {
      throw new HttpError(502, 'WX_BAD_RESPONSE', '微信登录响应缺少 openid');
    }
    return { openid: body.openid, unionid: body.unionid, sessionKey: body.session_key };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, 'WX_TIMEOUT', '微信登录接口超时');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 公众号网页授权（snsapi_base 静默）：OAuth code → openid。
 * 公众号绑定微信开放平台后响应含 unionid（D先生确认同开放平台，unionid 合并身份）。
 * 注意与 code2session 是两个不同接口（jscode2session vs oauth2/access_token）。
 */
export async function mpOAuth(appid: string, secret: string, code: string): Promise<WxSession> {
  const url =
    'https://api.weixin.qq.com/sns/oauth2/access_token?' +
    new URLSearchParams({ appid, secret, code, grant_type: 'authorization_code' });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = (await res.json()) as { errcode?: number; errmsg?: string; openid?: string; unionid?: string };
    if (body.errcode && body.errcode !== 0) {
      // 40029=code 无效 40163=code 已使用 42030=回调 state 无效 等
      throw new HttpError(401, 'WX_CODE_INVALID', `公众号授权失败（${body.errcode}）：${body.errmsg ?? 'code 无效'}`);
    }
    if (!body.openid) {
      throw new HttpError(502, 'WX_BAD_RESPONSE', '公众号授权响应缺少 openid');
    }
    return { openid: body.openid, unionid: body.unionid };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, 'WX_TIMEOUT', '公众号授权接口超时');
  } finally {
    clearTimeout(timer);
  }
}
