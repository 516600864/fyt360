// 订单同步与结算（M2.3）：唯一落库面=订单（商品不入库铁律）
// 拉取：四平台 CPS（jd getorderrow / tb getorder / pdd getorder / vip getorder，v1 网关）
//      + 蚂蚁自有 4 类（v2 网关，2026-10-03 按官方接口清单逐个实测校准）：
//        pforder（平台活动，免签）· dcorder（点餐，签名）· movieorder（影票，签名）· recharge/orderlist（权益兑换，签名+https+POST）
// 入库：order_sn = `${provider}:${平台单号}:${行键}` 幂等 upsert，三维状态机 only-forward
// 结算：platform_status='settled' 且 rebate_at IS NULL → 事务内 元宝返还（1元=100元宝，决策#21）+ 佣金三跳分配
// 冲销：refund_status='refunded' 且已结算且 chargeback_at IS NULL → 扣回元宝/佣金
//
// ⛔ 同步起点铁律（D先生 2026-10-04）：只同步 2026-09-20 之后，见 SYNC_SINCE 常量。
// ⚠️ 归属口径（重要，勿再误判）：**apikey 是站点级资产，归属只看 site_id**。
//    绝大多数单promoter 不是本站 user（实测 2000 条仅 1 条），那是正常的——
//    推广位可能是别人的，但仍属本站收益。promoter_id 只作蚂蚁侧归因**线索**留档。
//    有受益人（命中 user 表）才发元宝 + 佣金三跳；无主单照样标记 rebate_at 保证幂等去重。
// 归因字段：jd positionId / pdd custom_parameters.uid / vip channelTag / tb extend_id /
//      蚂蚁：pforder 用 extend_id、dc/movie/recharge 用 uid（=user_id，均跟插件登记一致）
//      positionId=1 / uid=1（站点默认位，M2.2 匿名兜底）不归因
import { pool } from '../db/client.js';
import { hjkCall, md5Sign, md5SignWithApikey } from '../lib/haojingke.js';
import { resolveHjkConfig } from '../lib/provider.js';
import { GATEWAY_HTTPS } from '../lib/haojingke.js';
import { INGOT_PER_YUAN, PROVIDER_CPS } from '../lib/constants.js';

/**
 * 翻页上限（防死循环）。40 页 × limit 100 = 4000 行/次。
 * ⚠️ 不能用 20：pf 窗口 72h 实测 total≈2720 行（28 页）会被截断，
 * 截断意味着尾部订单永远拉不到 → 结算态刷不到。
 */
const MAX_PAGES = 40;

export interface PlatformStat {
  fetched: number;
  upserted: number;
  error?: string;
  /** 平台级跳过原因（如 SIGN_REQUIRED=签名算法待插件接入获取） */
  skipped?: string;
  /** pforder 专属：因 pf_type 让位 v1 联盟而丢弃的行数 */
  skippedByPfType?: number;
  /** 宽窗口按天分段的段数（>1 表示该平台走了分段拉，避免页数上限截断） */
  segments?: number;
}
export interface SyncStats {
  site: string;
  window: { start: string; end: string };
  platforms: Record<string, PlatformStat>;
  settled: number;
  chargedBack: number;
}

// ---------------- 时间工具 ----------------
const pad = (n: number) => String(n).padStart(2, '0');
/** 北京时间 'yyyy-MM-dd HH:mm:ss'（jd/tb 接口要求） */
function bjStr(d: Date): string {
  const t = new Date(d.getTime() + 8 * 3_600_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
}
/** 北京时间字符串 → Date */
function bjParse(s: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s.replace(' ', 'T') + '+08:00');
  return Number.isNaN(d.getTime()) ? undefined : d;
}
const toDate = (v: unknown): Date | undefined => {
  if (v == null || v === '' || v === 0) return undefined;
  const n = Number(v);
  const d = Number.isFinite(n) && n > 1e9 ? new Date(n * (n < 1e12 ? 1000 : 1)) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------------- 归一化订单行 ----------------
interface NormOrder {
  provider: string; // jd / tb / pdd / vip / pf / near / dc / recharge / movie
  orderSn: string;
  rowKey?: string;
  /** created / paid / settled / closed */
  st: 'created' | 'paid' | 'settled' | 'closed';
  refunded: boolean;
  payPrice: number; // 元
  commission: number; // 元（平台实际到手收益基数）
  promoter?: number; // 归因 user_id（原始 extend_id/uid 解析值，仅线索，非归属判据）
  title: string;
  pic?: string;
  orderTime?: Date;
  settledTime?: Date;
  /** pf_type 原值（pforder），冗余留档便于回溯 */
  pfType?: number;
  /** 蚂蚁侧原始归因串（extend_id/uid 原文，含「渠道号_子单号」复合形态），仅留档 */
  attrRaw?: string;
  /**
   * 上游**最近一次状态更新时间**（D先生 2026-10-04追加要求列）。
   *
   * ⛔ 这是同步窗口的**唯一正确游标**：pforder querytype=2 按 updated_at 筛，
   * 而 ordertime（下单）可能早 12~31 天（实测结算滞后 p50=295h、max=760h）。
   * 用 paid_at 判窗口 = 结构性漏单（单子一旦下单超窗口且状态不再变，就永远拉不到）。
   */
  platformUpdatedAt?: Date;
  /** 一级业务分类（电商/本地生活/点餐/影票/充值） */
  bizCategory?: string;
  /** 二级渠道中文名（京东/美团/饿了么…） */
  bizChannel?: string;
}

/** provider 桶 → 一级业务分类（问 2：订单类型不能只写「CPS 供应链」） */
const PROVIDER_BIZ_CATEGORY: Record<string, string> = {
  self: 'self',
  jd: 'ecommerce',
  pdd: 'ecommerce',
  tb: 'ecommerce',
  vip: 'ecommerce',
  fzy: 'ecommerce',
  ks: 'ecommerce',
  meituan: 'local',
  local: 'local',
  didi: 'local',
  eleme: 'dining',
  dc: 'dining',
  movie: 'movie',
  recharge: 'recharge',
  liucard: 'recharge',
  other: 'other',
  pf: 'other',
};

/** provider 桶 → 二级渠道中文名 */
const PROVIDER_BIZ_CHANNEL: Record<string, string> = {
  self: '自营',
  jd: '京东',
  pdd: '拼多多',
  tb: '淘宝',
  vip: '唯品会',
  fzy: '飞猪',
  ks: '快手',
  meituan: '美团',
  local: '本地生活',
  didi: '滴滴',
  eleme: '饿了么',
  dc: '点餐',
  movie: '电影票',
  recharge: '权益充值',
  liucard: '流量卡',
  other: '其他',
  pf: '其他',
};

function bizCategoryOf(provider: string): string {
  return PROVIDER_BIZ_CATEGORY[provider] ?? 'other';
}
function bizChannelOf(provider: string): string {
  return PROVIDER_BIZ_CHANNEL[provider] ?? '其他';
}

/**
 * ⛔ 归因解析最终口径（D先生 2026-10-04 定调「apikey 是站点级资产，归属只看 site_id」）。
 *
 * **本函数只做类型清洗，绝不用于丢弃订单。**
 *
 * extend_id 实测形态（近 24h 共 1011 行统计，2026-10-04）：
 * |形态                    | 行数 | 含义                          |
 * |------------------------|------|-------------------------------|
 * |`121291_6259129`        | 800  | 上游渠道号_子单号（**非**我方 user_id）|
 * |`135123xcsaas6000817`   | 209  | 上游渠道号+csaas+子单号（同上）|
 * |`10`                    | 2    | 我方转链入口传的 user_id✅     |
 *
 * 即 **99.8% 的单不是从我们的转链接口进来的**（我方全站 user 仅 4 人：10/11/21/22），
 * 但 apikey 是站点级资产 → 这些钱照样属本站收益，**必须入库**。
 *
 * 曾经的 bug：旧 `toPromoter` 用 `Number.isInteger` 强判，复合形态→NaN→undefined，
 * 再被 `if (!promoter) continue` 丢弃 → 1011 行只剩 2 行入库（美团 pf16 66 行全灭）。
 * 现改为：**只有「纯数字且 >1」才当 user_id 线索，其余标记为无个人归因但照常入库**。
 */
function toPromoter(v: unknown): number | undefined {
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return undefined; // 复合形态（渠道号_子单号）→ 非我方 user_id
  const n = Number(s);
  return Number.isInteger(n) && n > 1 ? n : undefined; // 1/0 = 站点默认位
}
/** 原始归因串留档（复合形态也存快照，便于日后与蚂蚁侧对账/回溯） */
function attributionRaw(r: Record<string, unknown>): string {
  return String(r.extend_id ?? r.uid ?? '').trim();
}

// ---------------- 各平台拉取（返回归一化行） ----------------
type Fetcher = (apikey: string, start: Date, end: Date) => Promise<NormOrder[]>;

const fetchJd: Fetcher = async (apikey, start, end) => {
  const out: NormOrder[] = [];
  let pageNo = 1;
  while (true) {
    const { payload } = await hjkCall(
      'jd/getorderrow',
      { startTime: bjStr(start), endTime: bjStr(end), type: '3', pageNo: String(pageNo), pageSize: '200' },
      apikey
    );
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const list = (data.data as Record<string, unknown>[] | undefined) ?? [];
    for (const r of list) {
      // jd validCode：1=有效(未结算) 2=无效 3=已结算（社区口径，待真实订单校准）
      const valid = num(r.validCode);
      const st: NormOrder['st'] = valid === 3 ? 'settled' : valid === 2 ? 'closed' : 'paid';
      out.push({
        provider: 'jd',
        orderSn: String(r.orderId ?? ''),
        rowKey: String(r.skuId ?? ''),
        st,
        refunded: valid === 2 && num(r.estimateFee) === 0 && num(r.skuReturnNum ?? 0) > 0,
        payPrice: num(r.actualCosPrice) || num(r.estimateCosPrice) || num(r.price),
        commission: num(r.actualFee) || num(r.estimateFee),
        promoter: toPromoter(r.positionId),
        title: String(r.skuName ?? ''),
        orderTime: bjParse(String(r.orderTime ?? '')),
        settledTime: bjParse(String(r.finishTime ?? '')),
        // v1 联盟无独立 updated_at 字段，用 finishTime 兜底（有值即代表状态已推进到完成）
        platformUpdatedAt: bjParse(String(r.finishTime ?? r.updateTime ?? '')) ?? undefined,
        bizCategory: bizCategoryOf('jd'),
        bizChannel: bizChannelOf('jd'),
      });
    }
    if (!data.hasMore || pageNo >= MAX_PAGES || list.length === 0) break;
    pageNo++;
  }
  return out;
};

const fetchTb: Fetcher = async (apikey, start, end) => {
  const out: NormOrder[] = [];
  let pageNo = 1;
  let positionIndex = '';
  while (true) {
    const params: Record<string, string | number> = {
      start_time: bjStr(start),
      end_time: bjStr(end),
      query_type: '1',
      page_no: String(pageNo),
      page_size: '50',
    };
    if (pageNo > 1 && positionIndex) {
      params.jump_type = '1';
      params.position_index = positionIndex;
    }
    const { payload } = await hjkCall('tb/getorder', params, apikey);
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const results = (data.results ?? {}) as Record<string, unknown>;
    // publisher_order_dto 单条时是对象、多条时是数组（实测）
    const dto = results.publisher_order_dto;
    const list: Record<string, unknown>[] = Array.isArray(dto) ? dto : dto && typeof dto === 'object' ? [dto] : [];
    for (const r of list) {
      // tk_status：12=付款 13=关闭 14=确认收货 3=结算成功
      const tk = num(r.tk_status);
      const st: NormOrder['st'] = tk === 3 ? 'settled' : tk === 13 ? 'closed' : tk === 12 || tk === 14 ? 'paid' : 'created';
      // 归因字段候选（转链传 extend_id，回流映射待真实订单校准）
      const promoter = toPromoter(r.adid) ?? toPromoter(r.ext1) ?? toPromoter(r.special_id);
      out.push({
        provider: 'tb',
        orderSn: String(r.trade_id ?? ''),
        st,
        refunded: tk === 13,
        // 实付价：2026-09-23 实测响应无 total_goods_fee/price 字段（存量单 pay_price=0 根因），
        // 真身=alipay_total_price（支付宝实付总额），备选 item_price×item_num（商品原价合计）
        payPrice: num(r.alipay_total_price) || num(r.item_price) * num(r.item_num),
        // 佣金：已结算单用实际 pub_share_fee，未结算/为 0 时回退预估 pub_share_pre_fee
        commission: num(r.pub_share_fee) || num(r.pub_share_pre_fee),
        promoter,
        title: String(r.item_title ?? ''),
        orderTime: toDate(r.tk_create_time),
        settledTime: toDate(r.settle_time),
        // v1 联盟无独立 updated_at 字段，用 settle_time 兜底
        platformUpdatedAt: toDate(r.settle_time) ?? toDate(r.tk_create_time) ?? undefined,
        bizCategory: bizCategoryOf('tb'),
        bizChannel: bizChannelOf('tb'),
      });
    }
    const hasNext = String(data.has_next ?? 'false') === 'true';
    const pi = String(data.position_index ?? '');
    positionIndex = pi ? pi.split('|').pop() ?? '' : '';
    if (!hasNext || pageNo >= MAX_PAGES || list.length === 0) break;
    pageNo++;
  }
  return out;
};

const fetchPdd: Fetcher = async (apikey, start, end) => {
  const out: NormOrder[] = [];
  let page = 1;
  while (true) {
    const { payload } = await hjkCall(
      'pdd/getorder',
      {
        start_update_time: Math.floor(start.getTime() / 1000),
        end_update_time: Math.floor(end.getTime() / 1000),
        page: String(page),
        page_size: '100',
      },
      apikey
    );
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const list = (data.order_list as Record<string, unknown>[] | undefined) ?? [];
    for (const r of list) {
      // custom_parameters 为转链时注入的 JSON {"uid":"<user_id>"}（旧单兼容纯数字）
      let promoter: number | undefined;
      const cp = r.custom_parameters;
      if (typeof cp === 'string' && cp.startsWith('{')) {
        try {
          promoter = toPromoter(JSON.parse(cp).uid);
        } catch {
          /* 忽略非 JSON */
        }
      } else {
        promoter = toPromoter(cp);
      }
      const settledTs = r.order_settle_time != null ? num(r.order_settle_time) : 0;
      const desc = String(r.order_status_desc ?? '');
      const st: NormOrder['st'] = settledTs > 0 ? 'settled' : /关|取消|失效/.test(desc) ? 'closed' : num(r.order_pay_time) > 0 ? 'paid' : 'created';
      out.push({
        provider: 'pdd',
        orderSn: String(r.order_sn ?? ''),
        st,
        refunded: false,
        payPrice: num(r.order_amount) / 100,
        commission: num(r.promotion_amount) / 100,
        promoter,
        title: String(r.goods_name ?? ''),
        pic: String(r.goods_thumbnail_url ?? ''),
        orderTime: toDate(num(r.order_pay_time) || r.order_create_time),
        settledTime: toDate(settledTs),
        // pdd 有真实的 order_update_time，用它当窗口游标最准
        platformUpdatedAt: toDate(num(r.order_update_time) || settledTs || r.order_create_time) ?? undefined,
        bizCategory: bizCategoryOf('pdd'),
        bizChannel: bizChannelOf('pdd'),
      });
    }
    const total = num(data.total_count);
    if (page * 100 >= total || list.length === 0 || page >= MAX_PAGES) break;
    page++;
  }
  return out;
};

const fetchVip: Fetcher = async (apikey, start, end) => {
  const out: NormOrder[] = [];
  let pageindex = 1;
  while (true) {
    const { payload } = await hjkCall(
      'vip/getorder',
      {
        pageindex: String(pageindex),
        pagesize: '100',
        updateTimeStart: start.getTime(),
        updateTimeEnd: end.getTime(),
      },
      apikey
    );
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const list = (data.orderInfoList as Record<string, unknown>[] | undefined) ?? [];
    for (const r of list) {
      // vip status：0=不合格 1=待定 2=已完结；settled 1=蚂蚁侧已结算
      const details = (r.detailList as Record<string, unknown>[] | undefined) ?? [];
      const payPrice = details.reduce((s, d) => s + num(d.commissionTotalCost), 0) || num(r.commission);
      const st: NormOrder['st'] = num(r.settled) === 1 ? 'settled' : num(r.status) === 0 ? 'closed' : 'paid';
      out.push({
        provider: 'vip',
        orderSn: String(r.orderSn ?? ''),
        st,
        refunded: false,
        payPrice,
        commission: num(r.commission),
        promoter: toPromoter(r.channelTag),
        title: String(details[0]?.goodsName ?? ''),
        pic: String(details[0]?.goodsThumb ?? ''),
        orderTime: toDate(r.orderTime),
        settledTime: toDate(r.settledTime),
        platformUpdatedAt: toDate(r.settledTime ?? r.orderTime) ?? undefined,
        bizCategory: bizCategoryOf('vip'),
        bizChannel: bizChannelOf('vip'),
      });
    }
    if (list.length < 100 || pageindex >= MAX_PAGES) break;
    pageindex++;
  }
  return out;
};

/**
 * pf_type →落库 provider 映射（D先生 2026-10-04 定：与蚂蚁星球保持一致）。
 *
 * 为什么这么映射：pforder 是「平台活动」聚合接口，pf_type 才是真正的平台归属。
 * 其中 1/2/3/6 与 v1 联盟接口的 jd/pdd/tb/vip **是同一批钱的两个视角**
 *（同一平台分别从联盟 API 和蚂蚁 API 拉到），复用同桶即可天然去重，
 * 避免同一笔佣金被算两遍。其余 pf_type 是v1 联盟接口没有的平台，单独成桶。
 *
 * ⚠️ 新增桶必须同步server/src/routes/orders.ts 的 CPS_PROVIDERS 常量，
 *    否则订单中心的「CPS 订单」tab 会漏掉（实测该tab 靠常量圈定范围）。
 */
const PF_TYPE_PROVIDER: Record<number, string> = {
  1: 'jd',      // 京东
  2: 'pdd',     // 拼多多
  3: 'tb',      // 淘宝
  6: 'vip',     // 唯品会
  7: 'meituan', // 美团分销联盟
  13: 'meituan',// 美团联盟
  14: 'other',  // 其他
  15: 'ks',     // 快手
  16: 'meituan',// 美团联盟(美天赚)
  30: 'eleme',  // 饿了么
  31: 'didi',   // 滴滴
  32: 'local',  // 吃喝玩乐周边
  34: 'liucard',// 流量卡
  40: 'fzy',    // 飞猪
};
const PF_TYPE_FALLBACK = 'other';
function providerOfPfType(t: number): string {
  return PF_TYPE_PROVIDER[t] ?? PF_TYPE_FALLBACK;
}
/** pforder 落库后的全部 provider 桶（查水位/结算范围时用） */
const PF_TYPE_PROVIDER_BUCKETS: string[] = [...new Set(Object.values(PF_TYPE_PROVIDER))];

/**
 * ⛔ pforder 里**必须丢弃**的 pf_type —— 它们是 v1 联盟接口同一订单的「粗粒度镜像」。
 *
 * 实测铁证（2026-10-04，orderId 3640401013826930 京东单，两接口同时返回）：
 *   v1 jd/getorderrow : actualCosPrice=10.5(元) actualFee=0.11(元) skuId=10235021573650
 *                       positionId=100001001496133 validCode=17 finishTime 有值
 *   v2 pforder        : cosprice=1050(分)  commission=8(分) 无 skuId 无推广位 isbalance=0
 *
 * 结论：pf 侧是**分**单位且佣金更小、无明细、无归因、无结算信号。若让它按同 provider
 * 落库，`order_sn = ${provider}:${orderid}:` 会与 v1 完全撞键 → upsert 互相覆盖，
 * 把 v1 已写对的「元」金额覆盖成分/更小的佣金，**看板收益直接算错**。
 * tb 已验证同命名空间（pf_type=3 orderid 3317079756185003181 === v1 trade_id）。
 * 故这四类统一让位给 v1 联盟接口（v1 才是权威口径：有 sku 级明细 + 推广位 + 结算信号）。
 */
const PF_TYPES_YIELD_TO_V1 = new Set([1, 2, 3, 6]);

/** pf_type 让位丢弃计数（模块级：Fetcher 签名只有 3 参，用旁路计数器回传给 runOrdersync 的 stats） */
let pfSkipCount = 0;
const resetPfSkipCount = () => { pfSkipCount = 0; };
const takePfSkipCount = () => { const v = pfSkipCount; pfSkipCount = 0; return v; };

// 蚂蚁自有 4 类（v2 网关）。实测 2026-10-03 逐个接口验证：
//   ① pforder（平台活动 pf_type 1~40）—— **免签**，可正常拉取
//   ② dcorder（点餐 nx/bsk/mdl/xbk）—— 必须 sign
//   ③ movieorder（电影票）—— 必须 sign
//   ④ recharge/orderlist（权益兑换/直充）—— 必须 sign，且走 https + POST
// 签名密钥存 provider_config.api_secret（跟 site_id 走）；未配置则签名类整体跳过（不报错）。
//
// ⚠️ 归因字段差异（2026-10-03 实测修正，之前 pf=0 条的根因）：
//   pforder **响应里根本没有 uid 字段**，推广位在 extend_id。
//   我方转链（site.ts actunionurl / link.ts tb）传的就是 extend_id = user_id，
//   故 pforder 取 extend_id 归因；dcorder/movieorder/recharge 响应才有 uid。
//   两种都试：extend_id 优先、uid 兜底，且都要求「整数字符串 + >1」（1=站点默认位不归因）。
const mayiFetcher = (
  path: string,
  provider: string,
  mapStatus: (r: Record<string, unknown>) => { st: NormOrder['st']; refunded: boolean },
  opts?: {
    /** true=需 md5 签名；false=免签 */
    signed?: boolean;
    /** recharge 系列：https + POST + apikey 进包裹串 */
    rechargeStyle?: boolean;
    /** 分页判定字段名（默认 list）；pforder 返回的是 data */
    listKey?: string;
    /** ⚠️ 金额单位换算：上游各接口不统一（实测 dcorder 是「元」，pforder/movie/recharge 是「分」）
     *  归一到「元」。填 1 表示上游已是元不换算 */
    moneyUnit?: number;
      /** pforder：按 pf_type 映射语义化 provider（与 v1 联盟接口同桶去重） */
    byPfType?: boolean;
    /** pforder：pf_type 让位判定（1/2/3/6 归v1，见PF_TYPES_YIELD_TO_V1） */
    skipPfType?: boolean;
  }
): Fetcher => async (apikey, start, end) => {
  const cfg = await resolveHjkConfig(); // 取 api_secret（跟随默认站点，签名判定用）
  const secret = opts?.signed ? cfg.apiSecret : null;
  if (opts?.signed && !secret) {
    // 无密钥 → 该类整体跳过（在 FETCHERS 层已由 SKIP 拦截，这里是兜底）
    return [];
  }

  const out: NormOrder[] = [];
  let page = 1;
  const listKey = opts?.listKey ?? 'list';
  const div = opts?.moneyUnit ?? 100;
  // ⚠️ 不再做「本站 user_id 终审」（D先生 2026-10-04 定调：apikey 是站点级资产，
  //    推广位是谁的不影响这笔钱属本站）。仅保留「站点默认位/无效值」这一种丢弃。
  while (true) {
    // 时间戳按秒。
    // ⛔ 参数名铁律（2026-10-04 实测踩坑）：recharge 只认 `starttime/endtime`（秒），
    //    换任何别的名字（updateTimeStart/updatetime/addtime…）上游会**直接报「签名错误」**
    //    —— 因为它不认这些 key，strparam 集合对不上，hash 必然不匹配。
    const params: Record<string, string | number> = {
      page: String(page),
      limit: '100',
      starttime: Math.floor(start.getTime() / 1000),
      endtime: Math.floor(end.getTime() / 1000),
    };
    // querytype=2 = 按更新时间筛（pforder 专用）。⚠️ recharge 虽支持但实测传与不传结果一致，
    // 且 diancan/movie 传 querytype 会让**签名失败**（同上面的 key 集合问题）→ 只给 pforder 加。
    if (opts?.byPfType) params.querytype = '2';

    let sign: string | undefined;
    if (opts?.signed && secret) {
      // ⛔ 签名包裹铁律（2026-10-04 实测反推）：三个签名类接口**全部**要
      //    `apikey=X&secret=Y` 复合包裹（md5(apikey=..&secret=..&strparam&apikey=..&secret=..)）。
      //    只用 secret= 包裹 → movie/diancan 报「签名验证错误」、recharge 报「签名错误」。
      sign = md5SignWithApikey(params, apikey, secret);
    }

    const { payload } = await hjkCall(path, params, apikey, 'v2', {
      sign,
      baseUrl: opts?.rechargeStyle ? GATEWAY_HTTPS : undefined,
      method: opts?.rechargeStyle ? 'POST' : undefined,
    });
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const list = ((opts?.listKey ? data[opts.listKey] : (data.list ?? data.data)) as Record<string, unknown>[] | undefined) ?? [];
    for (const r of list) {
      // 归因：extend_id 优先（pforder），uid 兜底（dc/movie/recharge）
      // ⛔ **绝不因归因失败丢单**（D先生 2026-10-04 定调：apikey 是站点级资产）。
      //    实测 99.8% 的 extend_id 是「渠道号_子单号」复合形态、非我方 user_id，
      //    旧代码 `if (!promoter) continue` 把这些单全丢了 → 一律入库，promoter 缺失记 0。
      const promoter = toPromoter(r.extend_id) ?? toPromoter(r.uid);
      const rawAttr = attributionRaw(r);
      const pfTypeRaw = opts?.byPfType ? num(r.pf_type) : 0;
      // pf_type 1/2/3/6 让位 v1联盟接口（同一订单的粗粒度镜像，会覆盖正确金额）
      if (opts?.skipPfType && PF_TYPES_YIELD_TO_V1.has(pfTypeRaw)) {
        pfSkipCount++;
        continue;
      }
      const { st, refunded } = mapStatus(r);
      const pfType = opts?.byPfType ? num(r.pf_type) || undefined : undefined;
      // 落库桶：pforder 按 pf_type 语义化，其余用 fetcher 自身的 provider
      const bucket = pfType ? providerOfPfType(pfType) : provider;
      out.push({
        provider: bucket,
        orderSn: String(r.orderid ?? ''),
        // ⚠️ rowKey 用 goods_id：实测 1011 行里有 1 组同 orderid 多行、42 行 goods_id 含逗号
        //   （一单多商品）。不带 rowKey 会同orderid 互相覆盖丢数据。
        rowKey: opts?.byPfType ? String(r.goods_id ?? r.id ?? '') : undefined,
        st,
        refunded,
        // ⚠️ 单位按 provider 归一到「元」：pforder/movie/recharge 上游给「分」→ /100；
        //   diancan（点餐）上游直接给「元」→ moneyUnit=1 不换算（否则少 100 倍）
        payPrice: (num(r.payprice) || num(r.cosprice)) / div,
        commission: num(r.commission) / div,
        promoter,
        pfType,
        attrRaw: rawAttr || undefined,
        title: String(r.goods_name ?? r.item_name ?? r.storeName ?? r.goodsName ?? r.storeName ?? ''),
        pic: typeof r.goods_img === 'string' ? r.goods_img : typeof r.goodImg === 'string' ? r.goodImg : undefined,
        // ⚠️ 三类时间必须分清（D先生 2026-10-04「下单时间是不是搞错了」）：
        //   orderTime  = 下单时间（业务事实，落 paid_at）
        //   settledTime = 完成/结算时间（落 settled_at）
        //   platformUpdatedAt = 上游最近一次状态更新时间（**窗口游标**，落 platform_updated_at）
        //     字段名各接口不一：pforder=updated_at、diancan/recharge=updatedtime。
        orderTime: toDate(r.createdtime ?? r.ordertime),
        settledTime: toDate(r.completetime ?? r.finishtime),
        platformUpdatedAt: toDate(r.updated_at ?? r.updatedtime ?? r.updatedAt),
        bizCategory: bizCategoryOf(bucket),
        bizChannel: bizChannelOf(bucket),
      });
    }
    // 翻页判定：finish(pf/dc/movie) / hasMore(recharge) / data 空 / 达上限
    // 翻页判定
    // ⚠️ pf 的 30 天窗口实测 total 可达数千行，单次翻页会撞 MAX_PAGES 上限被截断
    //   （截断 = 静默漏单）。故 pf 走「按天分段」：外层把30 天切成若干段，每段独立翻页，
    //   由 MAYI_PROVIDERS 分段逻辑驱动（见 runOrdersync 的 segment 循环）。
    //   这里只负责**单段内**翻到底，段内页数上限给到 40（4000 行）足够。
    const hasMore =
      data.finish === true ||
      num(data.hasMore) === 1 ||
      list.length >= 100;
    if (!hasMore || list.length === 0 || page >= MAX_PAGES) break;
    page++;
  }
  return out;
};

// 状态映射（各业务枚举见官方文档 + 实测响应）
// isbalance：蚂蚁星球订单佣金结算状态，0否1是 —— ⚠️ **实测 pforder 恒为 0**（6 天 2000+ 行全 0），
//   不能作为结算判据；真实结算信号在 valistatus（见 pfSettledByStatus）。
const isBalanceSettled = (r: Record<string, unknown>) => num(r.isbalance) === 1;

/**
 * pforder 结算/退款判定 —— 以 **valistatus 中文态** 为唯一判据（2026-10-04 实测 6 天全量枚举）：
 *
 *   结算类：有效-结算(1122) 已结算(5) 订单结算(2)      → settled
 *   退款类：无效-已退款(265) 无效-已退回(264) 售中退款/售后退款 → refunded
 *   关闭类：无效-已关闭(232) 无效-取消(21) 无效-未支付(63) 无效-已取消(2) 无效订单(1) → closed
 *   其余：有效-完成/已签收/已付款/处理中…→ paid
 *
 * ⚠️ 旧实现只判`yn===0 || validcode==='0'`，而 pf16 结算单是 `validcode=6,yn=1` →
 *   全部落进 'paid'，**佣金永远不结算**（这就是「同步进来但收益为 0」的第二个根因）。
 *
 * @returns settled/refunded/closed/paid 四态；refunded 是**正交标记**（platform_status 仍记 closed）
 */
function pfSettledByStatus(vs: string): 'settled' | 'refunded' | 'closed' | 'paid' {
  if (/结算/.test(vs)) return 'settled';
  if (/退款|退回/.test(vs)) return 'refunded';
  if (/关闭|取消|未支付|无效|失效/.test(vs)) return 'closed';
  return 'paid';
}

/** ① pforder 平台活动：免签；cosprice/commission 单位=分；列表在 data.data
 *  ⚠️ provider 不再是 'pf' 单桶，而是逐条按 pf_type 落jd/pdd/tb/meituan/... （见 providerOfPfType）
 *  ⚠️ 结算/退款/关闭判据= valistatus 中文态（isbalance 实测恒 0，不可用） */
const fetchPf = mayiFetcher(
  'index/pforder',
  'pf',
  (r) => {
    const s = pfSettledByStatus(String(r.valistatus ?? ''));
    return {
      // refunded 是正交标记：platform_status 只在 closed/paid/settled 三态里选
      st: s === 'refunded' ? 'closed' : s,
      // 已退款/已退回 = 佣金冲销；关闭类只是没成交，不冲销（本来也没结算）
      refunded: s === 'refunded',
    };
  },
  { listKey: 'data', byPfType: true, skipPfType: true }
);

/**
 * ② diancan/orderlist 点餐：需签名；payprice 单位=元（实测 "11.44"）
 *
 * ⛔ 路径铁律（2026-10-04 实测纠正，之前的 `open/dcorder` **从来就是 404**）：
 *    官方文档写「dcorder 点餐」，但网关真实路径是 `v2/api/diancan/orderlist`（无 index 段）。
 *    已实测：`open/dcorder` / `index/dcorder` / `dc/orderlist` 全部 404，只有 diancan/orderlist 返回 200。
 */
const fetchDc = mayiFetcher(
  'diancan/orderlist',
  'dc',
  (r) => {
    // status：0待付款 1已付款待出餐 2出餐中 3出餐成功 4确认收货(含部分退款) 5出餐失败退款 10关闭
    const s = num(r.status);
    const statusStr = String(r.statusstr ?? '');
    return {
      st: s === 10 || s === 5 || /关闭|退款|失败/.test(statusStr)
        ? 'closed'
        : s >= 1
          ? 'paid'
          : 'created',
      refunded: s === 5 || /退款/.test(statusStr) || num(r.returnprice ?? 0) > 0,
    };
  },
  { signed: true, rechargeStyle: true, moneyUnit: 1 }
);

/**
 * ③ movie/orderlist 电影票：需签名；payprice 单位=分（实测 7722/8580）
 *
 * ⛔ 路径同上：文档写 `movieorder`，真实是 `v2/api/movie/orderlist`。
 * ⚠️ 实测该 apikey total=0（真没卖票），接口本身通、签名通，别再当 bug 查。
 */
const fetchMovie = mayiFetcher(
  'movie/orderlist',
  'movie',
  (r) => {
    // status：1已付款 2受理中 3待出票 5已结算 6待付款 10关闭
    const s = num(r.status);
    const statusStr = String(r.statusstr ?? '');
    return {
      st: s === 10 || s === 5 || /关闭|退款/.test(statusStr) ? 'closed' : s >= 1 ? 'paid' : 'created',
      refunded: num(r.return_price ?? 0) > 0 || String(r.refundid ?? '') !== '',
    };
  },
  { signed: true, rechargeStyle: true }
);

/**
 * ④ recharge/orderlist 权益充值/直充：需签名 + https + POST + apikey 进包裹串；payprice 单位=分
 *
 * ⛔ 三处实测踩坑（2026-10-04）：
 *   ① 分页参数名是 **page/limit**，不是 pageindex/pagesize —— 用错的上游直接返回空 list
 *      （签名能过但 total=0），改对后 total=829（829 单历史单躺着没同步）。
 *   ② 时间参数名是 **starttime/endtime（秒）**，用 updateTimeStart/updatetime 等
 *      会让**签名直接失败**（"签名错误"）—— 因为它不认这些 key，strparam 集合对不上。
 *   ③ 签名包裹必须用 `apikey=X&secret=Y` 复合式（单纯 secret= 包裹报签名错误）。
 */
const fetchRecharge = mayiFetcher(
  'recharge/orderlist',
  'recharge',
  (r) => {
    // status：0待付款 1已付款 2充值中 3充值完成 5已结算 10订单关闭(充值失败已退款)
    const s = num(r.status);
    const statusStr = String(r.statusstr ?? '');
    return {
      st: s === 10 || /关闭|失败|退款/.test(statusStr)
        ? 'closed'
        : s === 5
          ? 'settled'
          : s >= 1
            ? 'paid'
            : 'created',
      refunded: s === 10 || num(r.return_price ?? 0) > 0,
    };
  },
  { signed: true, rechargeStyle: true }
);

const FETCHERS: Record<string, Fetcher> = {
  jd: fetchJd,
  tb: fetchTb,
  pdd: fetchPdd,
  vip: fetchVip,
  pf: fetchPf,
  dc: fetchDc,
  recharge: fetchRecharge,
  movie: fetchMovie,
};
/**
 * 结算/冲销圈定的 provider 全集。
 *
 * ⚠️ 必须展开 pf_type 全部映射桶：pforder 落库时 provider 已被改写成语义化名
 *   （jd/pdd/tb/meituan/eleme/...），不再是 'pf'。若只取 FETCHERS 的 key，
 *   这些新桶会被 settleDue/chargebackDue 完全漏掉（永不结算、永不冲销）。
 */
const PROVIDERS: string[] = [
  ...Object.keys(FETCHERS).filter((p) => p !== 'pf'),
  ...PROVIDER_CPS,
];
// 2026-10-03 实测结论：
//   near —— /v2/api/open/nearorder 实测 404 下线，同类订单由 pforder pf_type=32（吃喝玩乐周边）覆盖
//   dc/recharge/movie —— 需 provider_config.api_secret；未配置则整类跳过（签名类无密钥=拉不了，
//                        区别于旧的「文档未公开签名」误判——算法现已按官方文档实现并用示例校验通过）
// ⚠️ SKIP 是静态表，但密钥是否配置是动态的 → runOrdersync 内按 apiSecret 二次判定（见下）

// ---------------- 入库 / 结算 / 冲销 ----------------
/**
 * order_sn 长度守卫：`order_sn` 列是 varchar(64)，而 pforder 的 orderid 最长 26 字符
 * （`ZQJvXlpTVlRXXVBkBmlbWFJfXg==`）+ goods_id 逗号串可达 50+ → 直接拼会超长报
 * DATABASE_22001（实测 2705 行全批失败）。故 rowKey 一律压成**12 位短哈希**。
 * 长度预算：provider(≤8) + ':' + orderid(≤26) + ':' + 12 = 47 < 64✅
 */
function shortHash(s: string): string {
  // FNV-1a 32bit ×2 拼 16 hex，取前 12 位；够短且冲突概率对本场景可忽略
  const h1 = fnv1a(s, 0x811c9dc5);
  const h2 = fnv1a(s, 0x01000193 ^ 0x9e3779b9);
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}
function fnv1a(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 批量 upsert 分片大小：网关无事务，50 行/语句是「请求数 vs 单条超长」的最佳平衡点 */
const UPSERT_BATCH = 50;

/** 宽窗口单轮最多回溯的天数：30 天按 SEGMENT_BUDGET 天/轮 收敛，30min 一轮定时器约 2~3 轮补齐 */
const SEGMENT_BUDGET = 10;
/** 分段并发度：上游限流器本身串行，这里只是让等待重叠，不加压上游 */
const SEGMENT_CONCURRENCY = 4;

/**
 * 允许「水位续拉」的平台白名单。
 *
 * ⛔ jd 必须排除：它硬限制「查询时间范围不超过 1 小时」，水位重叠加固定 1h 窗口
 *   会突破上限，上游直接报 `无效请求-查询时间范围超过1小时`（实测 2026-10-04）。
 *   窄窗口平台（jd 1h / tb 3h / pdd 24h / vip 2h）一律用固定窗口。
 */
const WATERMARK_PROVIDERS = new Set(['pf', 'dc', 'movie', 'recharge']);

async function upsertOrders(siteId: string, orders: NormOrder[]): Promise<number> {
  interface Row {
    orderSn: string; provider: string; providerOrderSn: string;
    payPrice: number; commission: number; buyerId: number; promoterId: number | null;
    snapshot: string; platformStatus: string; refundStatus: string;
    paidAt: Date | null; settledAt: Date | null; platformUpdatedAt: Date | null;
    bizCategory: string; bizChannel: string;
  }
  const rows: Row[] = [];
  for (const o of orders) {
    if (!o.orderSn) continue;
    // ⚠️ order_sn 是 varchar(64)。rowKey 短的（jd 的 skuId 14 位、tb/vip/pdd 无 rowKey）
    //    **必须原样保留** —— 改成哈希会让历史 order_sn 变化、同一单裂成两条（旧+新）。
    //    只有确实超长时才压成短哈希（pforder 的 goods_id 逗号串可达 50+，实测报 22001）。
    const rawRowKey = o.rowKey ?? '';
    let rowKey = rawRowKey.length > 20 ? shortHash(rawRowKey) : rawRowKey;
    let orderSn = `${o.provider}:${o.orderSn}:${rowKey}`;
    if (orderSn.length > 64) {
      // 兜底：provider+orderSn 本身就超 64（实测 orderid 最长 26 字符，一般用不到）。
      // 该单从未成功入库过（超长必报 22001），故压哈希不会造成历史裂单。
      rowKey = shortHash(`${o.provider}|${o.orderSn}|${rawRowKey}`);
      orderSn = `${o.provider}:${shortHash(o.orderSn)}:${rowKey}`;
    }
    rows.push({
      orderSn,
      provider: o.provider,
      providerOrderSn: o.orderSn,
      payPrice: Math.max(0, o.payPrice),
      commission: Math.max(0, o.commission),
      buyerId: o.promoter ?? 0, // CPS 单 buyer 未知：归因 user 即买家（自购），无归因记 0
      promoterId: o.promoter ?? null,
      // ⚠️ promoter_id 存的是**蚂蚁侧原始归因线索**（可能是手机号/他人推广位），
      //    不代表本站用户（D先生 2026-10-04 定调）。归属判定一律看 site_id。
      //    pfType/attrRaw 冗余留档：便于按蚂蚁原始口径回溯/对账。
      snapshot: JSON.stringify({
        title: o.title,
        pic: o.pic ?? null,
        providerOrderSn: o.orderSn,
        rowKey: rowKey || null,
        ...(o.pfType ? { pfType: o.pfType } : {}),
        ...(o.attrRaw ? { attrRaw: o.attrRaw } : {}),
      }),
      platformStatus: o.st,
      refundStatus: o.refunded ? 'refunded' : 'none',
      paidAt: o.orderTime ?? null,
      settledAt: o.settledTime ?? null,
      // ⛔ 窗口游标：上游最近一次状态更新时间（不是下单时间）。
      //    pforder 的 querytype=2 就是按它筛，db 里也必须存一份，
      //    否则「窗口按更新时间、数据按下单时间存」的错位无法观测（2026-10-04 实测 875 条 2023 年单）。
      platformUpdatedAt: o.platformUpdatedAt ?? o.settledTime ?? o.orderTime ?? null,
      bizCategory: o.bizCategory ?? bizCategoryOf(o.provider),
      bizChannel: o.bizChannel ?? bizChannelOf(o.provider),
    });
  }

  // ⚠️ **必须批量**：实测 2705 行逐条 upsert 会跑过 nginx/网关超时（504 Gateway Time-out）。
  //    50 行/语句 → 2705 行只需 55 次请求，秒级完成。
  //    注意：42P18铁律——UPDATE/DELETE 参数须显式 cast；此处是 INSERT，列位可推断，安全。
  let n = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const slice = rows.slice(i, i + UPSERT_BATCH);
    const params: unknown[] = [];
    const tuples = slice
      .map((r) => {
        const b = params.length;
        // ⚠️ 17 个目标列 ↔ 必须 17 个表达式。platform 曾写成字面量 'mini'（不占位），
        //    导致 42601 "more target columns than expressions" —— 一律走占位。
        params.push(
          r.orderSn, siteId, r.provider, r.providerOrderSn, 'mini',
          r.payPrice, r.commission, r.buyerId, r.promoterId,
          r.snapshot, r.platformStatus, r.refundStatus, r.paidAt, r.settledAt,
          r.platformUpdatedAt, r.bizCategory, r.bizChannel,
        );
        const cols = 17;
        return `(${Array.from({ length: cols }, (_, k) => `$${b + k + 1}`).join(',')})`;
      })
      .join(',');
    await pool.query(
      `INSERT INTO "order" (order_sn, site_id, provider, provider_order_sn, platform, pay_price, commission,
                            buyer_id, promoter_id, goods_snapshot, platform_status, refund_status, paid_at, settled_at,
                            platform_updated_at, biz_category, biz_channel)
       VALUES ${tuples}
       ON CONFLICT (order_sn) DO UPDATE SET
         pay_price = EXCLUDED.pay_price,
         commission = EXCLUDED.commission,
         platform_status = EXCLUDED.platform_status,
         refund_status = CASE WHEN EXCLUDED.refund_status <> 'none' THEN EXCLUDED.refund_status ELSE "order".refund_status END,
         paid_at = COALESCE("order".paid_at, EXCLUDED.paid_at),
         settled_at = COALESCE("order".settled_at, EXCLUDED.settled_at),
         -- ⚠️窗口游标必须**取最新**（上游每次状态变更都会推高），不能用 COALESCE(旧值, 新值)：
         --    那样第一轮写入后就永远不再更新，窗口回退会重复拉一堆。
         --    两边都NULL 时兜底用 paid_at（历史单修复前入库，没有该列值）。
         platform_updated_at = GREATEST(
           COALESCE("order".platform_updated_at, EXCLUDED.platform_updated_at),
           COALESCE(EXCLUDED.platform_updated_at, "order".platform_updated_at)
         ),
         biz_category = EXCLUDED.biz_category,
         biz_channel = EXCLUDED.biz_channel,
         goods_snapshot = EXCLUDED.goods_snapshot,
         updated_at = now()`,
      params
    );
    n += slice.length;
  }
  return n;
}

/**
 * 结算：元宝返还（给归因用户，按实付金额）+ 佣金三跳分配（基数=平台到手收益，比例按受益人自身等级）
 * 网关模式无连接事务 → 全部用「单语句 CTE + 唯一索引」保证原子与幂等（TCP 模式同样兼容）：
 *   - rebate_at 抢占失败/处理异常 → 回置 NULL 由下轮重试（结算 CTE 本身幂等，重放无副作用）
 *   - ingot_tx 唯一索引 uq_ingot_tx_order_ref、commission_flow 唯一索引 uq_commission_flow_order_level
 */
const rebateSql = `
WITH tx AS (
  INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
  VALUES ($1, 'ORDER_REBATE', $2, $3, 0, $4)
  ON CONFLICT (user_id, type, ref_id) WHERE type IN ('ORDER_REBATE','REFUND_DEDUCT') DO NOTHING
  RETURNING tx_id
), acc AS (
  -- 账户可能不存在（首笔返元宝）：upsert，仅 tx 实际写入时生效（重放冲突无副作用）
  INSERT INTO ingot_account (user_id, balance, total_earned) VALUES ($1, $3, $3)
  ON CONFLICT (user_id) DO UPDATE SET
    balance = ingot_account.balance + EXCLUDED.balance,
    total_earned = ingot_account.total_earned + EXCLUDED.total_earned,
    updated_at = now()
  WHERE EXISTS (SELECT 1 FROM tx)
  RETURNING balance
)
SELECT (SELECT count(*)::int FROM tx) AS inserted;
`;
/** balance_after 回填（data-modifying CTE 间快照隔离，须独立语句；仅回填占位值 0，幂等） */
const txBalanceFixSql = `
UPDATE ingot_tx SET balance_after = COALESCE((SELECT balance FROM ingot_account WHERE user_id = $1), 0)
 WHERE user_id = $1 AND type = $2 AND ref_id = $3 AND balance_after = 0
 RETURNING 1
`;

const commissionJumpSql = `
WITH ins AS (
  INSERT INTO commission_flow (order_id, user_id, level, amount, status)
  VALUES ($1, $2, $3, $4, 'available')
  ON CONFLICT (order_id, level) DO NOTHING
  RETURNING user_id, amount
), up AS (
  INSERT INTO promoter (user_id, invite_code, commission_balance)
  SELECT i.user_id, u.invite_code, i.amount
    FROM ins i JOIN "user" u ON u.user_id = i.user_id
  ON CONFLICT (user_id) DO UPDATE SET commission_balance = promoter.commission_balance + EXCLUDED.commission_balance
  RETURNING 1
)
SELECT (SELECT count(*)::int FROM up) AS done;
`;

async function settleDue(siteId: string, providers: string[]): Promise<number> {
  // providers 以逗号串传参（网关对数组参数绑定不可靠，string_to_array 两种 db 模式均正确）
  //
  // ⚠️ **LEFT JOIN**（D先生 2026-10-04 定调，原为 JOIN 是错的）：
  //   apikey 是站点级资产，推广位是谁的不影响这笔钱属本站。绝大多数单promoter
  //   都不是本站 user（实测 2000 条里仅 1 条），若用 INNER JOIN 这些单**永远不会被标
  //   rebate_at** → 每 30 分钟无限重复扫，且看板「已结算」口径漏统计。
  //   改为 LEFT JOIN 后：
  //     ├─ 有主（promoter/buyer 命中 user）→ 发元宝 + 佣金三跳（现有逻辑不变）
  //     └─ 无主 → **仍标 rebate_at**（幂等去重，不再重复扫），但不发元宝/佣金
  //        （没有受益人可发）。订单照样进入「已结算 + 站点收益」口径，
  //        看板净收益**照算**（决策#38：站点看板显示该站点全部真实收益）。
  const P = providers.join(',');
  let count = 0;

  // ⚠️ **无主单走单条批量 UPDATE**（2026-10-04 性能修复，实测必做）：
  //   pforder 修好后一次涌入 1561 条已结算单，其中 0 条有本站受益人（实测）。
  //   旧代码对每条都发一次「抢占 UPDATE」→ 1562 次串行网关往返 → 必然 504/500。
  //   实测单条批量 UPDATE 一次标记 1926 行、耗时 141ms。
  //   语义完全等价（都是「标 rebate_at 但不发元宝/佣金」），只是把 N 次往返压成 1 次。
  const bulk = await pool.query(
    `UPDATE "order" o SET rebate_at = now()
      WHERE o.site_id = $1 AND o.provider = ANY(string_to_array($2, ','))
        AND o.platform_status = 'settled' AND o.rebate_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.user_id = COALESCE(o.promoter_id, o.buyer_id))
      RETURNING id`,
    [siteId, P]
  );
  count += bulk.rows.length;

  // 有主单才需要逐条发元宝 + 佣金三跳（实测占比极低，通常个位数）
  const { rows: due } = await pool.query(
    `SELECT o.id, o.buyer_id, o.promoter_id, o.pay_price, o.commission, o.order_sn, u.user_id AS hit_user
       FROM "order" o
       JOIN "user" u ON u.user_id = COALESCE(o.promoter_id, o.buyer_id)
      WHERE o.site_id = $1 AND o.provider = ANY(string_to_array($2, ',')) AND o.platform_status = 'settled' AND o.rebate_at IS NULL`,
    [siteId, P]
  );
  for (const o of due) {
    const target = Number(o.hit_user ?? 0);
    if (target <= 0) continue;
    // 原子抢占：抢到才结算；抢不到=已处理
    // 网关模式 rowCount = rows.length（无 RETURNING 的 UPDATE 恒 0）→ 用 RETURNING 判定
    const claimed = await pool.query(
      `UPDATE "order" SET rebate_at = now() WHERE id = $1 AND rebate_at IS NULL RETURNING id`,
      [o.id]
    );
    if (!claimed.rows.length) continue;
    try {
      // 1. 元宝返还（按实付金额）
      const amount = Math.floor(num(o.pay_price) * INGOT_PER_YUAN);
      if (amount > 0) {
        await pool.query(rebateSql, [target, String(o.id), amount, `订单返元宝 ${o.order_sn}`]);
        await pool.query(txBalanceFixSql, [target, 'ORDER_REBATE', String(o.id)]);
      }
      // 2. 佣金三跳（L1 无佣金；比例按受益人自身等级取 member_level）
      const base = num(o.commission);
      if (base > 0) {
        const { rows: rel } = await pool.query(
          `SELECT u.parent_id, u.grand_id,
                  COALESCE(ml_self.self_rate, 0)     AS self_rate,
                  COALESCE(ml_parent.direct_rate, 0) AS parent_direct,
                  COALESCE(ml_grand.team_rate, 0)    AS grand_team
             FROM "user" u
             LEFT JOIN member m_self ON m_self.user_id = u.user_id
             LEFT JOIN member_level ml_self ON ml_self.level_id = m_self.level_id
             LEFT JOIN member m_parent ON m_parent.user_id = u.parent_id
             LEFT JOIN member_level ml_parent ON ml_parent.level_id = m_parent.level_id
             LEFT JOIN member m_grand ON m_grand.user_id = u.grand_id
             LEFT JOIN member_level ml_grand ON ml_grand.level_id = m_grand.level_id
            WHERE u.user_id = $1 LIMIT 1`,
          [target]
        );
        if (rel[0]) {
          const jumps: { userId: number; level: 1 | 2 | 3; rate: number }[] = [
            { userId: target, level: 1, rate: num(rel[0].self_rate) },
            { userId: Number(rel[0].parent_id), level: 2, rate: num(rel[0].parent_direct) },
            { userId: Number(rel[0].grand_id), level: 3, rate: num(rel[0].grand_team) },
          ];
          for (const j of jumps) {
            if (!j.userId || j.userId <= 0 || j.rate <= 0) continue;
            const amt = Math.round(base * j.rate * 100) / 100;
            if (amt <= 0) continue;
            await pool.query(commissionJumpSql, [o.id, j.userId, j.level, amt]);
          }
        }
      }
      count++;
    } catch (e) {
      // 处理失败回置占位，下轮重试（结算 CTE 幂等，重放安全）
      await pool.query(`UPDATE "order" SET rebate_at = NULL WHERE id = $1`, [o.id]);
      throw e;
    }
  }
  return count;
}

/** 冲销：退款单扣回元宝（余额不足挂 frozen）+ 佣金流水作废 + 余额扣回（单语句 CTE 原子） */
const chargebackIngotSql = `
WITH tx AS (
  INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
  VALUES ($1, 'REFUND_DEDUCT', $2, (- $3::int), 0, $4)
  ON CONFLICT (user_id, type, ref_id) WHERE type IN ('ORDER_REBATE','REFUND_DEDUCT') DO NOTHING
  RETURNING tx_id
), acc AS (
  UPDATE ingot_account
     SET balance = balance - LEAST(balance, $3),
         frozen = frozen + GREATEST(0, $3 - balance),
         updated_at = now()
   WHERE user_id = $1 AND EXISTS (SELECT 1 FROM tx)
  RETURNING balance, frozen
)
SELECT (SELECT count(*)::int FROM tx) AS inserted;
`;

const chargebackCommissionSql = `
WITH inv AS (
  UPDATE commission_flow SET status = 'invalid', updated_at = now()
   WHERE order_id = $1 AND status IN ('estimated', 'available')
  RETURNING user_id, amount
), agg AS (
  SELECT user_id, SUM(amount) AS amt FROM inv GROUP BY user_id
), upd AS (
  UPDATE promoter SET commission_balance = commission_balance - LEAST(commission_balance, agg.amt)
    FROM agg WHERE promoter.user_id = agg.user_id
  RETURNING 1
)
SELECT (SELECT count(*)::int FROM upd) AS done;
`;

async function chargebackDue(siteId: string, providers: string[]): Promise<number> {
  const P = providers.join(',');
  let count = 0;
  // ⚠️ 与 settleDue 同性能修复：无主退款单走单条批量 UPDATE（不扣回任何东西，只需标幂等）。
  const bulkCb = await pool.query(
    `UPDATE "order" o SET chargeback_at = now()
      WHERE o.site_id = $1 AND o.provider = ANY(string_to_array($2, ','))
        AND o.refund_status = 'refunded' AND o.rebate_at IS NOT NULL AND o.chargeback_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.user_id = COALESCE(o.promoter_id, o.buyer_id))
      RETURNING id`,
    [siteId, P]
  );
  count += bulkCb.rows.length;

  // 有主退款单才需真扣回
  const { rows: due } = await pool.query(
    `SELECT o.id, o.promoter_id, o.buyer_id, o.pay_price, o.order_sn, u.user_id AS hit_user
       FROM "order" o
       JOIN "user" u ON u.user_id = COALESCE(o.promoter_id, o.buyer_id)
      WHERE o.site_id = $1 AND o.provider = ANY(string_to_array($2, ',')) AND o.refund_status = 'refunded'
        AND o.rebate_at IS NOT NULL AND o.chargeback_at IS NULL`,
    [siteId, P]
  );
  for (const o of due) {
    const target = Number(o.hit_user ?? 0);
    if (target <= 0) continue;
    const claimed = await pool.query(
      `UPDATE "order" SET chargeback_at = now() WHERE id = $1 AND chargeback_at IS NULL RETURNING id`,
      [o.id]
    );
    if (!claimed.rows.length) continue;
    try {
      if (num(o.pay_price) > 0) {
        const amount = Math.floor(num(o.pay_price) * INGOT_PER_YUAN);
        const cbRes = await pool.query(chargebackIngotSql, [target, String(o.id), amount, `退款冲销 ${o.order_sn}`]);
        if (cbRes.rows[0]?.inserted > 0) {
          await pool.query(
            `UPDATE ingot_tx SET remark = remark || '（差额挂账 frozen=' || COALESCE((SELECT frozen FROM ingot_account WHERE user_id = $1), 0) || '）'
              WHERE user_id = $1 AND type = 'REFUND_DEDUCT' AND ref_id = $2 AND remark NOT LIKE '%差额挂账%'`,
            [target, String(o.id)]
          );
        }
        await pool.query(txBalanceFixSql, [target, 'REFUND_DEDUCT', String(o.id)]);
        await pool.query(chargebackCommissionSql, [o.id]);
      }
      count++;
    } catch (e) {
      await pool.query(`UPDATE "order" SET chargeback_at = NULL WHERE id = $1`, [o.id]);
      throw e;
    }
  }
  return count;
}

// ---------------- 主入口 ----------------
/**
 * ⛔ **同步起点铁律（D先生 2026-10-04钦定）**：只同步 2026-09-20 之后的订单。
 *
 * 为什么必须是模块级常量而不是「默认参数」：测试 apikey 累积历史订单 57 万条
 * （pforder 实测 total=577548），任何一条绕过这个闸的路径都会去拉 9/20 之前的海量数据，
 * 打爆上游且毫无业务价值（站点 2026-09-20 才上线）。
 * 所以：**所有拉取路径（定时器 / 手动 / backfill）统一在此收口**，谁也别想绕过。
 *
 * 例外：`opts.tbWindow` 是 tb存量修复专用（2026-09-23 pay_price=0），调用方显式指定，
 * 允许精确到任意历史区间，但仍不允许早于本常量。
 */
const SYNC_SINCE = new Date('2026-09-20T00:00:00+08:00');

/** 把起点收敛到 SYNC_SINCE 之后（所有 fetcher 调用前的唯一入口） */
function clampSince(start: Date): Date {
  return start.getTime() < SYNC_SINCE.getTime() ? new Date(SYNC_SINCE) : start;
}

/**
 * 常规窗口（满足各平台时间窗限制）：jd 1h / tb 3h / pdd 24h / vip 2h
 *
 * ⛔ **pf 必须 720h（30天）**（2026-10-04 实测铁证）：
 *   pforder 的 querytype=2 是按 **updated_at（状态更新时刻）** 筛窗口的。
 *   D先生点名的饿了么单 `4064786215607488142`：updated_at = 2026-10-01T03:32Z，
 *   距实测时刻 **77.8 小时** —— 而当时窗口是 72h，**只差 5.8 小时就被切掉**。
 *   扫窗口宽度实测：72h→0 单/ 80h→1 单 / 168h→1 单 / 720h→1 单。
 *
 *   ⚠️ 这不是「刚好差一点」的偶发，而是**必然漏单**：
 *   一单只要状态最后一次更新距今超过窗口，就永远不会被拉到 ——
 *   无论同步跑多少次。实测 local 桶 928 单中 875 单是「2023 年下单、近天才更新状态」，
 *   固定窄窗口会漏掉其中绝大多数。
 *
 *   成本可控：pf 30 天窗口 total 远小于「按天分段全量回填」，且水位机制（见 syncWatermark）
 *   会把已同步后的窗口自动收窄到「水位−6h」，不会每轮都重扫 30 天。
 *
 * 结算滞后实测：下单→结算更新 p50=295h(12天)、p95=516h(21天)、max=760h(31天)，
 * 30 天窗口刚好覆盖 p95，尾部 31 天的极少数由「9/20 起按天回填」兜底。
 *
 * ⚠️ **dc/movie/recharge 给 720h**：实测这三类单量极低（点餐 72h 仅 1 单、
 *   影票 0 单、充值 9/20 后 0 单），窗口窄了等于没跑。30 天能把几乎所有真实单覆盖到。
 */
function windowHours(provider: string): number {
  switch (provider) {
    case 'jd':
      return 1;
    case 'tb':
      return 3;
    case 'pdd':
      return 24;
    case 'vip':
      return 2;
    case 'pf':
    case 'dc':
    case 'movie':
    case 'recharge':
      return 720;
    default:
      return 2;
  }
}

/**
 * 每站点的「已同步水位」：该站点某个 provider 已落库的**最大 platform_updated_at**。
 *
 * ⛔ 为什么必须有水位（2026-10-04 用户指出饿了么单缺失后定位到的结构性缺陷）：
 *   pforder/recharge 的窗口是按 **updated_at（状态更新时刻）** 筛的，
 *   而库里存的是 ordertime（下单时刻）。二者错位 12~31 天。
 *   于是「按固定 N 小时窗口拉」必然漏单：一单只要状态最后一次更新距今超过窗口，
 *   它就永远不会被拉到 —— 不是这一次的偶发，是**每次都漏**。
 *   （实测 D先生 点名的饿了么单 4064786215607488142，updated_at 距今 77.8h，
 *     当时窗口 72h，只差 5.8h 被切掉；扫宽度：72h→0 / 80h→1 / 720h→1。）
 *
 * 修法：窗口起点取 `max(固定窗口, 已同步水位 − 6h 重叠)`。
 *   - 重叠量 6h 覆盖「上次拉到一半就断」（网关无事务，可能半途失败）。
 *   - 水位只增不减 → 不会越拉越短。
 *   - 水位比固定窗口更近时用固定窗口（避免无意义回扫）。
 *   - ⚠️ 水位钳到「不超过 now」：上游时钟可能超前，否则窗口起点会跑到未来、拉回 0 行。
 */
async function syncWatermark(siteId: string, provider: string): Promise<Date | null> {
  const { rows } = await pool.query(
    `SELECT max(platform_updated_at) AS mx FROM "order"
      WHERE site_id = $1 AND provider = ANY(string_to_array($2, ','))`,
    [siteId, providerBucketsOf(provider).join(',')]
  );
  const v = rows[0]?.mx;
  if (!v) return null;
  const t = new Date(v as string);
  const now = Date.now();
  return t.getTime() > now ? new Date(now) : t;
}

/** provider 落库桶集合：pforder 的单已按 pf_type 改写桶名，查询要用全桶 */
function providerBucketsOf(provider: string): string[] {
  return provider === 'pf' ? PF_TYPE_PROVIDER_BUCKETS : [provider];
}


/** 蚂蚁 4 类的 provider（pforder 是唯一免签的；dc/recharge/movie 需要 api_secret） */
const MAYI_PROVIDERS: string[] = ['pf', 'dc', 'recharge', 'movie'];
const MAYI_SIGNED = new Set(['dc', 'recharge', 'movie']);

/**
 * 拉取窗口：
 *  - 默认：各平台按windowHours 取近N 小时增量。
 *  - opts.tbWindow：tb 存量回填专用（2026-09-23 pay_price=0 修复），指定时只跑 tb。
 *  - opts.backfillSince：蚂蚁 4 类历史订单回填（2026-10-03）。测试apikey 累积订单
 *    57 万条（pforder 实测），一次性拉会打爆上游 → **必须按天分段**，逐日 upsert（幂等可重入）。
 */
export async function runOrdersync(
  siteCode = 'site-a',
  opts?: { tbWindow?: { start: Date; end: Date }; backfillSince?: Date; backfillProviders?: string[] },
): Promise<SyncStats> {
  const cfg = await resolveHjkConfig(siteCode);
  const { rows: siteRows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [siteCode]);
  if (!siteRows[0]) throw new Error(`站点不存在：${siteCode}`);
  const siteId = String(siteRows[0].site_id);

  const end = new Date();
  const stats: SyncStats = { site: siteCode, window: { start: '', end: '' }, platforms: {}, settled: 0, chargedBack: 0 };
  stats.window.end = end.toISOString();
  resetPfSkipCount();

  for (const [provider, fetcher] of Object.entries(FETCHERS)) {
    const stat: PlatformStat = { fetched: 0, upserted: 0 };
    // 动态 SKIP：签名类接口未配置 api_secret 时整类跳过（静态 SKIP 表已移除误判的SIGN_REQUIRED）
    if (MAYI_SIGNED.has(provider) && !cfg.apiSecret) {
      stat.skipped = 'API_SECRET_NOT_CONFIGURED';
      stats.platforms[provider] = stat;
      continue;
    }

    let start: Date;
    // 窗口终点用**每轮局部变量**：旧代码复用了外层 fetchEnd，tbWindow 模式下一旦某平台
    // 改写了它就会污染后续平台（隐性跨轮污染，改成局部后物理上不可能发生）。
    let fetchEnd = end;
    const isMayi = MAYI_PROVIDERS.includes(provider);
    const backfillTargets = opts?.backfillSince && isMayi
      ? opts.backfillProviders ?? MAYI_PROVIDERS
      : null;

    if (opts?.tbWindow) {
      if (provider !== 'tb') {
        stat.skipped = 'BACKFILL_WINDOW';
        stats.platforms[provider] = stat;
        continue;
      }
      start = opts.tbWindow.start;
      fetchEnd = new Date(opts.tbWindow.end);
    } else if (backfillTargets && !backfillTargets.includes(provider)) {
      stat.skipped = 'BACKFILL_SCOPE';
      stats.platforms[provider] = stat;
      continue;
    } else {
      // 固定窗口
      start = new Date(end.getTime() - windowHours(provider) * 3_600_000);
      // ⛔ 水位续拉（D先生 2026-10-04「饿了么订单为何也不同-sync」的结构性修复）：
      //   上游按 updated_at 筛、库里按下单时间存，两者错位 12~31 天 →
      //   固定窗口每轮都会漏掉「下单超窗口且状态未再变动」的单。
      //   起点取 max(固定窗口, 已同步水位 - 6h 重叠)，水位单调递增故不会越拉越短。
      //
      //   ⚠️ 但水位只能用于**宽窗口平台**（pf/dc/movie/recharge）。
      //      jd 硬限制「查询时间范围不超过 1 小时」（实测报 UPSTREAM_BUSINESS
      //      「无效请求-查询时间范围超过1小时」），水位重叠加固定窗口会突破它 → 必须跳过。
      if (!opts?.backfillSince && !opts?.tbWindow && WATERMARK_PROVIDERS.has(provider)) {
        const wm = await syncWatermark(siteId, provider);
        if (wm) {
          const overlapped = new Date(wm.getTime() - 6 * 3_600_000);
          if (overlapped.getTime() < start.getTime()) start = overlapped;
        }
      }
    }
    // ⛔ 统一收口：任何路径的起点都不得早于 SYNC_SINCE（2026-09-20）
    start = clampSince(start);
    if (start.getTime() >= fetchEnd.getTime()) {
      // 窗口被夹空（当前时间早于 SYNC_SINCE，不可能有订单）
      stat.skipped = 'BEFORE_SYNC_SINCE';
      stats.platforms[provider] = stat;
      continue;
    }

    if (provider === 'jd') stats.window.start = start.toISOString();
    try {
      if (backfillTargets?.includes(provider) && opts?.backfillSince) {
        // 按天分段回填（幂等 upsert，重复跑安全）
        // ⚠️ 串行 15 天会跑爆网关超时（实测 60s 挂 500）→ 段间并发 4 路。
        //    并发只让等待重叠，上游限流器仍是串行队列，不加压上游。
        const dayMs = 24 * 3_600_000;
        const segs: Array<{ from: Date; to: Date }> = [];
        for (let cur = clampSince(opts.backfillSince); cur < fetchEnd; ) {
          const segEnd = new Date(Math.min(cur.getTime() + dayMs, fetchEnd.getTime()));
          segs.push({ from: new Date(cur.getTime()), to: segEnd });
          cur = segEnd;
        }
        for (let i = 0; i < segs.length; i += SEGMENT_CONCURRENCY) {
          const batch = segs.slice(i, i + SEGMENT_CONCURRENCY);
          const results = await Promise.all(batch.map((s) => fetcher(cfg.apikey, s.from, s.to)));
          for (const orders of results) {
            if (orders.length) {
              stat.fetched += orders.length;
              stat.upserted += await upsertOrders(siteId, orders);
            }
          }
        }
        stat.segments = segs.length;
      } else {
        // ⚠️ pf 的 720h 窗口行数远超 MAX_PAGES×100，单次拉会被页数上限**静默截断**（= 漏单）。
        //    故宽窗口类（pf/dc/movie/recharge）一律按天分段：每段独立翻页、幂等 upsert。
        //
        //    ⚠️ 但30 天 = 30 段串行会跑爆网关/容器超时（实测 60s 挂 500）。
        //    修法：① 单轮最多跑 SEGMENT_BUDGET 天（其余交给下一次定时器，30min 一轮自然收敛）；
        //          ② 段间并发 4 路（上游限流器本身是串行队列，并发只是让等待重叠，不加压上游）。
        const hours = windowHours(provider);
        if (hours >= 720 && fetchEnd.getTime() - start.getTime() > 24 * 3_600_000) {
          const dayMs = 24 * 3_600_000;
          // 从最新一天往回填：最新段优先拿到，旧的留给下一轮（避免每轮都在扫最老的一段）
          const segs: Array<{ from: Date; to: Date }> = [];
          for (let cur = fetchEnd; cur > start; ) {
            const segFrom = new Date(Math.max(cur.getTime() - dayMs, start.getTime()));
            segs.unshift({ from: segFrom, to: new Date(cur.getTime()) });
            cur = segFrom;
            if (segs.length >= SEGMENT_BUDGET) break;
          }
          let done = 0;
          for (let i = 0; i < segs.length; i += SEGMENT_CONCURRENCY) {
            const batch = segs.slice(i, i + SEGMENT_CONCURRENCY);
            const results = await Promise.all(batch.map((s) => fetcher(cfg.apikey, s.from, s.to)));
            for (const orders of results) {
              if (orders.length) {
                stat.fetched += orders.length;
                stat.upserted += await upsertOrders(siteId, orders);
              }
            }
            done += batch.length;
          }
          stat.segments = done;
        } else {
          const orders = await fetcher(cfg.apikey, start, fetchEnd);
          stat.fetched = orders.length;
          stat.upserted = await upsertOrders(siteId, orders);
        }
      }
    } catch (e) {
      // HttpError：message=错误码、code=上游原始信息（项目构造约定），拼出可读错误
      const he = e as { message?: string; code?: string };
      stat.error = [he.message, he.code && he.code !== he.message ? he.code : ''].filter(Boolean).join(' | ');
    }
    // pf_type 让位 v1 的丢弃数（旁路计数器回传）
    const pfSkipped = takePfSkipCount();
    if (pfSkipped > 0) stat.skippedByPfType = pfSkipped;
    stats.platforms[provider] = stat;
  }

  stats.settled = await settleDue(siteId, PROVIDERS);
  stats.chargedBack = await chargebackDue(siteId, PROVIDERS);
  return stats;
}
