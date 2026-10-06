#!/usr/bin/env node
/**
 * E2E：我的收藏 / 浏览足迹（决策 #41，画布 mini-06B / mini-06C）
 *
 * ⛔ 铁律：断言真实 DB 数据 + 真实 HTTP 响应，不接受"函数返回非空"。
 *
 * 覆盖：
 *   ① 鉴权：未登录 401（不能匿名读写他人收藏）
 *   ② 收藏 CRUD + 幂等（重复收藏不产生第二行，created_at 刷新=置顶）
 *   ③ 足迹写入 + 去重（同一入口重复浏览只刷 viewed_at，不堆行）
 *   ④ 足迹三条硬规则：上限 200 条 / 保留 30 天 / 按今天·昨天·更早分组
 *   ⑤ 站点隔离铁律（决策 #27）：带 site_id，切站点看不到别家的
 *   ⑥ 失效态：自营商品下架 → alive=false + reason=已下架
 *   ⑦ 单条删除 + 全部清空
 *   ⑧ 只存指针不存快照：库里没有 price/stock 列
 *
 * 登录：C端 /api/auth/clogin 需真实微信 code（E2E 拿不到），
 *   故按server/src/middleware/auth.ts 的 signUserToken 规则本地签测试 token
 *   （typ=user + userId + siteId，与线上完全同构）。
 */
import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const GATEWAY = `https://${env.TCB_ENV}.api.tcloudbasegateway.com/v1/rdb/exec-pgsql`;
const BASE = 'https://mk.fyt360.cn';

let pass = 0; let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
}

/** exec-pgsql 带退避重试（高频连发会偶发 DATABASE_EXEC_ERROR，见项目记忆） */
async function db(sql, p = []) {
  for (let a = 1; a <= 4; a++) {
    const j = await fetch(GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TCB_API_KEY}` },
      body: JSON.stringify({ sql, parameters: p, role: 'cloudbase_postgres' }),
    }).then((r) => r.json());
    if (Array.isArray(j)) {
      if (j.length && Object.keys(j[0]).some((k) => k.startsWith('?column'))) {
        throw new Error(`SQL 失败: ${JSON.stringify(j[0]).slice(0, 200)}`);
      }
      return j;
    }
    if (a < 4) await new Promise((r) => setTimeout(r, 400 * a));
  }
  throw new Error('网关重试 4 次仍失败');
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** 与 server signUserToken 同构：HS256，payload {userId, siteId, typ:'user', iat, exp} */
function signUserToken(userId, siteId) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ userId, siteId, typ: 'user', iat: now, exp: now + 86400 });
  const sig = createHmac('sha256', env.JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

async function hit(path, token, method = 'GET', data) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

console.log('=== 收藏 / 足迹 E2E（决策 #41）===\n');

// ── 准备：取一个真实站点 + 一个真实自营商品 ──
const sites = await db(`SELECT site_id::text AS id, code FROM site ORDER BY created_at LIMIT 2`);
const siteA = sites[0].id;
const goods = await db(
  `SELECT goods_id::text AS gid, title, status FROM self_goods WHERE site_id::text IN ($1) ORDER BY goods_id LIMIT 1`,
  [siteA],
);
ok(!!siteA, `取到测试站点 ${sites[0].code} = ${siteA}`);

const testUser = Number(process.env.TEST_USER_ID ?? 0);
if (!testUser) {
  const u = await db(`SELECT user_id FROM "user" WHERE site_id::text IN ($1) ORDER BY user_id LIMIT 1`, [siteA]);
  if (!u[0]) { console.error('❌ 该站点无用户，无法测。先造数据。'); process.exit(1); }
  var USER_ID = Number(u[0].user_id);
} else var USER_ID = testUser;
const TOKEN = signUserToken(USER_ID, siteA);

// 清理本测试用户的收藏/足迹，保证断言可重复
await db(`DELETE FROM user_favorite WHERE user_id = $1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);
await db(`DELETE FROM user_footprint WHERE user_id = $1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);

// ══ ① 未登录必须 401 ══
console.log('【1】鉴权：匿名不可读写');
{
  const r1 = await hit('/api/me/favorites', '');
  ok(r1.status === 401, `匿名 GET /api/me/favorites → ${r1.status}（期望 401）`);
  const r2 = await hit('/api/me/footprints', '', 'POST', { kind: 'self_goods', ref_id: 'x', title: 'x' });
  ok(r2.status === 401, `匿名 POST /api/me/footprints → ${r2.status}（期望 401）`);
  const r3 = await hit('/api/me/favorites', '', 'DELETE');
  ok(r3.status === 401, `匿名 DELETE /api/me/favorites → ${r3.status}（期望 401）`);
}

// ══ ② 收藏 CRUD + 幂等 ══
console.log('\n【2】收藏 CRUD + 幂等');
{
  const gid = goods[0]?.gid ?? '1';
  const r = await hit('/api/me/favorites', TOKEN, 'POST', { kind: 'self_goods', ref_id: gid, title: '测试团购A', icon_char: '测' });
  ok(r.status === 200 && r.body.data?.favorited === true, `收藏成功（${r.status}）`);

  const cnt1 = await db(`SELECT COUNT(*)::int c FROM user_favorite WHERE user_id=$1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);
  ok(cnt1[0].c === 1, `入库 1 行（${cnt1[0].c}）`);

  // 幂等：重复收藏不得新增第二行
  const r2 = await hit('/api/me/favorites', TOKEN, 'POST', { kind: 'self_goods', ref_id: gid, title: '测试团购A', icon_char: '测' });
  const cnt2 = await db(`SELECT COUNT(*)::int c FROM user_favorite WHERE user_id=$1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);
  ok(cnt2[0].c === 1, `重复收藏幂等，仍 1 行（${cnt2[0].c}）`);

  const list = await hit('/api/me/favorites', TOKEN);
  const item = list.body.data?.items?.[0];
  ok(!!item && item.title === '测试团购A', `列表返回冗余标题 = ${item?.title}`);
  ok('alive' in (item ?? {}), `列表项带失效态alive 字段（${item?.alive}）`);
  ok(item?.reason === undefined, `有效项无 reason（当前 ${item?.reason ?? '无'}）`);

  // 收藏态查询（商详页那颗 ♡ 用）
  const st = await hit(`/api/me/favorites/state?kind=self_goods&ref_id=${encodeURIComponent(gid)}`, TOKEN);
  ok(st.body.data?.favorited === true, `state 查询已收藏 = ${st.body.data?.favorited}`);

  // 单条删除
  const del = await hit(`/api/me/favorites/${item.id}`, TOKEN, 'DELETE');
  ok(del.status === 200 && del.body.data?.removed === true, `单条删除成功（${del.status}）`);
  const cnt3 = await db(`SELECT COUNT(*)::int c FROM user_favorite WHERE user_id=$1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);
  ok(cnt3[0].c === 0, `删除后 0 行（${cnt3[0].c}）`);
}

// ══ ③ 足迹去重 ══
console.log('\n【3】足迹写入 + 去重（重复浏览不堆行）');
{
  const gid = goods[0]?.gid ?? '1';
  for (let i = 0; i < 3; i++) {
    await hit('/api/me/footprints', TOKEN, 'POST', { kind: 'self_goods', ref_id: gid, title: '足迹商品', icon_char: '迹' });
    if (i < 2) await new Promise((r) => setTimeout(r, 1100)); // 拉开时间便于验证 viewed_at 刷新
  }
  const c = await db(`SELECT COUNT(*)::int c, MAX(viewed_at) AS latest FROM user_footprint WHERE user_id=$1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);
  ok(c[0].c === 1, `连写 3 次仍只有 1 行（${c[0].c}）—— 唯一索引去重生效`);
  const fresh = new Date(c[0].latest).getTime();
  ok(Date.now() - fresh < 60_000, `viewed_at 被刷新到最近（${c[0].latest}）`);
}

// ══ ④ 足迹三条硬规则 ══
console.log('\n【4】足迹硬规则：200 条上限 / 30 天保留 / 时间分组');
{
  // 造超量数据：批量插 260 条，验证自动裁到 200
  const rows = Array.from({ length: 260 }, (_, i) =>
    `(${USER_ID},'${siteA}'::uuid,'cps_goods','bulk_${i}','批量商品${i}','', now() - interval '${i} minutes')`).join(',');
  await db(`INSERT INTO user_footprint (user_id, site_id, kind, ref_id, title, icon_char, viewed_at) VALUES ${rows}
            ON CONFLICT (user_id, site_id, kind, ref_id) DO NOTHING`);
  // 再造一条 60 天前的（超保留期）
  await db(`INSERT INTO user_footprint (user_id, site_id, kind, ref_id, title, icon_char, viewed_at)
            VALUES ($1::bigint,$2::uuid,'cps_goods','ancient_1','很久以前看的','', now() - interval '60 days')
            ON CONFLICT (user_id, site_id, kind, ref_id) DO NOTHING`, [USER_ID, siteA]);

  const before = await db(`SELECT COUNT(*)::int c FROM user_footprint WHERE user_id=$1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);
  ok(before[0].c > 200, `造数据后 ${before[0].c} 条（>200）`);

  // 触发一次写入 → 内部 prune
  await hit('/api/me/footprints', TOKEN, 'POST', { kind: 'cps_goods', ref_id: 'trigger_prune', title: '触发裁剪' });

  const after = await db(`SELECT COUNT(*)::int c FROM user_footprint WHERE user_id=$1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);
  ok(after[0].c <= 200, `写入后自动裁到 ≤200（实为 ${after[0].c}）`);

  const old = await db(`SELECT COUNT(*)::int c FROM user_footprint WHERE user_id=$1::bigint AND site_id::text IN ($2) AND viewed_at < now() - interval '30 days'`, [USER_ID, siteA]);
  ok(old[0].c === 0, `超 30 天的记录已淘汰（残留 ${old[0].c}）`);

  // 时间分组
  const fp = await hit('/api/me/footprints', TOKEN);
  const d = fp.body.data;
  ok(!!d?.limits && d.limits.max_rows === 200 && d.limits.keep_days === 30,
    `接口下发真实上限 ${JSON.stringify(d?.limits)}（UI 文案与服务端同源）`);
  ok(!!d?.counts && (d.counts.today + d.counts.yesterday + d.counts.earlier) === d.total,
    `分组计数自洽：${JSON.stringify(d?.counts)} 合计 ${d?.total}`);
  ok(d?.items?.every((i) => ['today', 'yesterday', 'earlier'].includes(i.group)),
    '每条都带合法 group（今天/昨天/更早，端上不自算日界）');
}

// ══ ⑤ 站点隔离（决策 #27）══
console.log('\n【5】站点隔离：跟站点不跟人');
if (sites.length > 1) {
  const siteB = sites[1].id;
  const TOKEN_B = signUserToken(USER_ID, siteB);
  // ⛔ 本节必须自造数据：原实现依赖 §3 的残留，而【8】的「无参清空」会把它清空
  //   —— 脚本第二次跑必然假红（E2E 不可重复运行 = 形同虚设）。此处造完即用，用完即清。
  await db(`INSERT INTO user_favorite (user_id, site_id, kind, ref_id, title, icon_char)
            VALUES ($1::bigint,$2::uuid,'cps_goods','iso_probe_1','隔离探针','')
            ON CONFLICT (user_id, site_id, kind, ref_id) DO NOTHING`, [USER_ID, siteA]);
  await db(`INSERT INTO user_footprint (user_id, site_id, kind, ref_id, title, icon_char, viewed_at)
            VALUES ($1::bigint,$2::uuid,'cps_goods','iso_probe_1','隔离探针','', now())
            ON CONFLICT (user_id, site_id, kind, ref_id) DO NOTHING`, [USER_ID, siteA]);

  const listB = await hit('/api/me/favorites', TOKEN_B);
  ok((listB.body.data?.total ?? 0) === 0, `切到 ${sites[1].code} 后收藏列表为空（隔离生效）`);
  const fpB = await hit('/api/me/footprints', TOKEN_B);
  ok((fpB.body.data?.total ?? 0) === 0, `切站后足迹为空（隔离生效）`);

  // A 站的收藏在 A 站仍可见
  const listA = await hit('/api/me/favorites', TOKEN);
  ok((listA.body.data?.total ?? 0) > 0, `回到${sites[0].code} 收藏仍在（${listA.body.data?.total} 条）`);
  const fpA = await hit('/api/me/footprints', TOKEN);
  ok((fpA.body.data?.total ?? 0) > 0, `回到${sites[0].code} 足迹仍在（${fpA.body.data?.total} 条）`);

  // 收尾清掉探针，避免污染 §8 的清空计数
  await db(`DELETE FROM user_favorite WHERE user_id=$1::bigint AND ref_id='iso_probe_1'`, [USER_ID]);
  await db(`DELETE FROM user_footprint WHERE user_id=$1::bigint AND ref_id='iso_probe_1'`, [USER_ID]);
} else {
  console.log('  ⚠ 仅 1 个站点，跳过隔离断言（需多站点环境）');
}
// 表结构层面：两表都带 site_id
{
  const cols = await db(`SELECT table_name, column_name FROM information_schema.columns
                          WHERE table_name IN ('user_favorite','user_footprint') AND column_name='site_id'`);
  ok(cols.length === 2, `两表都带 site_id 列（${cols.length}/2）`);
}

// ══ ⑥ 失效态 ══
console.log('\n【6】失效态：商品下架 → alive=false');
{
  const g = goods[0];
  if (g) {
    await db(`UPDATE self_goods SET status='off' WHERE goods_id::text = $1`, [g.gid]);
    await hit('/api/me/favorites', TOKEN, 'POST', { kind: 'self_goods', ref_id: g.gid, title: g.title, icon_char: 'X' });
    const list = await hit('/api/me/favorites', TOKEN);
    const item = list.body.data?.items?.find((i) => i.ref_id === g.gid);
    ok(item?.alive === false, `下架商品 alive=false（实为 ${item?.alive}）`);
    ok(item?.reason === '已下架', `失效项带 reason=已下架（${item?.reason}）`);

    const fpl = await hit('/api/me/footprints', TOKEN);
    const fitem = fpl.body.data?.items?.find((i) => i.ref_id === g.gid);
    ok(fitem?.alive === false, `足迹同样标失效（${fitem?.alive}）`);

    // 复原，避免污染后续开发
    await db(`UPDATE self_goods SET status='on' WHERE goods_id::text = $1`, [g.gid]);
  } else console.log('  ⚠ 无真实自营商品，跳过失效态断言');
}

// ══ ⑦ 只存指针不存快照（铁律①的表结构级证据）══
console.log('\n【7】只存指针不存快照：库里无价格/库存列');
{
  const cols = await db(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_name IN ('user_favorite','user_footprint')
      AND column_name IN ('price','stock','pic','imgs','cover','sku','detail')`);
  ok(cols.length === 0, `两表无任何价格/库存/图片列（实测 ${cols.length} 个）`);
  const cols2 = await db(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_name IN ('user_favorite','user_footprint') ORDER BY table_name, column_name`);
  const names = cols2.map((r) => r.column_name);
  ok(names.includes('title'), '有 title 冗余列（铁律②：否则列表逐行请求必卡死）');
  ok(names.includes('ref_id') && names.includes('kind'), '有 kind + ref_id 指针列');
}

// ══ ⑧ 单条删除 + 全部清空 ══
console.log('\n【8】单条删除 + 全部清空');
{
  const fp = await hit('/api/me/footprints', TOKEN);
  const first = fp.body.data?.items?.[0];
  ok(!!first, `当前 ${fp.body.data?.total} 条足迹`);
  const d1 = await hit(`/api/me/footprints/${first.id}`, TOKEN, 'DELETE');
  ok(d1.status === 200 && d1.body.data?.removed === true, '单条删除成功');

  const total2 = (await hit('/api/me/footprints', TOKEN)).body.data?.total ?? 0;
  ok(total2 === fp.body.data.total - 1, `删后剩 ${total2} 条（原 ${fp.body.data.total}）`);

  // ⛔ 06C 的主路径：底部「清空」走的就是无参 DELETE /api/me/footprints。
  //    Express 按注册顺序匹配，若无参路由排在 /footprints/:id 之后，
  //    空串会被当 id 吞掉 → 清空永远返回 0 条（清不掉的假成功）。
  const clr = await hit('/api/me/footprints', TOKEN, 'DELETE');
  ok(clr.status === 200 && (clr.body.data?.cleared ?? 0) > 0,
    `无参清空真删到行：cleared=${clr.body.data?.cleared}（原 ${total2} 条）`);
  const total3 = (await hit('/api/me/footprints', TOKEN)).body.data?.total ?? 0;
  ok(total3 === 0, `清空后 0 条（${total3}）`);

  // 无参收藏清空同样验一次（注册顺序同类问题）
  await db(`DELETE FROM user_favorite WHERE user_id = $1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);
  await hit('/api/me/favorites', TOKEN, 'POST', { kind: 'self_goods', ref_id: 'c1', title: 'X1' });
  await hit('/api/me/favorites', TOKEN, 'POST', { kind: 'cps_goods', ref_id: 'c2', title: 'X2' });
  const favBefore = (await hit('/api/me/favorites', TOKEN)).body.data?.total ?? 0;
  const fc = await hit('/api/me/favorites', TOKEN, 'DELETE');
  ok(fc.status === 200 && (fc.body.data?.cleared ?? 0) === favBefore && favBefore > 0,
    `无参收藏清空真删到行：cleared=${fc.body.data?.cleared}（期望 ${favBefore}）`);
}

// 收尾清理
await db(`DELETE FROM user_favorite WHERE user_id = $1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);
await db(`DELETE FROM user_footprint WHERE user_id = $1::bigint AND site_id::text IN ($2)`, [USER_ID, siteA]);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);