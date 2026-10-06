/**
 * page-v1 Schema 校验（A1 生成端点专用）。
 * 合同全文见 packages/renderer/schema/page-v1.schema.json；此处内嵌收窄版：
 * - 楼层类型白名单 = 渲染器已实现 6 组件（AI 输出超范围直接拒）
 * - 结构约束对齐渲染器真实消费（floor_id / props 必填、action/data_source 枚举）
 */
import { Ajv, type ErrorObject } from 'ajv';

const IMPLEMENTED_FLOORS = [
  'swiper', 'search-bar', 'nav', 'coupon-strip', 'brand-chips', 'goods-feed',
  'notice', 'divider', 'rich-text', 'blank', 'ingot-entry', 'movie-box', 'redeem-entry',
  'floor', 'float-btn', 'category-nav', 'member-card', 'brand-matrix', 'activity-floor', 'image-hotzone', 'video-floor', 'countdown', 'popup-modal', 'seckill', 'group-buy-floor', 'coupon-wall', 'invite-floor',
] as const;

const contract = {
  type: 'object',
  required: ['version', 'page', 'floors'],
  additionalProperties: false,
  properties: {
    version: { type: 'integer', const: 1 },
    page: { type: 'string', pattern: '^(home|home_h5|page-[a-z0-9]{2,10})$' },
    title: { type: 'string', maxLength: 30 },
    floors: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: {
        type: 'object',
        required: ['type', 'floor_id', 'props'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: [...IMPLEMENTED_FLOORS] },
          floor_id: { type: 'string', minLength: 1, maxLength: 40 },
          component_id: { type: 'string' },
          props: { type: 'object' },
          data_source: {
            type: 'object',
            required: ['mode'],
            properties: {
              mode: { type: 'string', enum: ['manual', 'category', 'platform_tab', 'self'] },
              params: { type: 'object' },
            },
            additionalProperties: false,
          },
          action: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string', enum: ['jump', 'plugin-launch', 'activity', 'popup', 'none'] },
              target: { type: 'string', enum: ['page', 'h5', 'weapp'] },
              value: { type: 'string' },
              params: { type: 'object' },
            },
            additionalProperties: false,
          },
        },
      },
    },
  },
};

const ajv = new Ajv({ allErrors: true });
const validateFn = ajv.compile(contract);

export interface ValidatedDoc {
  version: 1;
  page: string;
  floors: { type: string; floor_id: string; props: Record<string, unknown>; [k: string]: unknown }[];
}

/** 校验 LLM 产出的装修文档。返回 null = 合法；否则返回可回喂 LLM 的错误摘要。 */
export function validatePageSchema(doc: unknown): string | null {
  const ok = validateFn(doc);
  if (ok) return null;
  const errs = (validateFn.errors ?? []).slice(0, 6).map((e: ErrorObject) => {
    const path = e.instancePath || '(root)';
    return `${path} ${e.message ?? ''}`.trim();
  });
  return `Schema 校验未通过（共 ${validateFn.errors?.length ?? 0} 处）：${errs.join('；')}`;
}

/** 从 LLM 文本提取 JSON：剥 ```json 围栏 / 前后噪声，取首个平衡大括号块。 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('响应中未找到 JSON 对象');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  throw new Error('JSON 对象不完整（大括号未闭合）');
}

/* ---- theme-v1（L1 换肤）：色板 12 键白名单 + 颜色格式校验 ---- */

export const THEME_TOKENS = [
  'primary', 'primary-dark', 'secondary', 'on-primary',
  'bg', 'surface', 'surface-alt',
  'border-strong', 'border-default',
  'text', 'text-2', 'text-3',
] as const;

function isColorValue(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(s) || s.includes('gradient(');
}

/**
 * 校验 AI 产出的换肤色板。返回 null = 合法；否则返回可回喂 LLM 的错误摘要。
 * 允许部分键（只换主色也行），未提供的键用默认波普风。
 */
export function validateTheme(doc: unknown): string | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return '输出须为 JSON 对象';
  const tokens = (doc as { tokens?: unknown }).tokens;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return '缺少 tokens 对象';
  const entries = Object.entries(tokens as Record<string, unknown>);
  if (!entries.length) return 'tokens 不能为空';
  const bad: string[] = [];
  for (const [k, v] of entries) {
    if (!(THEME_TOKENS as readonly string[]).includes(k)) { bad.push(`${k}(未知键)`); continue; }
    if (!isColorValue(v)) bad.push(`${k}="${String(v).slice(0, 30)}"(须 #hex 或 gradient)`);
  }
  if (bad.length) return `非法配色项：${bad.join('、')}。可用键：${THEME_TOKENS.join(',')}。`;
  return null;
}
