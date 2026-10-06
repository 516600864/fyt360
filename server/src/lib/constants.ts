// 全局业务常量（单一真相源，禁止散落硬编码）
// INGOT_PER_YUAN：元宝返还比例，决策 #21（2026-09-19 D先生确认）：默认 1元=100元宝（5,000 元宝 ≈ ¥50 自购消费解锁 L2）。
// 后台可配后置：未来接 site 级配置项时从此处收敛为读配置。
export const INGOT_PER_YUAN = 100;

/** INVITE_REWARD：邀请新用户绑定成功后，邀请人一次性奖励元宝数（画布 25 活动规则口径） */
export const INVITE_REWARD_INGOT = 500;

// ---------------- 订单 provider 分类（单一真相源） ----------------
// ⚠️ D先生 2026-10-04 定：订单落库类型与**蚂蚁星球 pf_type 保持一致**。
//   pforder 是「平台活动」聚合接口，pf_type 才是真正的平台归属；其中
//   1/2/3/6（京东/拼多多/淘宝/唯品会）与 v1 联盟接口的 jd/pdd/tb/vip 是**同一批钱
//   的两个视角**，复用同桶天然去重，避免同一笔佣金被算两遍。
//   完整映射见 server/src/jobs/ordersync.ts 的 PF_TYPE_PROVIDER。
//
//   ⚠️ 新增 provider 桶时**必须同步这里**，否则订单中心的tab 会漏数据。
export const PROVIDER_CPS = [
  'jd', 'tb', 'pdd', 'vip',      // 联盟接口 + 蚂蚁 pf_type 1/2/3/6 复用
  'meituan',                       // pf_type 7/13/16 美团分销联盟/美团联盟/美天赚
  'eleme',                         // pf_type 30 饿了么
  'didi',                          // pf_type 31 滴滴
  'local',                         // pf_type 32 吃喝玩乐周边
  'liucard',                       // pf_type 34 流量卡
  'fzy',                           // pf_type 40 飞猪
  'ks',                            // pf_type 15 快手
  'other',                         // pf_type 14 其他
] as const;

/** 积分兑换（蚂蚁星球自有业务，订单中心单列一个 tab） */
export const PROVIDER_INGOT = ['dc', 'recharge', 'movie'] as const;

/** SQL 用逗号串（网关对数组参数绑定不可靠，统一走 string_to_array） */
export const CPS_PROVIDERS_SQL = PROVIDER_CPS.join(',');
export const INGOT_PROVIDERS_SQL = PROVIDER_INGOT.join(',');

// ---------------- 订单中心筛选台（admin-32B，2026-10-04） ----------------
/**
 * 时间口径三选一（决策 #42，D先生拍板默认 paid_at）。
 * ⛔ 三个时间语义完全不同（paid_at=下单 / settled_at=平台结算到账 / platform_updated_at=上游状态更新），
 *    结算滞后 p50=12 天、max=31 天，筛哪个必须显式声明，不能默认混用 created_at。
 * ⚠️ 实测坑：自营单有 24 笔 paid_at 为 NULL（未付款/已关闭），切到 paid_at 口径会漏掉它们 →
 *    UI 必须标注这一点，不能让用户以为「切口径单数变少 = 数据丢了」。
 */
export const TIME_FIELDS = {
  paid_at: { column: 'paid_at', label: '下单时间', hint: '用户下单的时刻 · 找单习惯锚点' },
  settled_at: { column: 'settled_at', label: '结算时间', hint: '佣金进入结算的 · 对账场景常用' },
  platform_updated_at: { column: 'platform_updated_at', label: '上游更新', hint: '平台状态变更的 · 查跟单延迟' },
} as const;
export type TimeFieldKey = keyof typeof TIME_FIELDS;
export const DEFAULT_TIME_FIELD: TimeFieldKey = 'paid_at';

/** 白名单校验：非法 time_field 一律回落到默认，杜绝 SQL 注入面。 */
export function resolveTimeField(raw: unknown): TimeFieldKey {
  const s = String(raw ?? '');
  return (s in TIME_FIELDS ? s : DEFAULT_TIME_FIELD) as TimeFieldKey;
}

/**
 * 类型下拉 6 组 13 项（admin-32B 设计稿）。
 *
 * ⚠️ 设计稿的单数是 2026-10-04 某时段快照，与真实库存在 3 处偏差，已按真实库订正并记录：
 *   ① 「虚拟服务」组把 `recharge`(权益充值) 和 `dc/movie`(点餐/电影票) 混在一起是**错的口径**：
 *      dc/movie/recharge 在 PROVIDER_INGOT 里是独立业务，拆到「本地生活」组更符合真实语义。
 *   ② 真实库存在 `local`(吃喝玩乐周边 pf_type 32) 与 `fzy`(飞猪 pf_type 40) 两桶，
 *      设计稿 13 项没有它们 → 补进「本地生活」组(fzy 归电商) 否则这 1026 单筛不出来。
 *   ③ 「积分兑换（蚂蚁星球）」在 order 表没有独立 provider 值，落在 PROVIDER_INGOT 桶内
 *      → value 用 ingot 聚合 dc/movie/recharge 三桶，语义=蚂蚁星球侧订单全集。
 *
 * 值与 provider 桶的映射关系单一真相源：前端只认 value，后端只认 providers 数组。
 */
export const TYPE_FILTER_GROUPS: Array<{
  key: string;
  label: string;
  items: Array<{ value: string; label: string; providers: string[] }>;
}> = [
  {
    key: 'self',
    label: '自营类',
    items: [{ value: 'self', label: '到店团购', providers: ['self'] }],
  },
  {
    key: 'ecommerce',
    label: '电商平台',
    items: [
      { value: 'jd', label: '京东', providers: ['jd'] },
      { value: 'tb', label: '淘宝', providers: ['tb'] },
      { value: 'pdd', label: '拼多多', providers: ['pdd'] },
      { value: 'vip', label: '唯品会', providers: ['vip'] },
      { value: 'fzy', label: '飞猪', providers: ['fzy'] },
    ],
  },
  {
    key: 'local',
    label: '本地生活',
    items: [
      { value: 'meituan', label: '美团', providers: ['meituan'] },
      { value: 'eleme', label: '饿了么', providers: ['eleme'] },
      { value: 'dc', label: '点餐', providers: ['dc'] },
      { value: 'movie', label: '电影票', providers: ['movie'] },
      { value: 'local', label: '本地生活(周边)', providers: ['local'] },
    ],
  },
  {
    key: 'transit',
    label: '出行',
    items: [{ value: 'didi', label: '滴滴', providers: ['didi'] }],
  },
  {
    key: 'virtual',
    label: '虚拟服务',
    items: [
      { value: 'recharge', label: '权益充值', providers: ['recharge'] },
      { value: 'liucard', label: '流量卡', providers: ['liucard'] },
      { value: 'ingot', label: '积分兑换（蚂蚁星球）', providers: ['dc', 'recharge', 'movie'] },
    ],
  },
];

/** value → providers 展平表（后端筛选用）。ingot 是聚合项，与 dc/recharge/movie 有重叠，
 *  语义上=「蚂蚁星球侧订单全集」，与页签 tab=ingot 完全同口径（决策 #41 口径不打架）。 */
export const TYPE_FILTER_ITEMS: Record<string, string[]> = Object.fromEntries(
  TYPE_FILTER_GROUPS.flatMap((g) => g.items.map((i) => [i.value, i.providers])),
);

/** 状态 3 段（admin-32B 设计稿：支付段 / 履约段 / 退款段）。
 *  ⛔ 已删「待发货 / 已发货」——真实库恒 0 条（决策 #29 起 fulfillment 只到店团购 group，
 *    全库实测：已结算3720/已付款2262/已退款590/已关闭399/已核销3/待核销1，其余全 0）。
 *    这两个是纯死选项，留着只会让人以为筛选器坏了。 */
export const STATUS_FILTER_SEGMENTS: Array<{
  key: string;
  label: string;
  hint: string;
  items: string[];
}> = [
  {
    key: 'pay',
    label: '支付段',
    hint: '钱有没有进来',
    items: ['待支付', '已付款', '已结算', '已关闭'],
  },
  {
    key: 'fulfill',
    label: '履约段',
    hint: '货/券有没有交付',
    items: ['待核销', '已核销', '已收货'],
  },
  {
    key: 'refund',
    label: '退款段',
    hint: '有没有退',
    items: ['退款审核中', '已退款', '部分退款'],
  },
];

/** 状态白名单（防注入：只有这 9 个文案可进 SQL 比对） */
export const STATUS_WHITELIST: string[] = STATUS_FILTER_SEGMENTS.flatMap((s) => s.items);
