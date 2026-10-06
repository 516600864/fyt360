// 临时探查：品牌库现状（brand_category + brand_action_cfg）
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const gw = (sql, parameters = []) => fetch(GATEWAY, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
  body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
}).then(async (r) => [r.status, await r.text()]);

const [, catRaw] = await gw(`SELECT code, name FROM brand_category ORDER BY sort`);
const cats = JSON.parse(catRaw);
console.log('== brand_category ==', JSON.stringify(cats));

const [, brandRaw] = await gw(`SELECT category, brand_code, name, action_type, enabled, miniapp_cfg::text AS cfg FROM brand_action_cfg ORDER BY category, brand_code`);
const brands = JSON.parse(brandRaw);
console.log('== brand_action_cfg 总数 ==', brands.length);
const byCat = {};
for (const b of brands) {
  (byCat[b.category] ||= []).push(`${b.brand_code}|${b.name}|${b.action_type}|${b.enabled}|${b.cfg}`);
}
for (const [c, list] of Object.entries(byCat)) {
  console.log(`\n-- ${c} (${list.length}) --`);
  list.forEach((l) => console.log(' ', l));
}

const [, pcRaw] = await gw(`SELECT s.code AS site, pc.provider, left(pc.apikey, 6) || '...' AS key_head, pc.status FROM provider_config pc JOIN site s ON s.site_id = pc.site_id ORDER BY s.code, pc.provider`);
console.log('\n== provider_config ==\n' + JSON.stringify(JSON.parse(pcRaw), null, 1));
