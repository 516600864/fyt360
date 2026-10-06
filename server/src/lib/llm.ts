/**
 * LLM client — CloudBase AI 网关直调（与 exec-pgsql 同款 Bearer TCB_API_KEY 模式）。
 * 通道验证记录（2026-09-23 探针实测）：
 * - hunyuan-exp / deepseek provider 已停用 → EXCEED_TOKEN_QUOTA_LIMIT
 * - cloudbase/hy3 免费额度可用（~1.6s 首字）
 * - node-sdk 的 bot/agent 通道依赖已移除（不需要）
 */
import { config } from '../config.js';

const LLM_BASE = `https://${process.env.TCB_ENV}.api.tcloudbasegateway.com/v1/ai/cloudbase/chat/completions`;
const LLM_MODEL = 'hy3';

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  /** 思考内容长度（hy3 混合推理模型会先reasoning 再正文，两者共享 max_tokens 预算） */
  reasoningLen: number;
  /** finish_reason：stop=正常 / length=max_tokens 被截断（几乎必然导致 JSON 解析失败） */
  finishReason: string;
  reasoningTokens: number;
}

/** 标记「被 max_tokens 截断」的错误，供上层映射成 502 而不是 500。 */
export class LlmTruncatedError extends Error {
  constructor(public reasoningTokens: number, public maxTokens: number) {
    super(
      `LLM 输出被 max_tokens=${maxTokens} 截断（其中推理占 ${reasoningTokens}），正文未产出。` +
      `混合推理模型把 reasoning_tokens 计入 max_tokens 预算，调大 maxTokens 或改用非推理模型。`,
    );
    this.name = 'LlmTruncatedError';
  }
}

/** 单轮补全。失败抛 Error（含网关状态码片段）。 */
export async function chatComplete(
  messages: ChatMessage[],
  opts: { timeoutMs?: number; maxTokens?: number; temperature?: number } = {},
): Promise<ChatResult> {
  const t0 = Date.now();
  const maxTokens = opts.maxTokens ?? 3500;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(LLM_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.tcbApiKey}` },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: ac.signal,
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`LLM ${res.status}: ${body.slice(0, 200)}`);
    const json = JSON.parse(body) as {
      choices?: { finish_reason?: string; message?: { content?: string; reasoning_content?: string } }[];
      usage?: {
        prompt_tokens?: number; completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const choice = json.choices?.[0];
    const finishReason = choice?.finish_reason ?? '';
    const reasoning = choice?.message?.reasoning_content ?? '';
    const reasoningTokens = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const text = choice?.message?.content ?? '';

    // ⚠️ **被截断必须早抛**：hy3 是混合推理模型，reasoning_tokens 与正文**共享 max_tokens 预算**。
    //   实测（2026-10-04）：maxTokens=1200 时 reasoning 烧掉全部 1200 → content 为空串，
    //   finish_reason=length。此时继续走「空响应」分支只会得到一句无信息量的报错，
    //   且上层抛裸 Error → 500「服务内部错误」，真实原因被完全吞掉。
    //   阈值实测：1200→正文0字 / 2000→正文59字(JSON截断) / 3500→正文281字(完整) / 6000→无额外收益。
    if (finishReason === 'length') {
      throw new LlmTruncatedError(reasoningTokens || (text ? 0 : maxTokens), maxTokens);
    }
    if (!text) {
      throw new Error(
        `LLM 空响应（finish=${finishReason || 'unknown'}, 推理${reasoningTokens}token）：${body.slice(0, 200)}`,
      );
    }
    return {
      text,
      tokensIn: json.usage?.prompt_tokens ?? 0,
      tokensOut: json.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - t0,
      reasoningLen: reasoning.length,
      finishReason,
      reasoningTokens,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ---- 探活（agent_ready）：内存缓存 5 分钟，失败缓存 30 秒防打爆 ---- */
let probeCache: { ok: boolean; at: number; err?: string } | null = null;
const PROBE_OK_TTL = 5 * 60_000;
const PROBE_FAIL_TTL = 30_000;

export async function probeLlm(force = false): Promise<{ ready: boolean; error?: string }> {
  if (!config.tcbApiKey) return { ready: false, error: 'TCB_API_KEY 未配置' };
  const ttl = probeCache?.ok ? PROBE_OK_TTL : PROBE_FAIL_TTL;
  if (!force && probeCache && Date.now() - probeCache.at < ttl) {
    return { ready: probeCache.ok, error: probeCache.err };
  }
  try {
    await chatComplete(
      [{ role: 'user', content: '回复两个字：在线' }],
      { timeoutMs: 15_000, maxTokens: 512, temperature: 0 },
    );
    probeCache = { ok: true, at: Date.now() };
    return { ready: true };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    probeCache = { ok: false, at: Date.now(), err };
    return { ready: false, error: err.slice(0, 160) };
  }
}
