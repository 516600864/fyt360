// 共享工具：.env 加载（零依赖）+ 必填校验 + PG 连接
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, '..', '..', '..');

export function loadDotEnv() {
  const envPath = path.join(repoRoot, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

export function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length > 0) {
    console.error(`[deploy] 缺少必填环境变量，终止：\n  - ${missing.join('\n  - ')}\n请参照 .env.example 补齐（缺项明示原则）。`);
    process.exit(1);
  }
}

export async function connectDb() {
  requireEnv(['DATABASE_URL']);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}
