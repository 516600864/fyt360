// haojingke（蚂蚁星球）开放 API SDK
// 网关：api-gw.haojingke.com，鉴权 = apikey 查询参数（免费开放 API，无签名，实测 2026-09-21）
// 设计约束（M2 方案 §0）：商品不入库，只做实时拉取；限频 + 超时 + 重试保护上游
import { createHash } from 'node:crypto';
import { HttpError } from '../middleware/errors.js';

const GATEWAY = 'http://api-gw.haojingke.com/index.php';
/** recharge 系列官方文档给的是 https 端点 */
export const GATEWAY_HTTPS = 'https://api-gw.haojingke.com/index.php';
const TIMEOUT_MS = 12_000;
const RETRIES = 2; // 仅对网络错误/5xx 重试
const MIN_INTERVAL_MS = 120; // 同 apikey 请求最小间隔（上游未公布 QPS，保守限频）

// ---------------------------------------------------------------------------
// md5 签名（蚂蚁星球 open API / recharge API，2026-10-03 按官方文档实现）
//
// 算法（官方原文）：
//   1. 非空参数值按参数名 ASCII 升序排序，拼成 k1=v1&k2=v2…（空值不参与）
//   2. 在 strparam 前后拼接 secret 包裹串 → md5 → 转小写
//
// ⚠️ 两套包裹前缀并存，别混用（实测 movieorder / recharge 各用一套）：
//   · dcorder / movieorder（/v2/api/open/*）：前后拼 `secret=<secret>`
//     例：secret=S&goods_id=1&rechargeno=X&uid=Y&secret=S
//     → apikey **不参与**签名
//   · recharge/orderlist（/v2/api/recharge/*）：前后拼 `apikey=<apikey>&secret=<secret>`
//     例：apikey=K&secret=S&page=1&…&apikey=K&secret=S
//     → **apikey 要参与**（拼在包裹串里，不是业务参数）
// ---------------------------------------------------------------------------

/** open 系列（dcorder/movieorder）的签名包裹前缀 */
export function md5Sign(params: Record<string, string | number | undefined>, secret: string): string {
  return md5Wrap(params, `secret=${secret}`, `secret=${secret}`);
}

/** recharge 系列的签名包裹前缀（含 apikey） */
export function md5SignWithApikey(
  params: Record<string, string | number | undefined>,
  apikey: string,
  secret: string
): string {
  const wrap = `apikey=${apikey}&secret=${secret}`;
  return md5Wrap(params, wrap, wrap);
}

/** 通用：按官方算法生成 sign（参与签名的参数 = 非空的 params）
 *
 *  ⚠️ 分隔符铁律（照官方示例反推，2026-10-03）：包裹串与 strparam 之间**必须**有 `&`。
 *  官方示例原文串 = `secret=myxqsecret&goods_id=1&...&uid=13915969891&secret=myxqsecret`
 *  即 prefix + '&' + strparam + '&' + suffix；漏掉任一 `&` 得到的 hash 与官方不符 → 上游报「签名错误」。
 */
function md5Wrap(
  params: Record<string, string | number | undefined>,
  prefix: string,
  suffix: string
): string {
  const strparam = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // ASCII 升序（字典序）
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const strsign = `${prefix}&${strparam}&${suffix}`;
  return createHash('md5').update(strsign, 'utf8').digest('hex').toLowerCase();
}

/**
 * 校验用：对一组固定参数核对官方示例签名。
 * apikey=myxqapikey&uid=13915969891&goods_id=1&rechargeno=13915969891
 * → secret=myxqsecret&goods_id=1&rechargeno=13915969891&uid=13915969891&secret=myxqsecret
 * → f8677d7b3c86038436855b8484413c22
 */
export function selfTestMd5Sign(): boolean {
  const got = md5Sign(
    { uid: '13915969891', goods_id: '1', rechargeno: '13915969891' },
    'myxqsecret'
  );
  return got === 'f8677d7b3c86038436855b8484413c22';
}

/** 每 apikey 串行队列 + 最小间隔，防止突发打爆上游 */
const lastStart = new Map<string, number>();
let chain: Promise<void> = Promise.resolve();

async function rateLimitSlot(apikey: string): Promise<void> {
  const run = chain.then(async () => {
    const last = lastStart.get(apikey) ?? 0;
    const wait = MIN_INTERVAL_MS - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastStart.set(apikey, Date.now());
  });
  // 队列容错：前一个失败不阻塞后续
  chain = run.catch(() => {});
  await run;
}

export interface HjkCallResult {
  /** 上游原始 JSON（平台间结构有差异，由路由层归一化） */
  payload: Record<string, unknown>;
}

/**
 * 调用开放 API。path 形如 'jd/goodslist'；params 为业务参数（apikey 由本函数注入）。
 * version：'v1'=电商 CPS（默认），'v2'=蚂蚁自有业务（点餐/影票/充值/活动/周边，实测无需 sign，文档失真）。
 * opts.sign：显式传入签名串（签名类接口：dcorder/movieorder/recharge），透传为 sign 查询参数；
 *           不传则上游按无签名处理（pforder/平台活动实测免签）。
 * opts.baseUrl：recharge 系列走 https + 非默认前缀（/index.php/v2/api/recharge/...），可覆盖网关。
 * 失败抛 HttpError：502=上游错误，504=超时。
 */
export async function hjkCall(
  path: string,
  params: Record<string, string | number | undefined>,
  apikey: string,
  version: 'v1' | 'v2' = 'v1',
  opts?: { sign?: string; baseUrl?: string; method?: 'GET' | 'POST' }
): Promise<HjkCallResult> {
  const qs = new URLSearchParams({ apikey });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  if (opts?.sign) qs.set('sign', opts.sign);
  const base = opts?.baseUrl ?? GATEWAY;
  // recharge/orderlist 官方文档标注 POST（Query 参数承载业务参数，body 为 form 空对象）
  const method = opts?.method ?? 'GET';
  const url = `${base}/${version}/api/${path}?${qs.toString()}`;

  await rateLimitSlot(apikey);

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * 2 ** (attempt - 1)));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
      });
      const text = await res.text();
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new HttpError(502, `UPSTREAM_BAD_JSON`, `供应商返回非 JSON（HTTP ${res.status}）`);
      }
      if (!res.ok) {
        const msg = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
        // 4xx 语义性失败不重试；5xx 重试
        if (res.status < 500) throw new HttpError(502, 'UPSTREAM_REJECTED', msg);
        lastErr = new HttpError(502, 'UPSTREAM_ERROR', msg);
        continue;
      }
      // 部分平台在 HTTP 200 内带业务错误码（jd 转链失败用负数如 -200）
      const code = body.status_code ?? body.code;
      if (typeof code === 'number' && (code >= 400 || code < 0)) {
        throw new HttpError(502, 'UPSTREAM_BUSINESS', String(body.message ?? '上游业务错误'));
      }
      return { payload: body };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      lastErr = e instanceof Error ? e : new Error(String(e));
      // 网络错误/超时 → 重试
    } finally {
      clearTimeout(timer);
    }
  }
  throw new HttpError(504, 'UPSTREAM_TIMEOUT', `供应商接口超时：${lastErr?.message ?? 'unknown'}`);
}

// ---------------------------------------------------------------------------
// fasttype（积分权益目录）——带超时 + 内存缓存的统一取数
//
// 为什么单独封装（2026-10-03 修「搜京东卡死」）：
//   ① 原先三处调用点各自裸 fetch，**零超时零缓存**。上游偶发慢/挂时（实测冷启动 10.5s），
//      /service-search 整条链路被拖住，C 端 loading 遮罩永驻 = 用户看到「卡死」。
//      注意：hjkCall 有超时，但 fasttype 走的是裸 fetch 绕过了它。
//   ② fasttype 是全量静态目录（81 条 6 组，分钟级不变），每次搜索都拉一遍纯属浪费，
//      且并发搜索会并发打上游。→ 进程内缓存 TTL 5min + 同 key 在途请求去重。
//   ③ 超时设 8s：低于 hjkCall 的 12s，权益是「锦上添花」域，宁可返回空也不能拖死搜索。
// ---------------------------------------------------------------------------

const FASTTYPE_TTL_MS = 5 * 60_000;
const FASTTYPE_TIMEOUT_MS = 8_000;
/** fasttype 目录最小条目数：低于此值判定为「上游残缺响应」，不写缓存。
 *  实测完整目录 81 条（6 组），残缺时曾返回 47 条。20 为宽松阈值，只拦整组消失的情况。 */
const FASTTYPE_MIN_ITEMS = 20;

interface FasttypeCacheEntry {
  at: number;
  data: Array<Record<string, unknown>>;
}
/** key = `${apikey}|${uid}`，命中直接复用 */
const fasttypeCache = new Map<string, FasttypeCacheEntry>();
/** key = 同上，value = 在途 Promise，用于并发去重（防 N 个搜索同时打上游） */
const fasttypeInflight = new Map<string, Promise<Array<Record<string, unknown>>>>();

export interface FasttypeResult {
  ok: boolean;
  data: Array<Record<string, unknown>>;
  message?: string;
  /** true=本次命中缓存/在途复用（用于日志与调试） */
  cached?: boolean;
}

/**
 * 取fasttype 权益目录原始条目。失败返回 ok=false 而非抛异常——调用方按需降级为空数组。
 * @param apikey 站点级蚂蚁 key（跟 site_id 走，铁律）
 * @param uid 上游按 uid 缓存；固定 '1'（真实 uid 会打穿缓存拖慢响应）
 * @param force true 时绕过缓存（后台编辑等需要最新数据的场景）
 */
export async function fetchFasttype(apikey: string, uid = '1', force = false): Promise<FasttypeResult> {
  if (!apikey) return { ok: false, data: [], message: '未配置供应商 apikey' };
  const key = `${apikey}|${uid}`;

  if (!force) {
    const hit = fasttypeCache.get(key);
    if (hit && Date.now() - hit.at < FASTTYPE_TTL_MS) return { ok: true, data: hit.data, cached: true };
    const running = fasttypeInflight.get(key);
    if (running) {
      try {
        return { ok: true, data: await running, cached: true };
      } catch {
        return { ok: false, data: [], message: '上游异常' };
      }
    }
  }

  const task = (async (): Promise<Array<Record<string, unknown>>> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FASTTYPE_TIMEOUT_MS);
    try {
      const r = await fetch(
        `https://api-gw.haojingke.com/index.php/v2/api/points/fasttype?apikey=${encodeURIComponent(apikey)}&uid=${encodeURIComponent(uid)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctrl.signal },
      );
      const j = (await r.json().catch(() => null)) as
        | { status_code?: number; message?: string; data?: Array<Record<string, unknown>> }
        | null;
      if (!j || !Array.isArray(j.data)) throw new Error(j?.message ?? '响应异常');
      // ⚠️ 完整度校验（2026-10-03 实测踩过）：上游**会瞬时返回残缺目录**
      //   （实测同一 apikey 连续请求出现 47 条 vs 完整 81 条，肯德基等条目整组消失）。
      //   旧逻辑只判 Array.isArray 就写缓存 → 残缺响应被当成功缓存 5 分钟，
      //   叠加 /service-search 的 60s 结果级缓存后，「搜肯德基」最长 5 分钟查不到权益，
      //   表现为 E2E A2/A3 突然失败，但上游直连又完全正常 —— 极难定位。
      //   处置：条目数明显偏少时**不写缓存**并按失败降级（返回空权益），
      //   让下一次请求重新拉完整目录。阈值 20 条：完整目录 81 条，残缺 47 条，
      //   20 足够宽松（正常波动不会低于此），又能拦住整组消失的残缺响应。
      if (j.data.length < FASTTYPE_MIN_ITEMS) {
        throw new Error(`上游目录残缺（${j.data.length} 条，疑似瞬时不全响应），本次不写缓存`);
      }
      // 仅成功且完整才写缓存；失败/残缺不污染下次
      fasttypeCache.set(key, { at: Date.now(), data: j.data });
      return j.data;
    } finally {
      clearTimeout(timer);
      fasttypeInflight.delete(key);
    }
  })();

  fasttypeInflight.set(key, task);
  try {
    return { ok: true, data: await task };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === 'AbortError' ? `上游超时（>${FASTTYPE_TIMEOUT_MS / 1000}s）` : e.message) : String(e);
    return { ok: false, data: [], message: msg };
  }
}

// ---------------------------------------------------------------------------
// 四平台商品归一化（C 端只消费统一字段；jd/tb/pdd 网关已做字段对齐，vip 防御式映射）
// ---------------------------------------------------------------------------
export interface NormGoods {
  id: string;
  title: string;
  shortTitle: string;
  /** 原价 */
  price: number | null;
  /** 券后价 */
  finalPrice: number | null;
  /** 券金额 */
  coupon: number | null;
  pic: string;
  sales: number | null;
  shop: string;
  /** 原始条目（前端可按平台取扩展字段） */
  raw: Record<string, unknown>;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normalizeGoods(platform: string, item: Record<string, unknown>): NormGoods {
  // vip 响应为 camelCase，价格单位为元（字符串）
  if (platform === 'vip') {
    const store = item.storeInfo as Record<string, unknown> | null | undefined;
    return {
      id: String(item.goodsId ?? ''),
      title: String(item.goodsName ?? ''),
      shortTitle: String(item.goodsName ?? ''),
      price: num(item.marketPrice),
      finalPrice: num(item.vipPrice),
      // 唯品会无统一券字段（couponInfo 逐品存在），折扣 discount 是折扣率非券额，不误报
      coupon: null,
      pic: String(item.goodsThumbUrl ?? item.goodsMainPicture ?? ''),
      sales: num(item.productSales),
      shop: String((store?.storeName as string) ?? item.brandName ?? ''),
      raw: item,
    };
  }
  return {
    id: String(item.goods_id ?? ''),
    title: String(item.goods_name ?? ''),
    shortTitle: String(item.goods_short_name ?? item.goods_name ?? ''),
    price: num(item.price),
    finalPrice: num(item.price_after),
    coupon: num(item.discount),
    pic: String(item.picurl ?? ''),
    sales: num(item.sales),
    shop: String(item.shopname ?? ''),
    raw: item,
  };
}

/** 从平台响应中取出商品数组与翻页信息（各平台结构差异在此吸收）
 *  cursor：tb 游标分页的下一页凭据（min_id），其余平台为 null */
export function extractList(
  platform: string,
  payload: Record<string, unknown>,
  pagesize: number
): { items: Record<string, unknown>[]; hasMore: boolean; cursor: string | null } {
  const data = (payload.data ?? {}) as Record<string, unknown>;
  let items: Record<string, unknown>[] = [];
  let hasMore = false;
  let cursor: string | null = null;
  switch (platform) {
    case 'jd':
    case 'tb': {
      items = (data.data as Record<string, unknown>[] | undefined) ?? [];
      hasMore = items.length >= pagesize;
      if (platform === 'tb') {
        cursor = [data.min_id, data.tb_p, payload.min_id].find((v) => v !== undefined && v !== null && v !== '') != null
          ? String([data.min_id, data.tb_p, payload.min_id].find((v) => v !== undefined && v !== null && v !== ''))
          : null;
      }
      break;
    }
    case 'pdd': {
      items = (data.goods_list as Record<string, unknown>[] | undefined) ?? [];
      hasMore = items.length >= pagesize;
      break;
    }
    case 'vip': {
      items = (data.goodsInfoList as Record<string, unknown>[] | undefined) ?? [];
      // goodslist 返回 lastPage；goodsquery（关键词搜索端点）无 lastPage，按整页返回推断翻页
      hasMore = data.lastPage === undefined ? items.length >= pagesize : data.lastPage === false;
      break;
    }
    default:
      items = [];
  }
  return { items, hasMore, cursor };
}
