/**
 * 后台请求封装（决策 #37 抽公共，供顶栏/账户页复用）
 * 各页面原有的局部 api() 保持不动，此处只服务新增的顶栏三态与账户设置。
 */

/** 当前会话锁定的站点（决策#27 选站后写入 localStorage） */
export function currentSite() {
  try { return JSON.parse(localStorage.getItem('fyt_admin_site') ?? 'null'); } catch { return null; }
}

/**
 * ⛔ 会话站点只存在前端 localStorage，服务端从 JWT 只拿得到 siteIds（授权列表），
 *    拿不到「当前进的是哪一站」。白名单 middleware 必须知道当前站才能判「未开通拦截」，
 *    故由前端显式带 `X-Fyt-Site` 头。
 *    这**不是新的信任面**：该头只用于「这个站通没通」的业务判定，
 *    站点访问权限仍由服务端 assertSiteAccess 按 JWT.siteIds 强制（改头越权无效）。
 *
 * ⛔⛔ 2026-10-05 修：站点头**只由 main.js 全局 fetch 包装统一写入**（单一写入点）。
 *    本函数曾在这里再写一次 'X-Fyt-Site'（大写），与全局包装的小写 'x-fyt-site'
 *    在 JS 对象里是**两个不同的键**，fetch 的 Headers 会合并成 "code, code"，
 *    服务端拿脏串查库 → 已保存凭据的站照样 403 SITE_NOT_PROVISIONED
 *    （D先生 实测：xincao 保存测试 passed 后看板仍 403，错误消息里「xincao, xincao」直接暴露）。
 */
export async function adminApi(path, opts = {}) {
  const r = await fetch('/api' + path, {
    // ⛔ 2026-10-05：后台 API 一律绕过 HTTP 缓存。Express 响应带 ETag/Last-Modified 却没有
    //    Cache-Control，浏览器启发式缓存会把保存前的旧 GET 吐回来（保存成功但页面看着没变）。
    cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token'),
      'Content-Type': 'application/json',
    },
    ...opts,
  });
  let j = null;
  try { j = await r.json(); } catch { /* 非 JSON 响应 */ }
  if (!j?.ok) throw new Error(j?.message || `请求失败（HTTP ${r.status}）`);
  return j.data;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期 */
export function relTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '—';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
