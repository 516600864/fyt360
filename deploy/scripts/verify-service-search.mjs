#!/usr/bin/env node
/**
 * E2E：07B「服务直达」聚合搜索（D先生 定稿 2026-10-03）
 *
 * 验证要点（每条都对应本轮修的一个真实缺陷）：
 *  A1搜「肯德基」到店服务命中 plugin 轨道
 *  A2 搜「肯德基」权益兑换命中 fasttype cid —— 旧实现被同名去重吃掉，此处断言两条**并存**
 *  A3 权益积分口径：字段是 points_min/max（蚂蚁侧积分），不是元宝
 *  B1 搜「美团」分类命中 meituan 且 count=32
 *  B2 搜「美团」分类展开补出名字不含「美团」的服务（闪购红包/大牌饮品）—— 旧 brand-search 只有 5 条
 *  B3 分类展开项标记 via_category（前端折叠 6 条 + 展开全部的依据）
 *  C1 搜「星巴克」跨源：plugin 服务 + fasttype 权益若命中
 *  D1 必填字段完整性：每条都带 track（端上分发唯一依据）
 *  D2 非法入参 400 诚实报错
 *
 * 用法：node deploy/scripts/verify-service-search.mjs
 */
import 'dotenv/config';

const BASE = process.env.CRON_BASE_URL ?? `https://${process.env.TCB_ENV}.tcloudbaseapp.com`;
let pass = 0;
let fail = 0;

const ok = (cond, label, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

async function search(kw) {
  const r = await fetch(`${BASE}/api/site/service-search?keyword=${encodeURIComponent(kw)}`);
  return { status: r.status, json: await r.json().catch(() => null) };
}

const direct = (d) => (d?.services ?? []).filter((s) => !s.via_category);
const expanded = (d) => (d?.services ?? []).filter((s) => s.via_category);

console.log('\n─── 07B 服务直达聚合搜索 E2E ───\n');

// ── A组：搜「肯德基」——两条异质轨道必须并存（旧实现被同名去重吃掉一条）──
{
  const kw = '肯德基';
  const { status, json } = await search(kw);
  ok(status === 200 && json?.ok, `「${kw}」端点 200`, `status=${status}`);
  const d = json?.data ?? {};
  const svc = direct(d).find((s) => s.name === '肯德基');
  ok(!!svc, 'A1 到店服务命中「肯德基」', svc ? `track=${svc.track} mode=${svc.mode}` : '未命中');
  ok(svc?.track === 'plugin', 'A1b轨道=plugin（点餐插件）', `实际 ${svc?.track}`);

  const rt = (d.rights ?? []).find((r) => r.brand_name === '肯德基');
  ok(!!rt, 'A2 权益兑换命中「肯德基」（与plugin 并存，旧实现此处为空）', rt ? `cid=${rt.cid}` : '未命中');
  ok(Number(rt?.cid) > 0, 'A2b 权益带 cid 兑换档位（能拼出弹窗参数）', `cid=${rt?.cid}`);
  ok(rt && rt.points_min > 0 && rt.points_max >= rt.points_min,
    'A3 权益为积分口径（points_min/max，非元宝）',
    rt ? `${rt.points_min}~${rt.points_max} 积分` : '无');
}

// ── B 组：搜「美团」——分类命中展开（旧 brand-search 只命中 5/32）──
{
  const kw = '美团';
  const { json } = await search(kw);
  const d = json?.data ?? {};
  const cat = (d.categories ?? []).find((c) => c.code === 'meituan');
  ok(!!cat, `B1 分类命中 meituan`, cat ? `${cat.name} 共 ${cat.count} 个服务` : '未命中');
  ok(cat?.count === 32, 'B1b 分类服务数=32', `实际 ${cat?.count}`);

  const exp = expanded(d);
  ok(exp.length >= 25, `B2 分类展开补出大量服务（名字不含「美团」的）`, `展开 ${exp.length} 条`);
  // 旧 brand-search 搜「美团」只能命中 5 条，这几个必须靠分类展开才能出来
  for (const must of ['闪购红包', '大牌饮品', '外卖红包', '甄选好店']) {
    ok(exp.some((s) => s.name === must), `B2b 含「${must}」（分类展开增量）`);
  }
  ok(exp.every((s) => s.via_category === true), 'B3 展开项均标记 via_category（前端折叠依据）');
  ok(exp.every((s) => s.brand_code && s.track), 'B3b 展开项带brand_code + track');
}

// ── C 组：跨源与字段完整性 ──
{
  const { json } = await search('星巴克');
  const d = json?.data ?? {};
  ok(direct(d).length > 0, 'C1 搜「星巴克」到店服务命中', `${direct(d).length} 条`);

  const { json: j2 } = await search('美团');
  const all = [...(j2?.data?.services ?? []), ...(j2?.data?.rights ?? []), ...(j2?.data?.selfItems ?? [])];
  ok(all.length > 0 && all.every((x) => !!x.track), 'D1 全部命中项均带 track（分发唯一依据）', `${all.length} 项`);
  ok(all.every((x) => !!x.name), 'D1b 全部命中项均有展示名');

  const bad = await fetch(`${BASE}/api/site/service-search?keyword=`);
  ok(bad.status === 400, 'D2 空关键词 400 诚实报错', `status=${bad.status}`);
}

// ── E 组：性能与稳定性（2026-10-03 修「搜京东还是卡死」后二次收紧）────────────
// 首版断言（<8s / warm<3s）在「遮罩被 CPS 拖死 + 冷实例 3.2s」时依然全绿 —— 阈值太松等于没测。
// 本轮按实测数据重定：warm 0.2~0.5s、冷实例 3.2s、上游 0.2~0.5s。
{
  // E1：搜「京东」连续 5 次，单次必须 < 3s。冷实例 3.19s 曾超出此线，故留足余量的同时仍能抓住回归。
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await search('京东');
    times.push(Date.now() - t0);
  }
  const worst = Math.max(...times);
  ok(worst < 3000, 'E1 搜「京东」5 次中最慢 <3s（冷实例 3.2s 为反例基线）', `耗时 ${times.join('/')}ms`);

  // E2：结果级缓存（60s TTL）生效 → 重复调用应为亚秒级
  await search('京东'); // 预热
  const t0 = Date.now();
  const { json: c2 } = await search('京东');
  const warm = Date.now() - t0;
  ok(warm < 1500, 'E2 结果级缓存生效，重复搜索 <1.5s', `warm=${warm}ms`);

  // E2b：命中结果级缓存时服务端应回 cached:true（可直接观测缓存是否真生效）
  const { json: c2b } = await search('京东');
  ok(c2b?.cached === true, 'E2b 重复搜索命中服务端结果级缓存（cached=true）', `cached=${c2b?.cached}`);

  // E3：缓存不改变结果集（权益条数必须一致）
  const { json: c1 } = await search('美团');
  const { json: c3 } = await search('美团');
  ok((c1?.data?.rights ?? []).length === (c3?.data?.rights ?? []).length,
    'E3 缓存不改变结果集', `rights ${(c1?.data?.rights ?? []).length} vs ${(c3?.data?.rights ?? []).length}`);

  // E4：京东这类「分类命中 + 权益命中」并发最重的词，服务端不得 5xx
  const { status } = await fetch(`${BASE}/api/site/service-search?keyword=${encodeURIComponent('京东')}`);
  ok(status === 200, 'E4 搜「京东」HTTP 200', `status=${status}`);

  // E5：不同关键词互不串味（缓存 key 必须含关键词，防止命中他词结果）
  const { json: k1 } = await search('肯德基');
  const { json: k2 } = await search('星巴克');
  ok(k1?.data?.keyword === '肯德基' && k2?.data?.keyword === '星巴克',
    'E5 缓存按关键词隔离，不串味', `${k1?.data?.keyword} / ${k2?.data?.keyword}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);