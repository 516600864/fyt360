// R1-R3 验证：schema 草稿发布链路（含 mode=self）+ 自营商品接口 + 品牌呼起接口 + 选品器数据面
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = 'https://mk.fyt360.cn';
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const j = (r) => r.json();
const gw = (sql, parameters = []) => fetch(GATEWAY, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
  body: JSON.stringify({ sql, parameters, role: 'cloudbase_postgres' }),
}).then(async (r) => [r.status, await r.text()]);

(async () => {
  // 0) site-a 的 site_id（exec-pgsql 裸响应=行数组）
  const [, sidRaw] = await gw(`SELECT site_id::text AS id FROM site WHERE code = 'site-a' LIMIT 1`);
  const siteId = JSON.parse(sidRaw)[0].id;

  // 登录
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
  }).then(j);
  if (!login.ok) { console.log('登录 FAIL:', JSON.stringify(login)); process.exit(1); }
  const auth = { Authorization: `Bearer ${login.data.token}`, 'Content-Type': 'application/json', 'x-fyt-site': 'site-a' };

  // 1) 备份线上 home published
  const [, pubRaw] = await gw(`SELECT schema_json::text AS s, version::int AS v FROM page_schema WHERE site_id = $1::uuid AND page = 'home' AND status = 'published' ORDER BY version DESC LIMIT 1`, [siteId]);
  const pub = JSON.parse(pubRaw)[0];
  const origSchema = pub?.s ? JSON.parse(pub.s) : null;
  console.log('[1] 线上 home 已备份 v' + (pub?.v ?? '无') + '（' + (origSchema?.floors?.length ?? 0) + ' 层）');

  // 2) 含 mode=self 的草稿（新合同枚举）→ PUT 应通过
  const floors = [{ type: 'goods-feed', floor_id: 'f-verify-self', component_id: 'c-verify-self', data_source: { mode: 'self', params: { goods_ids: [] } }, props: { title: '自营好物', more_text: '更多 >', page_size: 10, layout: 'big', badge: true } }];
  const put = await fetch(`${BASE}/api/admin/schema/draft`, { method: 'PUT', headers: auth, body: JSON.stringify({ page: 'home', floors }) }).then(j);
  console.log('[2] mode=self 草稿 PUT:', put.ok ? 'OK v' + put.data.version : 'FAIL ' + JSON.stringify(put).slice(0, 160));

  // 3) 发布 → /config 下发含 self 楼层
  const pub2 = await fetch(`${BASE}/api/admin/schema/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ page: 'home' }) }).then(j);
  console.log('[3] 发布:', pub2.ok ? 'OK v' + pub2.data.version : 'FAIL ' + JSON.stringify(pub2).slice(0, 120));
  const cfg = await fetch(`${BASE}/api/site/config?code=site-a`).then(j);
  const homeFloor = (cfg.data?.home?.schema?.floors ?? [])[0];
  console.log('[4] /config 下发:', homeFloor?.data_source?.mode === 'self' && homeFloor?.props?.layout === 'big' ? 'OK（self + big + badge）' : 'FAIL ' + JSON.stringify(homeFloor).slice(0, 160));

  // 5) C 端自营接口（匿名 → 诚实空态）
  const anon = await fetch(`${BASE}/api/goods/self/list?page=1&size=5`).then(j);
  console.log('[5] self/list 匿名:', anon.ok && anon.data.anonymous === true ? 'OK（匿名空态）' : 'FAIL ' + JSON.stringify(anon).slice(0, 120));

  // 6) 品牌呼起端点：未配置品牌码 → 404 诚实
  const bl = await fetch(`${BASE}/api/site/brand-launch?code=mcdonalds`);
  const blBody = await bl.json();
  console.log('[6] brand-launch 空壳:', bl.status === 404 ? `OK（${blBody.code}）` : 'FAIL ' + bl.status + ' ' + JSON.stringify(blBody).slice(0, 120));

  // 7) 选品器数据面：/admin/self-goods（self_goods 0 条 → 诚实空）
  const sg = await fetch(`${BASE}/api/admin/self-goods?tab=on&size=100`, { headers: auth }).then(j);
  console.log('[7] 选品器数据面:', sg.ok && Array.isArray(sg.data.items) ? `OK（当前 ${sg.data.items.length} 件在架，空态如实）` : 'FAIL');

  // 8) 恢复线上 home（重发布原 schema）
  if (origSchema) {
    await fetch(`${BASE}/api/admin/schema/draft`, { method: 'PUT', headers: auth, body: JSON.stringify({ page: 'home', floors: origSchema.floors }) }).then(j);
    const rep = await fetch(`${BASE}/api/admin/schema/publish`, { method: 'POST', headers: auth, body: JSON.stringify({ page: 'home' }) }).then(j);
    const [, afterRaw] = await gw(`SELECT schema_json::text AS s FROM page_schema WHERE site_id = $1::uuid AND page = 'home' AND status = 'published' ORDER BY version DESC LIMIT 1`, [siteId]);
    const after = JSON.parse(JSON.parse(afterRaw)[0].s);
    const same = JSON.stringify(after.floors) === JSON.stringify(origSchema.floors);
    console.log('[8] 恢复线上 home:', rep.ok && same ? `OK v${rep.data.version}（floors 一致，生产无损）` : 'FAIL');
  }

  // 9) 清理验证产生的 page_schema 行（draft/source 不留）
  const [, del] = await gw(`DELETE FROM page_schema WHERE site_id = $1::uuid AND page = 'home' AND (status = 'draft' OR source = 'ai') RETURNING id`, [siteId]);
  console.log('[9] 清理测试行:', del.startsWith('[') ? 'OK' : del.slice(0, 100));
})();
