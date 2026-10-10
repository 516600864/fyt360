// mini-29 AI 助手（决策 #46/#47，D先生 2026-10-07 定稿）
//
// 分层管线（成本核心）：
//   L0 粘贴解析  输入含商品链接/口令 → 纯正则提取参数 → 直接转链        0 token
//                实测契约（2026-10-07 探针，D先生 实调锁定）：
//                  jd 仅 3.cn 短链整链透传（goods_id=短链 & type=3，响应带 we_app_info）；
//                  item.jd.com 数字 sku 上游 -200 materialId 不合规且无反查端点 → 引导文案；
//                  tb item_id 接受整段口令文案（含【淘宝】前缀照转不误）；pdd/vip 同前。
//   L1 快捷直达  前端 chips/推荐问题点击带 chip 元数据 → 直接 service-card 0 token
//   L2 LLM 意图  自由文本 → hy3 输出严格 JSON 意图 → 服务端白名单执行    1 次模型调用
//   L3 兜底      L2 解析失败/意图不明 → 静态推荐问题引导                 0（不重试）
//
// ⛔ 红线（#46 §3.2）：AI 不生成任何商品数据（价格/券额/链接/返利），只输出调用参数；
//    商品卡内容一律取真实 API 响应。返利数字 = 上游商品 commission（实测 jd/tb/pdd 均有，
//    2026-10-07 探针）× 用户 member_level.self_rate（自购比例）—— 未登录/无等级/无佣金
//    字段一律隐藏该元素（D先生 裁决：不呈现 100% 佣金，绝不编数）。
//
// 隔离：user_id + site_id（同收藏/足迹口径）；留存 200 条/30 天写入时 prune（决策 #41 同款，
//   ⛔ 不挂 cron —— cron.ts 是 M1 空壳）。站长/平台超管均无查询端点。
import { Router, type Request, type Response } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { hjkCall, extractList, normalizeGoods } from '../lib/haojingke.js';
import { resolveHjkConfig, resolveProvider } from '../lib/provider.js';
import { chatComplete } from '../lib/llm.js';
import { msgSecCheck } from '../lib/wechat.js';
import { writeAudit } from '../lib/audit.js';
import { buildListParams } from './goods.js';
import { buildLinkParams, injectPromoter, extractLink, unionConvert, type LinkResult, type UnionConvertResult } from './link.js';
import { aggregateServiceSearch } from './site.js';
import { optionalUser, requireUser } from '../middleware/auth.js';

export const chatRouter = Router();

// token 解析（clogin JWT → req.user）；不挂 optionalUser 则 requireUser 永远 401（me.ts 同款前车之鉴）
chatRouter.use(optionalUser);

const DAILY_LIMIT = 50;      // 每用户每日消息数（#46 §4.3，上线看数据再调）
const RETAIN_ROWS = 200;     // 留存硬上限（同足迹 #41）
const RETAIN_DAYS = 30;
const CONTEXT_ROUNDS = 6;    // LLM 上下文只带最近 6 轮
const LLM_TIMEOUT_MS = 15_000;
const LLM_MAX_TOKENS = 2000; // hy3 混合推理：reasoning 与正文共享预算，1200 实测被 reasoning 烧光（llm.ts 2026-10-04 踩坑）

// ── SSE 输出 ────────────────────────────────────────────────────────────────

function sseWrite(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── 限流 / prune / 历史落库 ─────────────────────────────────────────────────

async function assertQuota(siteId: string, userId: number): Promise<void> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM chat_message
      WHERE user_id = $1::bigint AND site_id = $2::uuid AND role = 'user'
        AND created_at >= date_trunc('day', now())`,
    [String(userId), siteId],
  );
  if (rows[0].n >= DAILY_LIMIT) {
    throw new HttpError(429, `今日对话已达 ${DAILY_LIMIT} 条上限，明天再来吧`, 'CHAT_QUOTA_EXCEEDED');
  }
}

/** prune-on-write（决策 #41 足迹同款）：只清本人本站，量小无压力 */
async function pruneChat(siteId: string, userId: number): Promise<void> {
  await pool.query(
    `DELETE FROM chat_message
      WHERE user_id = $1::bigint AND site_id = $2::uuid
        AND (created_at < now() - ($3::text || ' days')::interval
             OR id NOT IN (
               SELECT id FROM chat_message
                WHERE user_id = $1::bigint AND site_id = $2::uuid
                ORDER BY created_at DESC LIMIT $4))`,
    [String(userId), siteId, String(RETAIN_DAYS), RETAIN_ROWS],
  );
}

async function saveMessage(
  siteId: string, userId: number, sessionId: string,
  role: 'user' | 'assistant', kind: string, content: string, meta: unknown,
): Promise<void> {
  await pool.query(
    `INSERT INTO chat_message (user_id, site_id, session_id, role, kind, content, meta)
     VALUES ($1::bigint, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::jsonb)`,
    [String(userId), siteId, sessionId, role, kind, content, meta ? JSON.stringify(meta) : null],
  );
  await pruneChat(siteId, userId);
}

// ── 返利：用户可得分佣 ─────────────────────────────────────────────────────

/** 用户自购佣金比例（member_level.self_rate）；无等级 → 0 → 前端隐藏返利元素 */
async function userSelfRate(userId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(ml.self_rate, 0)::float AS rate
       FROM member m LEFT JOIN member_level ml ON ml.level_id = m.level_id
      WHERE m.user_id = $1::bigint LIMIT 1`,
    [String(userId)],
  );
  return Number(rows[0]?.rate ?? 0);
}

/** 上游佣金（实测 jd/tb/pdd 条目均有 commission 元字段；vip camelCase 防御式取）→ 用户可得 */
function userRebate(raw: Record<string, unknown> | undefined, selfRate: number): number | null {
  if (!raw || selfRate <= 0) return null;
  const c = Number(raw.commission ?? raw.Commission ?? 0);
  if (!Number.isFinite(c) || c <= 0) return null;
  const amt = Math.round(c * selfRate * 100) / 100;
  return amt > 0 ? amt : null;
}

// ── L0 粘贴解析（纯正则，0 token；2026-10-09 万能转链改造后缩编）───────────
// 平台判定权交上游（open/union text 整段透传，D先生 钦定「反对狭隘启发式」）：
//   本函数只做两件事——①认出「tb 强信号」走旧接口（唯一带佣金 commission 的通道）；
//   ②粗判「疑似转链输入」（含 URL 或口令结构）→ 万能通道，pf 从响应拿。
// 旧 jd 数字 sku -200 限制已解除（probe-union5 实锤：根因是 extend_id 缺失，补上全形态可转）。

interface ParsedRef {
  /** 万能通道 text（整段原文透传） */
  text: string;
  /** tb 旧接口通道参数（强信号才命中：佣金 + get_tkl 淘口令）；失败自动回落万能接口补刀 */
  tbLegacy?: Record<string, string>;
  /** 原话（29C 跨平台搜词兜底：响应无商品名时取「」段） */
  hint?: string;
  /** 弱信号（口令结构但无 URL）：转链失败不吞消息，回落 L1.5/L2 保住搜索意图 */
  weak?: boolean;
}

function parseRef(text: string): ParsedRef | null {
  const t = text.trim();
  if (!t) return null;
  // ── tb 强信号：旧接口优先 ──
  // ① tb 域链 / ￥…￥ 经典包裹 / 平台码+令牌（￥包裹、斜杠式都只是已知形态子集）
  let m = t.match(/(?:item\.taobao|detail\.tmall)\.com\/item[^#]*?\?id=(\d+)/);
  if (m) return { text: t, tbLegacy: { item_id: m[1] }, hint: t };
  if (/(e\.tb\.cn|m\.tb\.cn|taobao\.com|tmall\.com)/i.test(t) || /[￥¥][^￥¥]{5,}[￥¥]/.test(t)
    || /\b(?:CZ|HU|MF|FU)\d{3}[\s/·]+[A-Za-z0-9]{9,13}\b/.test(t)) {
    return { text: t, tbLegacy: { item_id: t }, hint: t };
  }
  // ② 弱信号：淘口令核心是 9~13 位 base62 混杂令牌（三类字符齐备的随机串在正常中文里几乎不出现）
  const tokens = t.match(/\b[A-Za-z0-9]{9,13}\b/g) ?? [];
  const tokenish = tokens.some((k) => /[A-Z]/.test(k) && /[a-z]/.test(k) && /\d/.test(k));
  if (tokenish && /(淘|taobao|tmall|口令)/i.test(t)) {
    return { text: t, tbLegacy: { item_id: t }, hint: t, weak: true };
  }
  // ── 其余疑似转链输入 → 万能通道（整段透传，上游裁决）──
  // URL=强信号（失败诚实收尾）；纯口令结构=弱信号（失败回落 L2 保住搜索）。
  // jd/pdd/vip/美团全部形态（u.jd.com、3.cn、item.jd.com、p.pinduoduo.com、t.vip.com、
  // dpurl.cn、u.ele.me、axr://…）不再逐一枚举——统一交上游识别。
  const hasUrl = /https?:\/\/[^\s「」『』]+/i.test(t);
  const hasToken = tokens.some((k) => /[A-Z]/.test(k) && /\d/.test(k) && k.length >= 9);
  if (hasUrl || hasToken) return { text: t, hint: t, weak: !hasUrl };
  return null;
}

/** 转链响应里的商品信息（29C 登机牌 52 图位数据源；实测仅 tb getunionurl 自带） */
interface ConvertGoods { title: string; price: number | null; finalPrice: number | null; coupon: number | null; pic: string }

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 转链执行（2026-10-09 万能转链改造）：
 *  - tb 强信号 → 旧接口 getunionurl（唯一带 commission 的通道，返利展示不丢），
 *    失败自动回落万能接口补刀（上游可能解出旧接口拒收的失效口令）；
 *  - 其余一切 → 万能接口 text 整段透传（pf 响应驱动，extend_id=userId 归因）。
 *  返货 rebate：仅旧 tb 通道有上游佣金；万能通道响应无佣金字段 → null（前端隐藏，绝不编数）。
 *  goods：tb 旧响应自带全套；万能响应带 goods_name/goods_price/goods_pic（jd/pdd 实测）。 */
async function doConvert(
  ref: ParsedRef, userId: number,
): Promise<{ link: LinkResult & { platform: string }; rebate: number | null; goods?: ConvertGoods }> {
  const cfg = await resolveHjkConfig(undefined);
  if (ref.tbLegacy) {
    try {
      return await legacyConvert(ref.tbLegacy, userId, cfg.apikey);
    } catch (legacyErr) {
      // 旧接口拒绝（103 系失效等）→ 万能接口补刀；仍失败则**抛旧接口原始错误**——
      //   旧错误带语义（103→「不支持该商品id」），万能外层只有泛化「转链失败」，
      //   盖掉它会把诚实降级文案退化成「重试也没用」的万金油（E2E 2026-10-09 实锤）。
      try {
        const u = await unionConvert(ref.text, String(userId || '1'), cfg.apikey);
        return unionToCard(u);
      } catch {
        throw legacyErr;
      }
    }
  }
  const u = await unionConvert(ref.text, String(userId || '1'), cfg.apikey);
  return unionToCard(u);
}

/** 旧接口通道（tb 专属：佣金 + get_tkl 淘口令富信息） */
async function legacyConvert(
  params: Record<string, string>, userId: number, apikey: string,
): Promise<{ link: LinkResult & { platform: string }; rebate: number | null; goods?: ConvertGoods }> {
  const p = buildLinkParams('tb', params);
  if (userId > 0) injectPromoter('tb', p, userId);
  const { payload } = await hjkCall('tb/getunionurl', p, apikey);
  const link = extractLink('tb', payload);
  const selfRate = await userSelfRate(userId);
  const d = (typeof payload.data === 'object' && payload.data !== null ? payload.data : {}) as Record<string, unknown>;
  const rebate = userRebate(d, selfRate);
  let goods: ConvertGoods | undefined;
  if (d.goods_name) {
    goods = {
      title: String(d.goods_name),
      price: toNum(d.price),
      finalPrice: toNum(d.price_after) ?? toNum(d.price),
      coupon: toNum(d.discount),
      pic: String(d.picurl ?? ''),
    };
  }
  return { link: { platform: 'tb', ...link }, rebate, goods };
}

/** 万能响应 → 登机牌数据（pf 平台由响应驱动；返利字段上游不给 → null） */
function unionToCard(u: UnionConvertResult): { link: LinkResult & { platform: string }; rebate: number | null; goods?: ConvertGoods } {
  return {
    link: { platform: u.platform, url: u.url, tkl: u.tkl, miniAppId: u.miniAppId, miniPath: u.miniPath, vipWxUrl: u.vipWxUrl },
    rebate: null,
    goods: u.goods,
  };
}

// ── 29C 同款跨平台出票 ─────────────────────────────────────────────────────

interface CrossItem {
  platform: string; id: string; sign?: string; title: string;
  price: number | null; finalPrice: number | null; coupon: number | null;
  pic: string; rebate: number | null;
}

/** 口令/商品名 → 搜索关键词：口令文案优先取「」内商品名，剥促销括号，截 30 字 */
function cleanKeyword(title: string): string {
  let t = String(title ?? '');
  const quoted = t.match(/「([^」]{4,})」/);
  if (quoted) t = quoted[1];
  return t
    .replace(/【[^】]*】/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
}

/** 同款跨平台搜索（29C「同款其他平台也出票」）：四平台列表契约与 /api/goods/list 完全同源
 *  （jd/tb/pdd goodslist + vip goodsquery，D先生 2026-10-08 重申契约），各轨取首条。
 *  单轨失败静默降级（allSettled 隔离），全部失败返回空数组不阻塞主卡。 */
async function crossPlatformGoods(keyword: string, exclude: string, userId: number): Promise<CrossItem[]> {
  const kw = cleanKeyword(keyword);
  if (kw.length < 4) return []; // 过短词全平台泛搜无意义，宁缺勿滥
  const cfg = await resolveHjkConfig(undefined);
  const selfRate = await userSelfRate(userId);
  const platforms = (['jd', 'tb', 'pdd', 'vip'] as const).filter((p) => p !== exclude);
  const results = await Promise.allSettled(platforms.map(async (p): Promise<CrossItem | null> => {
    const params = buildListParams(p, { keyword: kw, page: '1', size: '1' });
    const endpoint = p === 'vip' ? 'vip/goodsquery' : `${p}/goodslist`;
    const { payload } = await hjkCall(endpoint, params, cfg.apikey);
    const { items } = extractList(p, payload, 1);
    if (!items.length) return null;
    const it = items[0] as Record<string, unknown>;
    const g = normalizeGoods(p, it);
    if (!g.id || !g.title) return null;
    return {
      platform: p,
      id: g.id,
      sign: p === 'pdd' ? (String(it.goods_sign ?? '') || undefined) : undefined,
      title: g.shortTitle || g.title,
      price: g.price, finalPrice: g.finalPrice, coupon: g.coupon, pic: g.pic,
      rebate: userRebate(it, selfRate),
    };
  }));
  return results.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
}

// ── L2 意图协议（#46 §3.1：JSON 约束，不依赖 function calling）─────────────

type ToolName = 'search_goods' | 'goto_service' | 'convert_link' | 'chit_chat';

const INTENT_SYSTEM = `你是本站 AI 助手。用户消息进来后，你必须只输出一个 JSON 对象，禁止输出任何其他文字、markdown 或解释。格式：{"tools":[{"tool":"工具名","args":{...}}]}
tools 数组按用户话里的需求顺序列出**全部**意图：单一需求只放 1 个；复合需求（一句话含多个动作/目的地）必须拆成多个意图，上限 3 个。可选工具：

搜商品：{"tool":"search_goods","args":{"platform":"jd|tb|pdd|vip","keyword":"关键词"}}
站内服务：{"tool":"goto_service","args":{"name":"品牌或服务名"}}
转链接：{"tool":"convert_link","args":{"ref":"用户提供的链接/口令/文案原文整段"}}
寒暄兜底：{"tool":"chit_chat","args":{"reply":"50字内的简短友好回复"}}（chit_chat 只能单独出现，禁止与其他工具并列）

规则：
1. 用户想找优惠/商品/券 → search_goods（platform 按常识选，不确定选 jd）。
2. 用户提到点餐/外卖/打车/看电影/买电影票/充会员/充视频VIP/领红包等生活服务或权益 → goto_service，name 必须用用户原话里的核心词（如「打车」「麦当劳」「电影票」「腾讯视频」），禁止自行改写成别的品牌名。
3. 用户给了链接、口令或带下单链接的文案要转链 → convert_link（ref=原话整段，平台识别由转链服务自行完成）。
4. 元宝/积分兑换/提现/改密码等站内账户操作 → chit_chat 回复引导去「我的」页。注意：充视频VIP、买会员属于权益服务（走规则2），不是账户操作。
5. 闲聊问候 → chit_chat。reply 不编造价格、佣金、库存。
6. 复合需求拆解示例：「肚子饿了，打个车去吃个麦当劳」→ {"tools":[{"tool":"goto_service","args":{"name":"打车"}},{"tool":"goto_service","args":{"name":"麦当劳"}}]}；「充个腾讯视频再搜下耳机」→ tools=[goto_service 腾讯视频, search_goods 耳机]。`;

interface Intent { tool: ToolName; args: Record<string, unknown> }

/** hy3 输出 → 严格 JSON 校验（**多意图数组协议**，2026-10-10 方案 A：复合句拆多意图，上限 3）；
 *  兼容旧单意图格式 {"tool":...}；任何畸形返回 []（进 L3，失败不重试超 1 次） */
async function llmIntent(history: { role: 'user' | 'assistant'; content: string }[], message: string): Promise<Intent[]> {
  const messages = [
    { role: 'system' as const, content: INTENT_SYSTEM },
    ...history.slice(-CONTEXT_ROUNDS * 2),
    { role: 'user' as const, content: message },
  ];
  try {
    const r = await chatComplete(messages, { timeoutMs: LLM_TIMEOUT_MS, maxTokens: LLM_MAX_TOKENS, temperature: 0.2 });
    const m = r.text.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const j = JSON.parse(m[0]) as { tool?: string; args?: Record<string, unknown>; tools?: Array<{ tool?: string; args?: Record<string, unknown> }> };
    const valid: ToolName[] = ['search_goods', 'goto_service', 'convert_link', 'chit_chat'];
    // 新协议 tools 数组；旧单 tool 格式兼容读取（模型偶发回退旧格式不炸）
    const raw = Array.isArray(j.tools) ? j.tools.slice(0, 3) : j.tool ? [{ tool: j.tool, args: j.args }] : [];
    const out: Intent[] = [];
    for (const t of raw) {
      if (!t?.tool || !valid.includes(t.tool as ToolName)) continue;
      out.push({ tool: t.tool as ToolName, args: t.args ?? {} });
    }
    // chit_chat 只能单独出现：混入多意图时剔除（复合句里夹寒暄没意义）
    return out.length > 1 ? out.filter((i) => i.tool !== 'chit_chat') : out;
  } catch {
    return []; // 超时/畸形 → L3
  }
}

// ── 工具执行（白名单，全部服务端跑）────────────────────────────────────────

interface GoodsCardItem {
  platform: string; id: string; title: string;
  price: number | null; finalPrice: number | null;
  coupon: number | null; pic: string; shop: string;
  /** 用户可得分佣（元）；null=隐藏返利元素 */
  rebate: number | null;
  /** pdd 专用：goods_sign（点击时动态转链必带，2026-10-08 D先生 钦定取消预转链） */
  sign?: string;
}

async function toolSearchGoods(
  res: Response, args: Record<string, unknown>, userId: number,
): Promise<{ kind: string; content: string; meta: unknown }> {
  const platform = String(args.platform ?? 'jd');
  const keyword = String(args.keyword ?? '').trim().slice(0, 40);
  if (!['jd', 'tb', 'pdd', 'vip'].includes(platform) || !keyword) throw new Error('BAD_TOOL_ARGS');

  const cfg = await resolveHjkConfig(undefined);
  const params = buildListParams(platform, { keyword, page: '1', size: '3' });
  // vip 有词搜索走 goodsquery（goods.ts 同款修正：goodslist 带 keyword 反而恒空）
  const endpoint = platform === 'vip' ? 'vip/goodsquery' : `${platform}/goodslist`;
  const { payload } = await hjkCall(endpoint, params, cfg.apikey);
  const { items } = extractList(platform, payload, 3);
  if (!items.length) {
    const fallback = '没搜到相关商品，换个词试试？比如「咖啡」「耳机」「面霜」~';
    sseWrite(res, 'text_delta', { t: fallback });
    return { kind: 'text', content: fallback, meta: null };
  }

  const selfRate = await userSelfRate(userId);
  const out: GoodsCardItem[] = [];
  for (const it of items) {
    const g = normalizeGoods(platform, it);
    out.push({
      platform, id: g.id, title: g.title,
      price: g.price ?? 0, finalPrice: g.finalPrice ?? 0,
      coupon: g.coupon, pic: g.pic, shop: g.shop,
      rebate: userRebate(it, selfRate),
      // 点击时动态转链（goUnion 矩阵）：卡面不再预转链，省一轮串行上游调用，
      // 且每条都可跳（老实现只预转第一条，2/3 条点「GO」落 copyText(undefined) 报空链接）
      sign: platform === 'pdd' ? (String((it as Record<string, unknown>).goods_sign ?? '') || undefined) : undefined,
    });
  }

  sseWrite(res, 'intent', { tool: 'search_goods', platform, keyword });
  sseWrite(res, 'card', { kind: 'goods_card', items: out });
  // 搜索流态同样一次性出多平台（2026-10-08 D先生 钦定方案 A）：主卡后追加其余三平台
  //   同款各 1 条（复用 29C crossPlatformGoods，kw<4 字自动跳过）；单轨失败静默降级。
  //   历史单行模型 → cross 嵌入 meta（parse_card 同款做法），前端回放时补挂 cross_list
  const cross = keyword.length >= 4 ? await crossPlatformGoods(keyword, platform, userId) : [];
  if (cross.length) sseWrite(res, 'card', { kind: 'cross_list', items: cross });
  // meta 存 items 全量（真标题/图/价）→ 历史回看原样重建卡片（旧版只存 refs id，
  //   历史卡被重建成「搜…命中 3 件」假标题 + 空图，D先生 2026-10-08 实锤）；refs 保留兼容旧端
  return { kind: 'goods_card', content: `搜「${keyword}」命中 ${out.length} 件`, meta: { platform, keyword, refs: out.map((o) => o.id), items: out, cross } };
}

/** 服务名口语变体（2026-10-07 真机三连败纠偏）：hy3 会照搬口语进 name——
 *  「充视频VIP」「领一张打车券」「腾讯视频会员」直接查聚合轨全空（字面匹配不含修饰词）。
 *  剥序：动词前缀 → 券/红包/VIP/会员后缀；逐变体重试聚合，首个有命中即用。 */
function serviceVariants(raw: string): string[] {
  const t = raw.trim();
  const out: string[] = [t];
  const stripped = t
    .replace(/^(帮我|麻烦|请|给我|我想|我要|领一张|领个|领一下|领|充一张|充个|充|买一张|买个|买|订|点一份|点个|点|搜一下|搜一搜|搜|找一下|找一找|找)+/, '')
    .replace(/\s*(券包|大额券|优惠券|红包|月卡|年卡|VIP|vip|会员|券)+$/, '')
    .trim();
  if (stripped && stripped !== t) out.push(stripped);
  return out;
}

async function toolGotoService(
  res: Response, args: Record<string, unknown>, siteId: string,
): Promise<{ kind: string; content: string; meta: unknown }> {
  const name = String(args.name ?? '').trim().slice(0, 30);
  if (!name) throw new Error('BAD_TOOL_ARGS');
  // 07B 聚合契约（与 /service-search 同源，2026-10-07 重构接入）：
  //   A 品牌字面 / B 分类展开（「美团外卖」→ meituan 分类，不再落「美团酒店」）/ C fasttype 权益（「腾讯视频」）
  //   每项显式带 track，端上按 track 分发，禁按名字猜轨道。
  //   口语变体逐个试（首个有命中即用）——「充视频VIP」剥成「视频」→ 权益轨整组命中。
  let agg: Awaited<ReturnType<typeof aggregateServiceSearch>> | null = null;
  for (const v of serviceVariants(name)) {
    const hit = await aggregateServiceSearch(v, siteId);
    if (hit.services.length || hit.rights.length) { agg = hit; break; }
  }
  const items: Array<Record<string, unknown>> = [];
  for (const s of agg?.services ?? []) {
    if (items.length >= 5) break;
    items.push({ track: s.track, name: s.name, brand_code: s.brand_code, cat_name: s.cat_name ?? '', icon: s.icon ?? null });
  }
  for (const r of agg?.rights ?? []) {
    if (items.length >= 5) break;
    items.push({ track: 'rights', name: r.name, cat_name: r.cat_name ?? '', cid: r.cid });
  }
  if (!items.length) throw new Error('SERVICE_NOT_FOUND');
  const card = items.length === 1
    ? { kind: 'service_card', service: items[0] }
    : { kind: 'service_list', items };
  sseWrite(res, 'intent', { tool: 'goto_service', name });
  sseWrite(res, 'card', card);
  return {
    kind: String(card.kind),
    content: items.length === 1 ? `为你找到服务：${items[0].name}` : `「${name}」找到 ${items.length} 项服务`,
    // meta=历史重建唯一数据源（2026-10-08 第三次翻车：只存 {name,tracks} 致 service_list
    //   重进降级成「找到 N 项服务」光秃文本）——items 全量落库，name/tracks 仅作审计冗余
    meta: { name, tracks: items.map((x) => x.track), items },
  };
}

/** 转链失败文案分级（2026-10-07 tb 实测：上游 103「不支持该商品id」= 短链时效失效，
 *  与「链接不完整」是两码事——上游给得出人话就照实引导，禁一律糊弄「复制完整链接」） */
function convertFailTip(e: unknown): string {
  const msg = e instanceof HttpError ? e.message : '';
  return /不支持|失效|商品\s*id|物料|material/i.test(msg)
    ? '这条口令/链接上游暂时解不出商品（多半已失效）——把商品名发我，我帮你搜同款券'
    : '认出是商品链接了，但转链没成功——请复制完整链接（含商品页地址）再试一次';
}

async function toolConvertLink(
  res: Response, args: Record<string, unknown>, userId: number, parsed: ParsedRef | null,
): Promise<{ kind: string; content: string; meta: unknown }> {
  const ref = parsed ?? parseRef(String(args.ref ?? ''));
  if (!ref) {
    // 诚实文案（2026-10-08 D先生 实锤：旧「认出是商品链接了，但转链没成功」在 CANNOT_PARSE
    //   时纯属撒谎——压根没认出来。识别和转链失败必须分开说话）
    const tip = '这个口令/链接的格式我还没认出来——直接发商品名给我，我帮你搜同款券';
    sseWrite(res, 'text_delta', { t: tip });
    return { kind: 'text', content: tip, meta: { layer: 'L2-unparsed' } };
  }
  const { link, rebate, goods } = await doConvert(ref, userId);
  // link 内嵌 platform（万能通道 pf 响应驱动；前端 pcardMeta/platformEn 吃
  //   m.link.platform → 真机双 UNDEFINED，D先生 2026-10-08 实锤）
  const linkFull = { ...link, rebate };
  sseWrite(res, 'intent', { tool: 'convert_link', platform: link.platform, layer: parsed ? 'L0' : 'L2' });
  sseWrite(res, 'card', { kind: 'parse_card', platform: link.platform, link: linkFull, goods: goods ?? null });
  // 29C 同款跨平台出票：有商品名才搜（jd 3.cn 短链响应无商品信息 → 跳过）；
  // tb 口令文案兜底取「」商品名段（上游响应缺 goods_name 时仍可搜）。
  // 非商品门闸（2026-10-09 D先生 实锤：tb 签到口令转链成功但响应无 goods_name，整段口令文案
  //   「淘宝签到领福利」被当关键词全平台搜出不相干「同款」）→ 旧接口路径以响应有无 goods_name
  //   判商品；万能路径 hint 兜底保留（jd 3.cn 短链无 goods 但确是商品，29C 钦定行为不误伤）。
  const allowCross = ref.tbLegacy ? !!goods : true;
  const kwSrc = goods?.title ?? ref.hint ?? ref.text;
  const kw = cleanKeyword(kwSrc);
  let cross: CrossItem[] = [];
  if (allowCross && kw.length >= 4) {
    cross = await crossPlatformGoods(kw, link.platform, userId);
    if (cross.length) sseWrite(res, 'card', { kind: 'cross_list', items: cross });
  }
  return {
    kind: 'parse_card', content: `已转链（${link.platform}）`,
    // meta 存全量（link/goods/cross）→ 历史回看原样重建登机牌（旧版只存平台+返利，
    //   历史卡被降级成光秃秃「已转链（tb）」文本，D先生 2026-10-08 实锤）
    meta: { platform: link.platform, rebate, goods: goods ?? null, link: linkFull, cross },
  };
}

// ── 路由 ────────────────────────────────────────────────────────────────────

/** GET /api/chat/boot —— 空态数据：快捷 chips（brand_action_cfg 归并 top8）+ 动态徽章 */
chatRouter.get('/boot', requireUser, async (req: Request, res: Response) => {
  const siteId = req.user!.siteId;
  const { rows: chips } = await pool.query(
    `SELECT b.brand_code, b.name, c.name AS cat_name,
            COALESCE(b.miniapp_cfg->>'mode', b.action_type) AS mode, b.icon
       FROM brand_action_cfg b
       JOIN brand_category c ON c.code = b.category
      WHERE b.enabled = TRUE
      ORDER BY c.sort, b.id
      LIMIT 8`,
  );
  const { rows: svcCnt } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM brand_action_cfg WHERE enabled = TRUE`,
  );
  let rightsCnt = 0;
  try {
    const { fetchFasttype } = await import('../lib/haojingke.js');
    const ft = await fetchFasttype((await resolveHjkConfig(undefined)).apikey);
    if (ft.ok) rightsCnt = ft.data.length;
  } catch { /* 权益目录不可用不阻塞 boot */ }
  // 站点名（顶部胶囊显示源；boot 此前不返回导致胶囊空白，2026-10-07 修复）
  const { rows: siteRow } = await pool.query(
    `SELECT name FROM site WHERE site_id = $1::uuid LIMIT 1`,
    [siteId],
  );

  res.json({
    ok: true,
    data: {
      site_name: siteRow[0]?.name ?? '',
      chips: chips.map((r) => ({
        track: String(r.mode || 'act'), name: String(r.name), brand_code: String(r.brand_code),
        cat_name: String(r.cat_name), icon: r.icon ? String(r.icon) : null,
      })),
      badges: {
        services: svcCnt[0]?.n ?? 0,   // 「X 项品牌服务」（动态计数，#47 钦定口径的运行时化）
        rights: rightsCnt,             // 「X 项会员权益」
        platforms: 4,                  // 4 大平台返利（jd/tb/pdd/vip）
      },
      welcome: '嗨！我是本站 AI 管家，找券、点餐、转链一句话搞定~',
      suggests: ['瑞幸 9.9 还有吗', '领美团外卖红包', '充视频 VIP'],
      site_id: siteId,
    },
  });
});

/** POST /api/chat/sse —— 主对话（SSE 事件流：intent / text_delta / card / done / error） */
chatRouter.post('/sse', requireUser, async (req: Request, res: Response) => {
  const siteId = req.user!.siteId;
  const userId = req.user!.userId;
  const message = String(req.body?.message ?? '').trim().slice(0, 500);
  const sessionId = String(req.body?.session_id ?? '').trim().slice(0, 64) || `s-${Date.now()}`;
  // L1：chips/推荐问题点击带 chip 元数据 → 0 token 直达
  const chip = req.body?.chip as Record<string, unknown> | undefined;

  if (!message && !chip) throw new HttpError(400, '消息不能为空', 'EMPTY_MESSAGE');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // 容器/反代禁缓冲，SSE 即时下发
  });

  try {
    await assertQuota(siteId, userId);

    // 内容安全（输入侧）：凭据未配 → skipped 放行；命中 → 422 终止
    if (message) {
      const { rows } = await pool.query(`SELECT openid FROM "user" WHERE user_id = $1::bigint LIMIT 1`, [String(userId)]);
      const openid = String(rows[0]?.openid ?? '');
      const sec = openid ? await msgSecCheck(siteId, message, openid) : { pass: true, skipped: true };
      if (sec.skipped) {
        await writeAudit(req, { site_id: siteId, action: 'chat.seccheck_skipped', target_type: 'chat', target_id: sessionId, detail: { reason: 'wechat_mini 凭据未配' } });
      }
      if (!sec.pass) {
        sseWrite(res, 'error', { code: 'CONTENT_BLOCKED', message: '这条消息没能通过安全检查，换个说法试试' });
        res.end();
        return;
      }
    }

    let result: { kind: string; content: string; meta: unknown } | null = null;
    /** 多意图（2026-10-10 方案 A）：L2 拆出的全部结果；空=单结果走 result。末尾统一落库防重复 */
    let assistantResults: Array<{ kind: string; content: string; meta: unknown }> = [];

    // ── L1 chips 直达 ──
    if (chip && typeof chip.name === 'string') {
      sseWrite(res, 'intent', { tool: 'goto_service', layer: 'L1', name: chip.name });
      const card = { kind: 'service_card', service: chip };
      sseWrite(res, 'card', card);
      result = { kind: 'service_card', content: `直达服务：${chip.name}`, meta: chip };
    }

    // ── L0 粘贴解析（2026-10-09 万能转链改造：平台判定权交上游，jd 数字sku限制解除）──
    if (!result && message) {
      const parsed = parseRef(message);
      if (parsed) {
        parsed.hint = parsed.hint ?? message; // 29C 跨平台搜词兜底源（原话含「」商品名段）
        try {
          result = await toolConvertLink(res, {}, userId, parsed);
        } catch (e) {
          // 弱信号（口令结构无 URL）：转链失败不吞消息 → 置空回落 L1.5/L2 保住搜索意图
          //   （如「淘宝上的 iPhone15Pro 值得买吗」被疑似后试转 103，仍应正常走搜索）；
          //   强信号（显式链接/包裹）失败则诚实收尾，避免 L2 对死链瞎搜
          if (!parsed.weak) {
            const tip = convertFailTip(e);
            sseWrite(res, 'text_delta', { t: tip });
            result = { kind: 'text', content: tip, meta: null };
          }
        }
      }
    }

    // ── L1.5 类目直判（0 token，确定性路由，2026-10-07 追加）──
    // 「领一张打车券」这类短指令经 hy3 偶发路由偏航（E2E 实测翻车一次）。
    // 短消息（≤14字）且口语变体命中 brand_category 分类名 → 直接走 goto_service，不再赌 L2；
    // 长句/搜商品句式（含平台词、价格等）不满足分类命中，自然落 L2，无劫持风险。
    // ⛔ 复合句守卫（2026-10-10 方案 A）：整句 ILIKE '%分类名%' 会把「肚子饿了，打个车去吃个麦当劳」
    //    劫持成单打车服务（14 字恰好进阈值）——含从句标点/连接词的一律落 L2 拆多意图。
    const COMPOUND_RE = /[,，。！？；;、]|\b然后\b|顺便|接着|再去|再去|和一起/;
    if (!result && message && message.length <= 14 && !COMPOUND_RE.test(message)) {
      for (const v of serviceVariants(message)) {
        const cat = await pool.query(
          `SELECT c.code FROM brand_category c
            WHERE (c.name ILIKE '%' || $1 || '%' OR $1 ILIKE '%' || c.name || '%')
              AND EXISTS (SELECT 1 FROM brand_action_cfg b WHERE b.category = c.code AND b.enabled = TRUE)
            LIMIT 1`,
          [v],
        );
        if (!cat.rows[0]) continue;
        try { result = await toolGotoService(res, { name: v }, siteId); } catch { result = null; }
        if (result) break;
      }
    }

    // ── L2 hy3 意图（多意图数组，2026-10-10 方案 A：复合句拆解逐个执行，SSE 卡片连发）──
    if (!result && message) {
      const { rows: hist } = await pool.query(
        `SELECT role, content FROM chat_message
          WHERE user_id = $1::bigint AND site_id = $2::uuid
          ORDER BY created_at DESC LIMIT $3`,
        [String(userId), siteId, CONTEXT_ROUNDS * 2],
      );
      const history = hist.reverse().map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
      const intents = await llmIntent(history, message);
      if (!intents.length) {
        // L3 兜底（0 token，不重试）
        const fallback = '这句话我还没学会~ 你可以试试：搜个商品（「女士防风外套」）、贴个商品链接让我转链，或者点下面的快捷服务。';
        sseWrite(res, 'text_delta', { t: fallback });
        result = { kind: 'text', content: fallback, meta: { layer: 'L3' } };
      } else {
        const results: Array<{ kind: string; content: string; meta: unknown }> = [];
        for (const intent of intents) {
          try {
            if (intent.tool === 'search_goods') {
              results.push(await toolSearchGoods(res, intent.args, userId));
            } else if (intent.tool === 'goto_service') {
              try {
                results.push(await toolGotoService(res, intent.args, siteId));
              } catch {
                const tip = `「${String(intent.args.name ?? '')}」这个服务我还没接入，先看看下面的快捷服务吧~`;
                sseWrite(res, 'text_delta', { t: tip });
                results.push({ kind: 'text', content: tip, meta: { layer: 'L3' } });
              }
            } else if (intent.tool === 'convert_link') {
              try {
                results.push(await toolConvertLink(res, intent.args, userId, null));
              } catch (e) {
                const tip = convertFailTip(e);
                sseWrite(res, 'text_delta', { t: tip });
                results.push({ kind: 'text', content: tip, meta: null });
              }
            } else {
              const reply = String(intent.args.reply ?? '').slice(0, 200) || '我在的~';
              sseWrite(res, 'text_delta', { t: reply });
              results.push({ kind: 'text', content: reply, meta: { layer: 'L2-chitchat' } });
            }
          } catch {
            const fallback = '刚才那步没走通，换个说法试试？';
            sseWrite(res, 'text_delta', { t: fallback });
            results.push({ kind: 'text', content: fallback, meta: { layer: 'L3' } });
          }
        }
        result = results[0] ?? null;
        assistantResults = results; // 多意图逐条落库（末尾统一处理；单意图长度 1 行为不变）
      }
    }

    // 历史落库（用户消息 + 助手结果；多意图逐条存，前端 history 按条回放各自重建卡片）
    if (message) await saveMessage(siteId, userId, sessionId, 'user', 'text', message, null);
    if (chip && typeof chip.name === 'string') await saveMessage(siteId, userId, sessionId, 'user', 'text', `[快捷] ${chip.name}`, null);
    const toSave = assistantResults.length ? assistantResults : result ? [result] : [];
    for (const r of toSave) await saveMessage(siteId, userId, sessionId, 'assistant', r.kind, r.content, r.meta);

    sseWrite(res, 'done', { ok: true, session_id: sessionId });
    await writeAudit(req, {
      site_id: siteId, action: 'chat.message', target_type: 'chat', target_id: sessionId,
      detail: { kind: result?.kind ?? 'none', len: message.length },
    });
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 'CHAT_INTERNAL';
    const msg = e instanceof HttpError ? e.message : 'AI 助手开小差了，稍后再试';
    sseWrite(res, 'error', { code, message: msg });
  } finally {
    res.end();
  }
});

/** GET /api/chat/history?before=<id> —— 游标分页（默认倒序 20 条） */
chatRouter.get('/history', requireUser, async (req: Request, res: Response) => {
  const siteId = req.user!.siteId;
  const userId = req.user!.userId;
  const before = Number(req.query.before ?? 0);
  const { rows } = await pool.query(
    `SELECT id::text, role, kind, content, meta, created_at::text
       FROM chat_message
      WHERE user_id = $1::bigint AND site_id = $2::uuid
        AND ($3::bigint <= 0 OR id < $3::bigint)
      ORDER BY created_at DESC, id DESC
      LIMIT 20`,
    [String(userId), siteId, String(before || 0)],
  );
  res.json({ ok: true, data: { items: rows, hasMore: rows.length === 20 } });
});

/** DELETE /api/chat/history —— 清空本人本站会话（前端二次确认后调） */
chatRouter.delete('/history', requireUser, async (req: Request, res: Response) => {
  const siteId = req.user!.siteId;
  const userId = req.user!.userId;
  const { rowCount } = await pool.query(
    `DELETE FROM chat_message WHERE user_id = $1::bigint AND site_id = $2::uuid RETURNING id`,
    [String(userId), siteId],
  );
  await writeAudit(req, {
    site_id: siteId, action: 'chat.history_clear', target_type: 'chat',
    detail: { deleted: rowCount ?? 0 },
  });
  res.json({ ok: true, data: { deleted: rowCount ?? 0 } });
});
