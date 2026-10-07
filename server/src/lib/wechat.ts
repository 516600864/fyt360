// 微信开放能力（M2.2：code2session；M2.2 补：公众号网页授权 oauth2；
// mini-29 补：小程序 stable_token 缓存 + msgSecCheck 内容安全，决策 #46/#47）
// appid/secret 跟 site_id 走 provider_config（wechat_mini / wechat_mp），不落 .env
import { HttpError } from '../middleware/errors.js';
import { pool } from '../db/client.js';

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

// ── mini-29 内容安全（决策 #46 §5：用户输入与 AI 输出双向 msgSecCheck）──────────

/** stable_token 进程内缓存：appid → { token, expiresAt }。提前 300s 失效防边界抖动 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * 小程序接口调用凭证（stable_token，client_credential），按 site_id 解析凭据。
 * link.ts /self/launch 是每请求现取（低频 URL Scheme 可接受）；对话每条消息两次审核，
 * 必须缓存 —— 7200s 有效期，进程内 Map 即可（单实例容器部署）。
 */
export async function getMiniAccessToken(siteId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT apikey, api_secret FROM provider_config
      WHERE site_id = $1::uuid AND provider = 'wechat_mini' AND status = 'active' LIMIT 1`,
    [siteId],
  );
  const appid = rows[0]?.apikey ?? '';
  const secret = rows[0]?.api_secret ?? '';
  if (!appid || !secret) throw new HttpError(503, '该站点小程序凭据未配置', 'PROVIDER_NOT_CONFIGURED');

  const hit = tokenCache.get(appid);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid, secret }),
      signal: ctrl.signal,
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; errmsg?: string };
    if (!body.access_token) {
      throw new HttpError(502, `获取小程序凭证失败：${body.errmsg ?? '响应异常'}`, 'WX_TOKEN_ERROR');
    }
    tokenCache.set(appid, { token: body.access_token, expiresAt: Date.now() + ((body.expires_in ?? 7200) - 300) * 1000 });
    return body.access_token;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, '小程序凭证接口超时', 'WX_TIMEOUT');
  } finally {
    clearTimeout(timer);
  }
}

export interface SecCheckResult {
  /** true=已过审核；false=命中风险；skipped=true 时未检查（凭据未配，放行 + 上层记审计） */
  pass: boolean;
  skipped?: boolean;
  /** 命中时的微信错误码（87014=内容违规） */
  errcode?: number;
}

/**
 * msgSecCheck v2：内容安全校验（scene: 2=评论 3=社交；openid 必填）。
 * ⛔ 凭据未配 → skipped 放行（开发站/纯 H5 站不该被 AI 对话整个卡死），由调用方记审计；
 *   凭据已配但微信侧报错 → 保守放行（false-block 会把正常对话全打死），记 errcode 供排查。
 */
export async function msgSecCheck(siteId: string, content: string, openid: string): Promise<SecCheckResult> {
  if (!content.trim()) return { pass: true };
  let token: string;
  try {
    token = await getMiniAccessToken(siteId);
  } catch (e) {
    if (e instanceof HttpError && e.code === 'PROVIDER_NOT_CONFIGURED') return { pass: true, skipped: true };
    throw e;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 2500), version: 2, scene: 3, openid }),
      signal: ctrl.signal,
    });
    const body = (await res.json()) as { errcode?: number; errmsg?: string; result?: { suggest?: string; label?: number } };
    // errcode 0 = 通过；87014 = 内容违规；其他错误码（token 过期等）保守放行
    if (body.errcode === 87014) return { pass: false, errcode: 87014 };
    return { pass: true, errcode: body.errcode && body.errcode !== 0 ? body.errcode : undefined };
  } catch {
    return { pass: true }; // 超时/网络抖动不拦对话，宁可放过不可错杀
  } finally {
    clearTimeout(timer);
  }
}
