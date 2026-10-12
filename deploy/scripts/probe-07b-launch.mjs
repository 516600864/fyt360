// 探针：07B 搜索命中「淘宝闪购/饿了么」→ brand-launch 呼起链路全量实锤
import fs from 'node:fs';
for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}
const { connectDb } = await import('./lib/db.mjs');
const db = await connectDb();

const BASE = 'https://mk.fyt360.cn/api';
const JWT = (await import('jsonwebtoken')).default;
// niwo user 25 真实 JWT（与 verify-chat-site-key 同款签法）
const site = (await db.query("SELECT site_id FROM site WHERE code='niwo'")).rows[0];
const userToken = JWT.sign({ typ: 'user', userId: 25, siteId: site.site_id }, process.env.JWT_SECRET);

// 1) 07B 搜索命中
for (const kw of ['淘宝闪购', '饿了么']) {
  const r = await fetch(`${BASE}/site/service-search?keyword=${encodeURIComponent(kw)}`, {
    headers: { Authorization: `Bearer ${userToken}` },
  }).then((x) => x.json()).catch((e) => ({ err: String(e) }));
  const svcs = r?.data?.services ?? [];
  console.log(`\n=== 07B「${kw}」services = ${svcs.length} ===`);
  for (const s of svcs.slice(0, 8)) {
    console.log(`  track=${s.track} mode=${s.mode} code=${s.brand_code} name=${s.name} cat=${s.cat_name}`);
  }
  // 2) 逐个 brand-launch 呼起
  for (const s of svcs.slice(0, 4)) {
    const lr = await fetch(`${BASE}/site/brand-launch?code=${encodeURIComponent(s.brand_code)}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const lj = await lr.json().catch(() => null);
    const d = lj?.data ?? {};
    console.log(`  [launch ${s.brand_code}] HTTP ${lr.status} mode=${d.mode ?? '-'} appid=${(d.appid || '').slice(0, 8)} path=${String(d.path || '').slice(0, 40)} url=${String(d.url || '').slice(0, 50)} err=${lj?.error?.message ?? lj?.message ?? ''} code=${lj?.code ?? ''}`);
  }
}

// 3) DB 侧查这几行的配置与健康状态
const dbg = await db.query(`
  SELECT brand_code, name, category, action_type, miniapp_cfg, enabled, health_status, sync_source
    FROM brand_action_cfg
   WHERE name ILIKE '%淘宝闪购%' OR name ILIKE '%饿了么%' OR name ILIKE '%闪购%'
   ORDER BY enabled DESC LIMIT 10`);
console.log('\n=== DB brand_action_cfg ===');
for (const r of dbg.rows) {
  console.log(`  ${r.brand_code} | ${r.name} | cat=${r.category} | type=${r.action_type} | cfg=${JSON.stringify(r.miniapp_cfg)} | enabled=${r.enabled} | health=${r.health_status ?? '-'} | src=${r.sync_source ?? '-'}`);
}
await db.end();
