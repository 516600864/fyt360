#!/usr/bin/env node
/**
 * E2E：07B「相关搜索」真实词表 + 搜索词上报（032 迁移，2026-10-03）
 *
 * 验证要点（每条都对应本轮修/防的一个真实问题）：
 *  F1 GET /api/site/hot-words 端点 200 且返回非空词表
 *  F2 **词必须能搜出结果**（旧硬编码「每日坚果」「空气炸锅」站内无此商品 → 必零结果，AI 加戏）
 *  F3 **不得含已废弃的自造词**（每日坚果/空气炸锅 明确不得出现）
 *  F4 权重降序（PG 踩过：SELECT weight::text + ORDER BY weight → 字典序 → "1000"<"600" 排序全乱）
 *  F5 60s 结果级缓存生效（cached:true）+ 不改词表
 *  F6 limit 参数生效且有上限（防一次拉爆）
 *  F7 POST /api/site/search-log 上报入库（匿名可报，不阻塞搜索）
 *  F8 空词 400 诚实报错
 *
 * 用法：node deploy/scripts/verify-hotwords.mjs
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

async function hotwords(limit = 20) {
  const r = await fetch(`${BASE}/api/site/hot-words?limit=${limit}`);
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function search(kw) {
  const r = await fetch(`${BASE}/api/site/service-search?keyword=${encodeURIComponent(kw)}`);
  return r.json().catch(() => null);
}

console.log('\n─── 07B 相关搜索真实词表 E2E ───\n');

// ── F 组：热词端点 ──────────────────────────────────────────────────────────
{
  const { status, json } = await hotwords(20);
  ok(status === 200, 'F1 热词端点 HTTP 200', `status=${status}`);

  const words = json?.data?.words ?? [];
  ok(words.length > 0, 'F1b 词表非空', `${words.length} 词`);
  ok(words.every((w) => typeof w.word === 'string' && w.word.length > 0), 'F1c 每项都有非空 word');
  ok(words.every((w) => w.weight !== undefined && w.weight !== null), 'F1d 每项都带 weight（网关须返回字符串）');
}

// ── F2/F3：真实性能搜出结果 + 无自造词（核心诉求）─────────────────────────
{
  const { json } = await hotwords(20);
  const words = (json?.data?.words ?? []).map((w) => w.word);

  // F3：已废弃的自造词绝不能出现
  const FORBIDDEN = ['每日坚果', '空气炸锅'];
  const bad = words.filter((w) => FORBIDDEN.includes(w));
  ok(bad.length === 0, 'F3 词表不含自造词（每日坚果/空气炸锅站内无此商品）', bad.length ? `混入: ${bad}` : '无');

  // F2：逐词实测搜索，命中数为 0 即是「点了没结果」的加戏词
  const zero = [];
  for (const w of words) {
    const d = await search(w);
    const t = d?.data?.total ?? {};
    if ((t.services ?? 0) + (t.rights ?? 0) + (t.self ?? 0) === 0) zero.push(w);
  }
  ok(zero.length === 0, 'F2 全部热词都能搜出结果（无零结果词）', zero.length ? `零结果: ${zero.join('/')}` : `${words.length} 词全部有结果`);
}

// ── F4：权重降序（踩过 text cast 字典序坑）─────────────────────────────────
{
  const { json } = await hotwords(30);
  const ws = json?.data?.words ?? [];
  const nums = ws.map((w) => Number(w.weight));
  const desc = nums.every((n, i) => i === 0 || nums[i - 1] >= n);
  ok(desc, 'F4 权重严格降序（防 weight::text 字典序坑）', `${nums.slice(0, 6).join('≥')}`);
}

// ── F5：结果级缓存 ─────────────────────────────────────────────────────────
{
  await hotwords(5); // 预热
  const t0 = Date.now();
  const { json } = await hotwords(5);
  const warm = Date.now() - t0;
  ok(warm < 1500, 'F5 结果级缓存生效，重复请求 <1.5s', `warm=${warm}ms`);
  ok(json?.cached === true, 'F5b 重复请求 cached=true（缓存可观测）', `cached=${json?.cached}`);
}

// ── F6：limit 生效 + 有上限 ────────────────────────────────────────────────
{
  const a = await hotwords(3);
  const b = await hotwords(15);
  const na = (a.json?.data?.words ?? []).length;
  const nb = (b.json?.data?.words ?? []).length;
  ok(na <= 3, 'F6 limit=3 生效', `返回 ${na}`);
  ok(nb >= na && nb <= 15, 'F6b limit=15 生效', `返回 ${nb}`);
  const big = await hotwords(999);
  ok((big.json?.data?.words ?? []).length <= 50, 'F6c 超大 limit 被夹到上限 50', `返回 ${(big.json?.data?.words ?? []).length}`);
}

// ── F7/F8：搜索词上报 ─────────────────────────────────────────────────────
{
  const word = `E2E热词校验_${Date.now()}`;
  const r = await fetch(`${BASE}/api/site/search-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, source: 'search_result', hitCount: 3 }),
  });
  const j = await r.json().catch(() => null);
  ok(r.status === 200 && j?.ok === true, 'F7 搜索词上报 200', `status=${r.status} word=${word}`);
  ok(j?.data?.id != null, 'F7b 上报返回落库 id（真实入库非空响应）', `id=${j?.data?.id}`);

  // 匿名上报（无 Authorization 头）也必须能记——大部分搜索发生在未登录态
  const r2 = await fetch(`${BASE}/api/site/search-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word: word + '_匿名' }),
  });
  ok(r2.status === 200, 'F7c 匿名搜索词也能上报（未登录不阻塞）', `status=${r2.status}`);

  const bad = await fetch(`${BASE}/api/site/search-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word: '   ' }),
  });
  ok(bad.status === 400, 'F8 空搜索词 400 诚实报错', `status=${bad.status}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
