// 探针：jd/goodslist「apikey错误！」定责 —— site-a / niwo 两把 key 直打上游对比
import fs from 'node:fs';
for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const { connectDb } = await import('./lib/db.mjs');
const db = await connectDb();

const keys = await db.query(`
  SELECT s.code, pc.apikey, pc.status
    FROM provider_config pc JOIN site s ON s.site_id = pc.site_id
   WHERE pc.provider='mayixingqiu' AND s.code IN ('site-a','niwo','yanshi')`);
await db.end();

for (const k of keys.rows) {
  const url = `http://api-gw.haojingke.com/index.php/v1/api/jd/goodslist?apikey=${encodeURIComponent(k.apikey)}&pageindex=1&pagesize=2`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const text = await res.text();
    console.log(`[${k.code}] HTTP ${res.status} → ${text.slice(0, 260)}`);
  } catch (e) {
    console.log(`[${k.code}] ❌ fetch 失败: ${e.message}`);
  }
}
