/**
 * 数据层双模式：
 * - TCP 直连（DATABASE_URL 为真实连接串）：pg Pool + drizzle/node-postgres
 * - HTTP 网关（TCB_API_KEY + 无真实 DATABASE_URL）：CloudBase PG exec-pgsql
 *   通过 pg-proxy + 假 Pool 适配，业务代码（db / pool.query）零改动
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleProxy } from 'drizzle-orm/pg-proxy';
import { Pool } from 'pg';
import { config } from '../config.js';
import { execSql } from './gateway.js';

/** 对外暴露的 Pool 最小接口（index.ts / routes 只用到 query 与 end） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 对齐 pg.Pool.query 的宽松 rows 类型
export interface QueryablePool {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: any[]; rowCount: number }>;
  end: () => Promise<void>;
}

let realPool: Pool | null = null;
let poolStub: QueryablePool | null = null;

if (config.useGateway) {
  console.log('[db] mode = HTTP gateway (exec-pgsql, SHARED tenant PG)');
  poolStub = {
    query: async (sql, params = []) => {
      const res = await execSql(sql, params);
      return { rows: res.rows as any[], rowCount: res.rowCount };
    },
    end: async () => {},
  };
} else {
  console.log('[db] mode = TCP (pg Pool)');
  realPool = new Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export const pool: QueryablePool = (poolStub ?? realPool)!;

export const db = config.useGateway
  ? drizzleProxy(async (sql, params) => {
      const res = await execSql(sql, params);
      return { rows: res.rows as any[], rowCount: res.rowCount };
    })
  : drizzle(realPool!);
