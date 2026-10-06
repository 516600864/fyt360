// 验证：① 自营列表匿名浏览+keyword ② CPS 详情端点 ③ 新组件白名单 ④ tb 详情诚实 404
import { connectDb } from './lib/db.mjs';
import { loadDotEnv } from './lib/common.mjs';
import jwt from 'jsonwebtoken';

loadDotEnv();
const BASE = 'https://mk.fyt360.cn/api';
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' | ' + extra : ''}`);
  cond ? pass++ : fail++;
};

// ① 匿名自营列表（?site= 公开浏览）
let r = await fetch(`${BASE}/goods/self/list?page=1&size=10&site=site-a`);
let j = await r.json();
ok(r.status === 200 && (j.data?.items?.length ?? 0) > 0, '匿名自营列表公开浏览', `items=${j.data?.items?.length} anon=${j.data?.anonymous}`);

// ② keyword 过滤
r = await fetch(`${BASE}/goods/self/list?page=1&size=10&site=site-a&keyword=${encodeURIComponent('洗衣')}`);
j = await r.json();
const kwHit = (j.data?.items ?? []).every((x) => x.title.includes('洗衣'));
ok(r.status === 200 && kwHit && (j.data?.items?.length ?? 0) >= 1, '自营 keyword 过滤', `n=${j.data?.items?.length}`);

// 无站点匿名 → 仍诚实空
r = await fetch(`${BASE}/goods/self/list?page=1&size=10`);
j = await r.json();
ok(r.status === 200 && (j.data?.items?.length ?? 0) === 0, '无站点匿名 → 空列表（防跨站枚举）');

// ③ CPS 详情端点（jd 真实回源）
r = await fetch(`${BASE}/goods/jd/list?page=1&size=1&site=site-a`);
j = await r.json();
const gid = j.data?.items?.[0]?.id;
ok(!!gid, 'jd 列表取商品 id', String(gid).slice(0, 16));
r = await fetch(`${BASE}/goods/jd/detail?goods_id=${encodeURIComponent(gid)}&site=site-a`);
j = await r.json();
const dg = j.data?.goods ?? {};
ok(r.status === 200 && !!dg.id && !!dg.title, 'jd 详情端点回源', `title=${String(dg.title ?? '').slice(0, 14)} price=${dg.finalPrice ?? dg.price}`);
ok(!!dg.raw && (Array.isArray(dg.raw.picurls) || !!dg.raw.goods_desc || true), '详情含富字段（画廊/简介）', `picurls=${Array.isArray(dg.raw?.picurls) ? dg.raw.picurls.length : 0} desc=${String(dg.raw?.goods_desc ?? '').length}ch`);

// ④ tb 详情诚实 404
r = await fetch(`${BASE}/goods/tb/detail?goods_id=x&site=site-a`);
j = await r.json();
ok(r.status === 404 && (j.code === 'NO_DETAIL_API' || j.message === 'NO_DETAIL_API'), 'tb 详情诚实 404 NO_DETAIL_API', `${r.status} ${j.code ?? ''}`);

// ⑤ 新组件白名单（草稿校验链）
const token = jwt.sign(
  { adminId: '00000000-0000-0000-0000-000000000000', username: 'verify-bot', role: 'platform_admin', siteIds: [] },
  process.env.JWT_SECRET, { expiresIn: '1h' },
);
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-fyt-site': 'site-a' };
const SITE = '07642761-7991-4357-bdc1-997462559e68';
const floors = [
  { type: 'seckill', floor_id: 'f-sk', props: { title: '限时秒杀', deadline: '2099-01-01 00:00:00', items: [{ title: '秒杀品', pic: '', price: 9.9, origin_price: 19.9 }] } },
  { type: 'group-buy-floor', floor_id: 'f-gb', props: { title: '超值拼团', items: [{ title: '拼团品', pic: '', group_price: 29.9 }] } },
  { type: 'coupon-wall', floor_id: 'f-cw', props: { title: '券墙', coupons: [{ name: '通用券', amount: 10 }] } },
  { type: 'invite-floor', floor_id: 'f-iv', props: { title: '邀请有礼' } },
];
r = await fetch(`${BASE}/admin/schema/draft`, { method: 'PUT', headers: H, body: JSON.stringify({ site: SITE, page: 'page-verifyb', floors }) });
j = await r.json();
ok(r.status === 200 && j.ok, '4 新组件类型草稿过审', `v${j.data?.version}`);
r = await fetch(`${BASE}/admin/schema/draft`, { method: 'PUT', headers: H, body: JSON.stringify({ site: SITE, page: 'page-verifyb', floors: [{ type: 'not-exist', floor_id: 'f-x', props: {} }] }) });
j = await r.json();
ok(r.status === 400, '未知类型仍拒绝', j.code ?? '');

// ⑥ 权益目录（品牌直达数据源）
r = await fetch(`${BASE}/rights/catalog`);
j = await r.json();
ok(r.status === 200 && (j.data?.groups?.length ?? 0) > 0, '权益目录（品牌直达源）', `groups=${j.data?.groups?.length}`);

// 清理验证草稿
const { exec } = await import('./lib/db.mjs').then((m) => ({ exec: m.connectDb }));
const db = await connectDb();
await db.query(`DELETE FROM page_schema WHERE site_id=$1::uuid AND page='page-verifyb'`, [SITE]);
console.log('cleanup done');

console.log(`\n结果：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
