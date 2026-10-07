// mini-29 AI 助手（决策 #46/#47，D先生 2026-10-07 定稿）
//
// 分层管线（成本核心）：
//   L0 粘贴解析  输入含商品链接/口令 → 纯正则提取参数 → 直接转链        0 token
//                ⛔ 实测边界：tb(item_id)/pdd(goods_sign)/vip(数字id) 可直转；
//                jd 仅认蚂蚁加密 goods_id，数字 skuId 无反查端点 → jd URL 给引导文案
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
import { buildLinkParams, injectPromoter, extractLink, type LinkResult } from './link.js';
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

// ── L0 粘贴解析（纯正则，0 token）─────────────────────────────────────────

interface ParsedRef { platform: string; params: Record<string, string> }

function parseRef(text: string): ParsedRef | null {
  const t = text.trim();
  // jd：item.jd.com/100012345678.html 优先；无 URL 时须有「jd/京东」提示 + 11~15 位纯数字 id
  //   （纯数字裸匹配必须有品类提示词护航，否则会误伤淘口令/验证码类串）
  let m = t.match(/item\.jd\.com\/(\d+)\.html/);
  if (!m && /(jd\.com|京东)/i.test(t)) m = t.match(/\b(\d{11,15})\b/);
  if (m) return { platform: 'jd', params: { goods_id: m[1], type: '1' } };
  // tb/tm：item.taobao.com/item?id= / detail.tmall.com/item?id=
  m = t.match(/(?:item\.taobao|detail\.tmall)\.com\/item[^#]*?\?id=(\d+)/);
  if (m) return { platform: 'tb', params: { item_id: m[1] } };
  // pdd：goods_sign 在 query（mobile.yangkeduo.com/goods.html?goods_sign=XXXX）
  m = t.match(/goods_sign=([A-Za-z0-9_-]{8,})/);
  if (m) return { platform: 'pdd', params: { goods_sign: m[1] } };
  // vip：detail-(\d+).vip.com 优先；有 vip 提示词时兜底纯数字 id
  m = t.match(/detail-(\d+)\.vip\.com/) ?? (/(vip\.com|唯品)/i.test(t) ? t.match(/\b(\d{8,15})\b/) : null);
  if (m) return { platform: 'vip', params: { goods_id: m[1], type: '1' } };
  return null;
}

/** 转链执行（复用 link.ts 契约函数，禁重复实现） */
async function doConvert(
  platform: string, params: Record<string, string>, siteId: string, userId: number,
): Promise<LinkResult> {
  const cfg = await resolveHjkConfig(undefined);
  const p = { ...params };
  if (userId > 0) injectPromoter(platform, p, userId);
  if (platform === 'jd' && userId <= 0) p.positionid = '1';
  const { payload } = await hjkCall(`${platform}/getunionurl`, p, cfg.apikey);
  return extractLink(platform, payload);
}

// ── L2 意图协议（#46 §3.1：JSON 约束，不依赖 function calling）─────────────

type ToolName = 'search_goods' | 'goto_service' | 'convert_link' | 'chit_chat';

const INTENT_SYSTEM = `你是本站 AI 助手。用户消息进来后，你必须只输出一个 JSON 对象，禁止输出任何其他文字、markdown 或解释。可选工具恰好一个：

搜商品：{"tool":"search_goods","args":{"platform":"jd|tb|pdd|vip","keyword":"关键词"}}
站内服务：{"tool":"goto_service","args":{"name":"品牌或服务名"}}
转链接：{"tool":"convert_link","args":{"platform":"jd|tb|pdd|vip","ref":"商品id或参数"}}
寒暄兜底：{"tool":"chit_chat","args":{"reply":"50字内的简短友好回复"}}

规则：
1. 用户想找优惠/商品/券 → search_goods（platform 按常识选，不确定选 jd）。
2. 用户提到点餐/外卖/打车/观影等本地生活服务 → goto_service，name 填品牌名（如 美团/肯德基/滴滴）。
3. 用户给了链接或口令要转链 → convert_link（能提取 id 就填）。
4. 元宝/积分/提现/改密等账户操作一律不受理，chit_chat 回复引导去「我的」页操作。
5. 闲聊问候 → chit_chat。reply 不编造价格、佣金、库存。`;

interface Intent { tool: ToolName; args: Record<string, unknown> }

/** hy3 输出 → 严格 JSON 校验；任何畸形进 L3（失败不重试超 1 次） */
async function llmIntent(history: { role: 'user' | 'assistant'; content: string }[], message: string): Promise<Intent | null> {
  const messages = [
    { role: 'system' as const, content: INTENT_SYSTEM },
    ...history.slice(-CONTEXT_ROUNDS * 2),
    { role: 'user' as const, content: message },
  ];
  try {
    const r = await chatComplete(messages, { timeoutMs: LLM_TIMEOUT_MS, maxTokens: LLM_MAX_TOKENS, temperature: 0.2 });
    const m = r.text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as { tool?: string; args?: Record<string, unknown> };
    const tools: ToolName[] = ['search_goods', 'goto_service', 'convert_link', 'chit_chat'];
    if (!j.tool || !tools.includes(j.tool as ToolName)) return null;
    return { tool: j.tool as ToolName, args: j.args ?? {} };
  } catch {
    return null; // 超时/畸形 → L3
  }
}

// ── 工具执行（白名单，全部服务端跑）────────────────────────────────────────

interface GoodsCardItem {
  platform: string; id: string; title: string;
  price: number | null; finalPrice: number | null;
  coupon: number | null; pic: string; shop: string;
  /** 用户可得分佣（元）；null=隐藏返利元素 */
  rebate: number | null;
  tkl?: string; url?: string; miniAppId?: string; miniPath?: string; vipWxUrl?: string;
}

async function toolSearchGoods(
  res: Response, args: Record<string, unknown>, siteId: string, userId: number,
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
    });
  }
  // 首条直接带转链结果（进入即可用，用户不必再点一次）
  const first = out[0];
  try {
    const firstParams: Record<string, string> =
      platform === 'jd' ? { goods_id: first.id, type: '1' }
      : platform === 'tb' ? { item_id: first.id }
      : platform === 'pdd' ? { goods_sign: String((items[0] as Record<string, unknown>).goods_sign ?? '') }
      : { goods_id: first.id, type: '1' };
    const link = await doConvert(platform, firstParams, siteId, userId);
    Object.assign(first, link);
  } catch { /* 转链失败不阻塞卡片展示，前端按钮降级为重试 */ }

  sseWrite(res, 'intent', { tool: 'search_goods', platform, keyword });
  sseWrite(res, 'card', { kind: 'goods_card', items: out });
  return { kind: 'goods_card', content: `搜「${keyword}」命中 ${out.length} 件`, meta: { platform, keyword, refs: out.map((o) => o.id) } };
}

async function toolGotoService(
  res: Response, args: Record<string, unknown>,
): Promise<{ kind: string; content: string; meta: unknown }> {
  const name = String(args.name ?? '').trim().slice(0, 30);
  if (!name) throw new Error('BAD_TOOL_ARGS');
  // 白名单：只认 brand_action_cfg enabled=TRUE 的真实服务，禁猜（分发铁律延伸到 AI）
  const { rows } = await pool.query(
    `SELECT b.brand_code, b.name, b.category, c.name AS cat_name,
            COALESCE(b.miniapp_cfg->>'mode', b.action_type) AS mode, b.icon
       FROM brand_action_cfg b
       JOIN brand_category c ON c.code = b.category
      WHERE b.enabled = TRUE AND (b.name = $1 OR $1 ILIKE '%' || b.name || '%' OR b.name ILIKE '%' || $1 || '%')
      ORDER BY CASE WHEN b.name = $1 THEN 0 ELSE 1 END, c.sort, b.id
      LIMIT 1`,
    [name],
  );
  if (!rows[0]) throw new Error('SERVICE_NOT_FOUND');

  const s = rows[0];
  const card = {
    kind: 'service_card',
    service: {
      track: String(s.mode || 'act'),       // plugin | halfscreen | act —— 端上按 track 分发（与 service-search 同构）
      name: String(s.name), brand_code: String(s.brand_code),
      cat_name: String(s.cat_name), icon: s.icon ? String(s.icon) : null,
    },
  };
  sseWrite(res, 'intent', { tool: 'goto_service', name });
  sseWrite(res, 'card', card);
  return { kind: 'service_card', content: `为你找到服务：${s.name}`, meta: card.service };
}

async function toolConvertLink(
  res: Response, args: Record<string, unknown>, siteId: string, userId: number, parsed: ParsedRef | null,
): Promise<{ kind: string; content: string; meta: unknown }> {
  const ref = parsed ?? parseRef(String(args.ref ?? ''));
  if (!ref) throw new Error('CANNOT_PARSE');
  const link = await doConvert(ref.platform, ref.params, siteId, userId);
  sseWrite(res, 'intent', { tool: 'convert_link', platform: ref.platform, layer: parsed ? 'L0' : 'L2' });
  sseWrite(res, 'card', { kind: 'parse_card', platform: ref.platform, link });
  return { kind: 'parse_card', content: `已转链（${ref.platform}）`, meta: { platform: ref.platform } };
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

  res.json({
    ok: true,
    data: {
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
    'Content-Type': 'text/event-stream',
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

    // ── L1 chips 直达 ──
    if (chip && typeof chip.name === 'string') {
      sseWrite(res, 'intent', { tool: 'goto_service', layer: 'L1', name: chip.name });
      const card = { kind: 'service_card', service: chip };
      sseWrite(res, 'card', card);
      result = { kind: 'service_card', content: `直达服务：${chip.name}`, meta: chip };
    }

    // ── L0 粘贴解析 ──
    if (!result && message) {
      const parsed = parseRef(message);
      if (parsed) {
        // ⛔ 实测边界（2026-10-07 探针）：jd getunionurl 只认蚂蚁加密 goods_id，
        //   item.jd.com 的数字 skuId 转链报「materialId不合规」且无反查端点——jd URL 不承诺转链，给引导。
        //   tb（item_id 数字）/ pdd（goods_sign）/ vip（goods_id 数字）均实测可直转。
        if (parsed.platform === 'jd') {
          const tip = '京东链接暂时转不了~ 把商品名告诉我，我帮你搜同款券';
          sseWrite(res, 'text_delta', { t: tip });
          result = { kind: 'text', content: tip, meta: { layer: 'L0-jd-limit' } };
        } else {
          try {
            result = await toolConvertLink(res, {}, siteId, userId, parsed);
          } catch {
            const tip = '认出是商品链接了，但转链没成功——请复制完整链接（含商品页地址）再试一次';
            sseWrite(res, 'text_delta', { t: tip });
            result = { kind: 'text', content: tip, meta: null };
          }
        }
      }
    }

    // ── L2 hy3 意图 ──
    if (!result && message) {
      const { rows: hist } = await pool.query(
        `SELECT role, content FROM chat_message
          WHERE user_id = $1::bigint AND site_id = $2::uuid
          ORDER BY created_at DESC LIMIT $3`,
        [String(userId), siteId, CONTEXT_ROUNDS * 2],
      );
      const history = hist.reverse().map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }));
      const intent = await llmIntent(history, message);
      if (!intent) {
        // L3 兜底（0 token，不重试）
        const fallback = '这句话我还没学会~ 你可以试试：搜个商品（「帮我找瑞幸 9.9」）、贴个商品链接让我转链，或者点下面的快捷服务。';
        sseWrite(res, 'text_delta', { t: fallback });
        result = { kind: 'text', content: fallback, meta: { layer: 'L3' } };
      } else {
        try {
          if (intent.tool === 'search_goods') result = await toolSearchGoods(res, intent.args, siteId, userId);
          else if (intent.tool === 'goto_service') {
            try { result = await toolGotoService(res, intent.args); }
            catch {
              const tip = `「${String(intent.args.name ?? '')}」这个服务我还没接入，先看看下面的快捷服务吧~`;
              sseWrite(res, 'text_delta', { t: tip });
              result = { kind: 'text', content: tip, meta: { layer: 'L3' } };
            }
          } else if (intent.tool === 'convert_link') {
            try { result = await toolConvertLink(res, intent.args, siteId, userId, null); }
            catch {
              const tip = '转链没成功——请复制完整商品链接（含商品页地址）再试一次';
              sseWrite(res, 'text_delta', { t: tip });
              result = { kind: 'text', content: tip, meta: null };
            }
          } else {
            const reply = String(intent.args.reply ?? '').slice(0, 200) || '我在的~';
            sseWrite(res, 'text_delta', { t: reply });
            result = { kind: 'text', content: reply, meta: { layer: 'L2-chitchat' } };
          }
        } catch {
          const fallback = '刚才那步没走通，换个说法试试？';
          sseWrite(res, 'text_delta', { t: fallback });
          result = { kind: 'text', content: fallback, meta: { layer: 'L3' } };
        }
      }
    }

    // 历史落库（用户消息 + 助手结果）
    if (message) await saveMessage(siteId, userId, sessionId, 'user', 'text', message, null);
    if (chip && typeof chip.name === 'string') await saveMessage(siteId, userId, sessionId, 'user', 'text', `[快捷] ${chip.name}`, null);
    if (result) await saveMessage(siteId, userId, sessionId, 'assistant', result.kind, result.content, result.meta);

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
