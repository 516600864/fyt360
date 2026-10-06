// 统一数据库执行层：两种后端自动切换
//   A. direct  — DATABASE_URL 为真实连接串（标准版/本地 embedded PG）→ pg 直连，支持事务
//   B. tcbapi  — 个人版无直连能力，用 @cloudbase/manager-node executePGSql 云 API
//                （SecretId/Key 签名，参数内联转义，逐条执行、无会话事务，靠幂等补偿）
import pg from 'pg';

const DB_URL_PLACEHOLDER = 'user:password@host';

export function detectBackend() {
  const url = process.env.DATABASE_URL || '';
  if (url.trim() !== '' && !url.includes(DB_URL_PLACEHOLDER)) return 'direct';
  if (process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY && process.env.TCB_ENV) return 'tcbapi';
  return null;
}

// SQL 字面量内联转义（仅用于 tcbapi 后端；参数均为脚本内可控值）
function toLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') v = JSON.stringify(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function getTcbApiBackend() {
  const mod = await import('@cloudbase/manager-node');
  const CloudBase = mod.default ?? mod;
  const app = CloudBase.init({
    secretId: process.env.TCB_SECRET_ID,
    secretKey: process.env.TCB_SECRET_KEY,
    envId: process.env.TCB_ENV,
  });
  const database = app.database;
  return {
    backend: 'tcbapi',
    async query(sql, params = []) {
      let finalSql = sql;
      if (params.length > 0) {
        finalSql = sql.replace(/\$\d+/g, (m) => {
          const idx = parseInt(m.slice(1), 10) - 1;
          return idx < params.length ? toLiteral(params[idx]) : m;
        });
      }
      const r = await database.executePGSql({ Sql: finalSql, EnvId: process.env.TCB_ENV });
      const rows = (r.Rows || []).map((s) => {
        const arr = typeof s === 'string' ? JSON.parse(s) : s;
        const obj = {};
        (r.Columns || []).forEach((c, i) => { obj[c] = arr[i]; });
        return obj;
      });
      return { rows, rowCount: r.AffectedRows ?? rows.length };
    },
    async end() {},
  };
}

async function getDirectBackend() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return { backend: 'direct', query: client.query.bind(client), end: () => client.end() };
}

export async function connectDb() {
  const backend = detectBackend();
  if (backend === 'direct') return getDirectBackend();
  if (backend === 'tcbapi') return getTcbApiBackend();
  console.error(
    '[deploy] 无法确定数据库后端：DATABASE_URL 为空/占位，且缺少 TCB_SECRET_ID/TCB_SECRET_KEY/TCB_ENV。\n' +
    '个人版环境无需 DATABASE_URL，请在 .env 填写 TCB 三件套。'
  );
  process.exit(1);
}
