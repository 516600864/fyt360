// seed-hotwords.mjs：从真实数据面生成 07B「相关搜索」热词种子
//
// 铁律（2026-10-03）：热词必须来自真实数据面，禁止凭空造词。
// 旧实现硬编码的「每日坚果」「空气炸锅」站内无此商品，点了必零结果 —— 本脚本不会产出这类词。
//
// 词源（全部实拉）：
//   category = brand_category.name（10 个大分类，用户心智最强，权重最高）
//   service  = brand_action_cfg.name（148 个 enabled 服务名）
//   rights   = fasttype 权益品牌名（蚂蚁侧积分目录，实时透传）
//
// 权重策略（weight 越大越靠前）：
//   分类 1000 / 服务 600 / 权益 400
//   同一档内按名称长度升序（短词更好搜，符合真实搜索习惯），长度相同按 id 稳定排序。
//
// 幂等：UPSERT（ON CONFLICT DO UPDATE），可重复执行。
//   ⚠️ 已存在的词**只补空档不降权重**——运营在后台调过的 weight 优先于种子策略，
//      避免每次重跑把人工调优冲掉。source 保留首次写入的值。
import { loadDotEnv, repoRoot } from './lib/common.mjs';
import { connectDb } from './lib/db.mjs';
import { fetchFasttype } from '../../server/dist/lib/haojingke.js';

const SITE_CODE = process.argv[2] ?? 'site-a';

async function main() {
  loadDotEnv();
  const c = await connectDb();
  try {
    const siteRes = await c.query(`SELECT site_id FROM site WHERE code = $1`, [SITE_CODE]);
    const siteId = siteRes.rows?.[0]?.site_id;
    if (!siteId) throw new Error(`站点不存在：${SITE_CODE}`);
    console.log(`[seed-hotwords] 目标站点 ${SITE_CODE} (${siteId})`);

    const pool = new Map(); // word -> {weight, source}
    const add = (word, source, weight) => {
      const w = String(word ?? '').trim();
      if (!w) return;
      // 已存在则取更高权重（分类 > 服务 > 权益），不覆盖
      const prev = pool.get(w);
      if (prev && prev.weight >= weight) return;
      pool.set(w, { weight, source });
    };

    // ① 分类词
    const cats = await c.query(
      `SELECT name FROM brand_category ORDER BY sort`,
    );
    for (const r of cats.rows) add(r.name, 'category', 1000);
    console.log(`[seed-hotwords] 分类词 ${cats.rows.length}`);

    // ② 服务词
    const svcs = await c.query(
      `SELECT name FROM brand_action_cfg WHERE enabled = TRUE ORDER BY char_length(name), id`,
    );
    for (const r of svcs.rows) add(r.name, 'service', 600);
    console.log(`[seed-hotwords] 服务词 ${svcs.rows.length}`);

    // ③ 权益品牌词（fasttype 实时目录；拿不到就跳过，不阻塞前两档）
    // 凭据走 provider_config（铁律 #2：供应商 key 跟 site_id 走，不落 .env）
    let rightsN = 0;
    try {
      const cfg = await c.query(
        `SELECT apikey FROM provider_config WHERE site_id = $1::uuid AND provider = 'mayixingqiu' AND status = 'active' LIMIT 1`,
        [siteId],
      );
      const apikey = cfg.rows?.[0]?.apikey;
      if (apikey) {
        const ft = await fetchFasttype(String(apikey));
        if (ft.ok) {
          const seen = new Set();
          for (const it of ft.data) {
            // 实测 fasttype 字段名为 cname（品牌中文名）/ couponName（商品名），
            // **没有** brand_name / name —— 早期按 brand_name 取会静默取空（实测 0 词）。
            const nm = String(it.cname ?? it.couponName ?? '').trim();
            if (!nm || seen.has(nm)) continue;
            seen.add(nm);
            add(nm, 'rights', 400);
            rightsN++;
          }
        } else {
          console.warn('[seed-hotwords] fasttype 返回失败：', ft.message);
        }
      }
    } catch (e) {
      console.warn('[seed-hotwords] 权益词拉取失败，跳过该档：', e.message);
    }
    console.log(`[seed-hotwords] 权益词 ${rightsN}`);
    // 防「静默产出 0」：任一档为 0 必须显式告警，否则词表悄悄缺一档而无人察觉
    // （权益档曾因字段名写错静默取 0，实测踩过）。
    if (rightsN === 0) {
      console.warn('[seed-hotwords] ⚠ 权益词为 0 —— fasttype 字段名或凭据可能已变，请核对上游返回结构');
    }

    // 同权重内按长度升序给稳定 sort
    const list = [...pool.entries()]
      .map(([word, v]) => ({ word, ...v }))
      .sort((a, b) => b.weight - a.weight || a.word.length - b.word.length || a.word.localeCompare(b.word, 'zh'));

    let n = 0;
    for (const item of list) {
      await c.query(
        `INSERT INTO search_hotword (site_id, word, weight, enabled, source, sort)
         VALUES ($1::uuid, $2, $3, TRUE, $4, $5)
         ON CONFLICT (site_id, word) DO NOTHING`,
        [siteId, item.word, item.weight, item.source, n],
      );
      n++;
    }
    console.log(`[seed-hotwords] 写入 ${n} 词（已存在则跳过，保留运营调过的权重）`);

    const chk = await c.query(
      `SELECT source, count(*)::int AS n FROM search_hotword WHERE site_id = $1::uuid GROUP BY source ORDER BY 2 DESC`,
      [siteId],
    );
    console.log('[seed-hotwords] 当前库内分布：', JSON.stringify(chk.rows));
    const top = await c.query(
      `SELECT word, weight FROM search_hotword WHERE site_id = $1::uuid ORDER BY weight DESC, sort LIMIT 12`,
      [siteId],
    );
    console.log('[seed-hotwords] TOP12：', top.rows.map((r) => `${r.word}(${r.weight})`).join(' '));
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error('[seed-hotwords] 失败：', e.message);
  process.exit(1);
});
