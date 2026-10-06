import 'dotenv/config';

const REQUIRED = [
  'TCB_ENV',
  'JWT_SECRET',
] as const;

/** 迁移/种子脚本额外要求；API 运行时云托管内由平台注入 */
const DB_KEY = 'DATABASE_URL';

function fail(missing: string[]): never {
  console.error(
    `[config] 缺少必填环境变量，终止启动：\n  - ${missing.join('\n  - ')}\n` +
      '请参照 .env.example 补齐后重试（缺项明示原则：不半途部署）。'
  );
  process.exit(1);
}

/**
 * 数据层模式（启动即校验，缺项明示）：
 * - TCP 直连：DATABASE_URL 为真实连接串（postgresql://...）时走 pg Pool
 * - HTTP 网关：配置了 TCB_API_KEY 且 DATABASE_URL 缺失/为占位符时，
 *   走 CloudBase PG HTTP 网关 exec-pgsql（SHARED 租户实例无 TCP 连接串的官方正路）
 */
export const isRealDatabaseUrl = (url: string | undefined): boolean =>
  !!url && /^postgres(ql)?:\/\//.test(url) && !/user:password@host/.test(url);

const hasGatewayKey = !!process.env.TCB_API_KEY?.trim();
if (!isRealDatabaseUrl(process.env.DATABASE_URL) && !hasGatewayKey) {
  fail([`${DB_KEY}（或 TCB_API_KEY 走 HTTP 网关模式）`]);
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  tcbEnv: process.env.TCB_ENV!,
  jwtSecret: process.env.JWT_SECRET!,
  databaseUrl: process.env.DATABASE_URL ?? '',
  tcbApiKey: process.env.TCB_API_KEY?.trim() ?? '',
  useGateway: !isRealDatabaseUrl(process.env.DATABASE_URL) && hasGatewayKey,
  adminInitPassword: process.env.ADMIN_INIT_PASSWORD ?? '',
  llmAgentId: process.env.LLM_AGENT_ID ?? '',
  port: Number(process.env.PORT ?? 9000),
} as const;
