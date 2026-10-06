/**
 * CloudBase PG HTTP 网关执行器
 *
 * 背景：CloudBase PG（SHARED 共租户实例，如 pgdb-*）不提供 TCP 连接串，
 * 官方数据面正路是 HTTP 网关 exec-pgsql（仅 service_role/API Key 可调用）。
 * 文档：https://{envId}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql
 *
 * 鉴权：Authorization: Bearer <API Key>（api_key 类型，service_role，绕过 RLS）
 * 角色：cloudbase_postgres（管理角色，DDL/DML 均可）
 */
import { config } from '../config.js';

const GATEWAY = `https://${config.tcbEnv}.api.tcloudbasegateway.com`;
const EXEC_SQL = `${GATEWAY}/v1/rdb/exec-pgsql`;

export interface ExecResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/** pg 代理错误：携带网关错误码，便于上层识别约束冲突等 */
export class GatewayError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
  }
}

export async function execSql(
  sql: string,
  params: unknown[] = [],
  role: 'cloudbase_postgres' | 'cloudbase_read_only_user' = 'cloudbase_postgres',
): Promise<ExecResult> {
  const r = await fetch(EXEC_SQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.tcbApiKey}`,
    },
    body: JSON.stringify({ sql, parameters: params, role }),
  });

  const text = await r.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // 非 JSON 响应体，按系统错误处理
  }

  if (!r.ok) {
    const err = body as { code?: string; message?: string } | null;
    throw new GatewayError(
      err?.code ?? `HTTP_${r.status}`,
      err?.message ?? `exec-pgsql ${r.status}: ${text.slice(0, 200)}`,
    );
  }

  const rows = Array.isArray(body) ? (body as Record<string, unknown>[]) : [];
  return { rows, rowCount: rows.length };
}
