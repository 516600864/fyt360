// 请求封装：M1 空壳直连 API_BASE；多站点构建期由 sites/<site>/config.json 注入
// mk.fyt360.cn = 统一域名（HTTP 访问服务：/api 路由到云托管 fyt360-api，其余走静态托管）
// M2.2：自动携带 C 端登录 token（clogin 签发，30d），无 token 按匿名请求
export const API_BASE = 'https://mk.fyt360.cn';

const TOKEN_KEY = 'fyt_token';

/** 默认请求超时（ms）。uni.request 平台默认 60s，实测上游偶发挂死会让 loading 遮罩永驻（D先生 2026-10-03）。
 *  取 20s：足够覆盖蚂蚁/京东 CPS 实测 0.5~4s 的正常波动，又能保证异常时快速降级而非假死。
 *  单次可传 options.timeout 覆盖。 */
const DEFAULT_TIMEOUT = 20000;

export function getToken() {
  try {
    return uni.getStorageSync(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

export function setToken(token) {
  try {
    if (token) uni.setStorageSync(TOKEN_KEY, token);
    else uni.removeStorageSync(TOKEN_KEY);
  } catch (e) {
    // storage 异常不阻塞主流程
  }
}

export function request(path, options = {}) {
  const token = getToken();
  const header = options.header ?? {};
  if (token) header.Authorization = 'Bearer ' + token;
  return new Promise((resolve, reject) => {
    uni.request({
      url: API_BASE + path,
      method: options.method ?? 'GET',
      data: options.data ?? {},
      header,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data?.ok) {
          resolve(res.data.data);
        } else {
          reject(new Error(res.data?.message ?? `HTTP ${res.statusCode}`));
        }
      },
      fail: (err) => {
        const msg = String(err?.errMsg ?? '');
        // 平台超时 errMsg 形如 "request:fail timeout" —— 给出可读文案，便于排查「卡死」
        reject(new Error(/timeout/i.test(msg) ? '请求超时，请重试' : msg || '网络错误'));
      },
    });
  });
}
