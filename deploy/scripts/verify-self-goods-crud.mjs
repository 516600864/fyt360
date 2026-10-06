/**
 * admin-35b 自营商品 CRUD 全链验证（真实线上 HTTP API，测试数据自动清理）
 * 用法: ADMIN_INIT_PASSWORD=xxx node verify-self-goods-crud.mjs
 * 覆盖：登录 → 列表基线 → 拒绝路径 ×3 → POST 双SKU → 详情回显 → PUT 编辑 → 上下架 → DELETE → 404 → 数量还原
 */
import { loadDotEnv } from './lib/common.mjs';
loadDotEnv();

const BASE = 'https://mk.fyt360.cn/api';
const SITE = 'site-a'; // 写操作走 x-fyt-site（resolveWriteSite 契约）
let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const PWD = process.env.ADMIN_INIT_PASSWORD ?? '';
if (!PWD) { console.log('❌ 缺 ADMIN_INIT_PASSWORD'); process.exit(1); }

let TOKEN = '';
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', 'x-fyt-site': SITE, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
};

const login = await fetch(BASE + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: PWD }),
});
const lj = await login.json().catch(() => ({}));
ok(login.status === 200 && lj.ok, '管理员登录', `status=${login.status}`);
TOKEN = lj.data?.token ?? '';
if (!TOKEN) process.exit(1);

// 1. 列表基线
let r = await call('GET', '/admin/self-goods?tab=all&size=50');
ok(r.status === 200 && r.j.ok, 'GET 列表 200', `items=${r.j.data?.items?.length ?? '?'}`);
const baseline = r.j.data?.items?.length ?? 0;

// 2. 拒绝路径
r = await call('POST', '/admin/self-goods', { title: '坏商品', delivery_type: 'express', skus: [] });
ok(r.status === 400 && r.j.code === 'BAD_SKUS', '空 SKU → 400 BAD_SKUS', r.j.code);
r = await call('POST', '/admin/self-goods', { title: '坏商品', delivery_type: 'teleport', skus: [{ spec: '标准', price: 1, stock: 1 }] });
ok(r.status === 400 && r.j.code === 'BAD_DELIVERY', '非法履约方式 → 400 BAD_DELIVERY', r.j.code);
r = await call('POST', '/admin/self-goods', { title: '坏商品', delivery_type: 'express', skus: [{ spec: '标准', price: 0, stock: 1 }] });
ok(r.status === 400 && r.j.code === 'BAD_SKUS', '价格 0 → 400 BAD_SKUS', r.j.code);

// 3. 新增（双 SKU 快递）
const stamp = Date.now() % 100000;
r = await call('POST', '/admin/self-goods', {
  title: `验证商品-${stamp}（勿拍）`,
  delivery_type: 'express',
  main_imgs: ['https://dummy.fyt360.cn/a.png'],
  skus: [
    { spec: '标准装', price: 19.9, stock: 100 },
    { spec: '礼盒装', price: 39.9, stock: 8 },
  ],
});
ok(r.status === 200 && r.j.ok, 'POST 新增双 SKU 商品', `goods_id=${r.j.data?.goods_id}`);
const gid = r.j.data?.goods_id;

if (gid) {
  // 4. 详情回显
  r = await call('GET', `/admin/self-goods/${gid}`);
  const d = r.j.data ?? {};
  ok(r.status === 200 && d.title === `验证商品-${stamp}（勿拍）`, 'GET 详情回显标题');
  ok(Array.isArray(d.skus) && d.skus.length === 2 && Number(d.skus[0].price) === 19.9 && Number(d.skus[1].stock) === 8, 'SKU 双规格回显正确', JSON.stringify((d.skus ?? []).map((s) => ({ spec: s.spec, price: s.price, stock: s.stock }))));
  ok(d.status === 'on', '新商品默认上架');

  // 5. 编辑（改标题 + 切团购 + SKU 重建）
  r = await call('PUT', `/admin/self-goods/${gid}`, {
    title: `验证商品-${stamp}-改`,
    delivery_type: 'group',
    skus: [{ spec: '团购价', price: 9.9, stock: 50 }],
  });
  ok(r.status === 200 && r.j.ok, 'PUT 编辑（履约切团购+SKU 重建）');
  r = await call('GET', `/admin/self-goods/${gid}`);
  ok(r.j.data?.delivery_type === 'group' && r.j.data?.skus?.[0]?.spec === '团购价' && Number(r.j.data?.skus?.[0]?.price) === 9.9, '编辑后回显正确');

  // 6. 上下架
  r = await call('PATCH', `/admin/self-goods/${gid}/status`, { status: 'off' });
  ok(r.status === 200 && r.j.data?.status === 'off', 'PATCH 下架');
  r = await call('PATCH', `/admin/self-goods/${gid}/status`, { status: 'on' });
  ok(r.status === 200 && r.j.data?.status === 'on', 'PATCH 重新上架');

  // 7. 删除 + 确认 404
  r = await call('DELETE', `/admin/self-goods/${gid}`);
  ok(r.status === 200 && r.j.ok, 'DELETE 删除');
  r = await call('GET', `/admin/self-goods/${gid}`);
  ok(r.status === 404, '删除后 GET → 404');

  // 8. 列表数量还原
  r = await call('GET', '/admin/self-goods?tab=all&size=50');
  ok((r.j.data?.items?.length ?? 0) === baseline, '列表数量还原（无残留）', `baseline=${baseline} now=${r.j.data?.items?.length ?? 0}`);
}

console.log(`\n最终：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
