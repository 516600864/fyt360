// migrate：执行 migrations/*.sql（幂等 SQL，可重复跑）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, repoRoot } from './lib/common.mjs';
import { connectDb } from './lib/db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  loadDotEnv();
  const dir = path.join(repoRoot, 'deploy', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.error('[migrate] migrations 目录下没有 SQL 文件');
    process.exit(1);
  }

  const client = await connectDb();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      process.stdout.write(`[migrate] ${file} (${client.backend}) ... `);
      await client.query(sql);
      console.log('OK');
    }
    console.log('[migrate] 全部迁移执行完成（幂等，可重复执行）');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('[migrate] 失败：', e.message);
  process.exit(1);
});
