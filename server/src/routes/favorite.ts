/**
 * 我的收藏 / 浏览足迹（决策 #41，画布 mini-06B / mini-06C 增补稿）
 * 挂载于 /api/me/*，requireUser。
 *
 * ⛔⛔ 口径铁律（写在最前面，改代码前必读）：
 *
 *  ① **只存指针，不存快照**
 *     CPS 商品 / 到店服务 / 权益兑换的价格、库存、上下架状态**全在上游**（蚂蚁星球 / 我方 self_goods）。
 *     收藏的语义是「收藏服务入口」，不是「收藏商品副本」。
 *     → 两表都没有 price / stock 字段，也**绝不做定时同步**（同步即等于把快照塞回库里，撞 CPS 不入库铁律）。
 *     → 点击收藏项时前端重新透传拿最新价。
 *
 *  ② **title 冗余一份是故意的**
 *     列表每行都要渲染名称。若 title 靠点开时回查上游，瀑布流会每行发一次请求 → 必卡死。
 *     冗余 title 的代价就是**必须能处理失效** → 下架项显示「已下架」+ 置灰，仍可取消收藏。
 *     冗余的是**展示用字符串**，不参与任何价格 / 库存 / 结算口径。
 *
 *  ③ **两表都带 site_id，跟站点不跟人**
 *     决策 #27 隔离铁律。跟user_id 走的话，用户切到别的站点就会看到别家站的服务入口。
 *     所有读写一律 `WHERE user_id = $1 AND site_id = $2`，site_id 取自 token（req.user.siteId）。
 *
 *  ④ **足迹会膨胀，必须有上限**
 *     最近 200 条 + 保留 30 天，超出自动淘汰（pruneFootprints，写入后同步裁剪，不依赖 cron）。
 *
 *  ⑤ **隐私红线**：足迹是用户行为数据，**仅供用户自己回看**，
 *     不得用于推荐 / 运营展示 / 跨站画像。清空入口是产品必须项（06C 底部双行说明）。
 *
 * 失效态判定（只存指针的必然结果，不是 bug）：
 *   self_goods  → self_goods.status = 'off' 或商品被删
 *   rights_brand → brand_action_cfg 无此 code（品牌被运营摘掉）
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireUser } from '../middleware/auth.js';

export const favoriteRouter = Router();

/** 足迹硬上限（决策 #41：最近 200 条 + 保留 30 天） */
const FP_MAX_ROWS = 200;
const FP_KEEP_DAYS = 30;

const KINDS = new Set(['self_goods', 'rights_brand', 'cps_goods']);
const KIND_LABEL: Record<string, string> = {
  self_goods: '到店服务',
  rights_brand: '权益兑换',
  cps_goods: 'CPS 好物',
};

function parseKind(raw: unknown): string {
  const k = String(raw ?? 'self_goods');
  if (!KINDS.has(k)) throw new HttpError(400, '类型不合法', 'BAD_KIND');
  return k;
}

/** 归组键：今天 / 昨天 / 更早（06C 分组范式，对标 rights/records.vue） */
function dayBucket(d: Date): string {
  const t = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diff = Math.round((b - a) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  return 'earlier';
}

/**
 * 写入足迹（统一埋点入口，见 apps/mini/src/utils/track.js）。
 * · 重复浏览同一入口 → 只刷新 viewed_at（不新增行，避免列表被同一商品刷屏）
 * · 写完同步 prune：超200 条或超 30 天就地淘汰
 * · ⛔ 静默失败：埋点永远不阻塞用户跳转，这里吞掉异常
 */
favoriteRouter.post('/footprints', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user!.userId;
  const siteId = req.user!.siteId;
  try {
    const kind = parseKind(req.body?.kind);
    const refId = String(req.body?.ref_id ?? '').trim();
    if (!refId) throw new HttpError(400, '缺少 ref_id', 'BAD_REQUEST');
    const title = String(req.body?.title ?? '').trim().slice(0, 160);
    const iconChar = String(req.body?.icon_char ?? '').trim().slice(0, 8) || null;
    await pool.query(
      `INSERT INTO user_footprint (user_id, site_id, kind, ref_id, title, icon_char, viewed_at)
       VALUES ($1::bigint, $2::uuid, $3::varchar, $4::varchar, $5::varchar, $6::varchar, now())
       ON CONFLICT (user_id, site_id, kind, ref_id)
       DO UPDATE SET viewed_at = now(), title = EXCLUDED.title, icon_char = EXCLUDED.icon_char`,
      [userId, siteId, kind, refId, title || refId, iconChar],
    );
    await pruneFootprints(userId, siteId);
    res.json({ ok: true, data: { recorded: true } });
  } catch (e) {
    // 埋点失败不打扰用户（决策 #41：足迹是辅助功能，绝不能因为写库失败阻断浏览）
    next(e instanceof HttpError && e.status === 400 ? e : new Error('FOOTPRINT_SILENT'));
  }
});

/** 足迹裁剪：超条数从最旧裁、超天数从最旧裁（铁律④） */
async function pruneFootprints(userId: number, siteId: string): Promise<void> {
  await pool.query(
    `DELETE FROM user_footprint
      WHERE user_id = $1::bigint AND site_id = $2::uuid
        AND (viewed_at < now() - ($3 || ' days')::interval
             OR id IN (SELECT id FROM user_footprint
                        WHERE user_id = $1::bigint AND site_id = $2::uuid
                        ORDER BY viewed_at DESC OFFSET $4))`,
    [userId, siteId, String(FP_KEEP_DAYS), String(FP_MAX_ROWS)],
  );
}

/** 收藏列表项 → 端上结构（含失效态判定） */
type Row = {
  id: string | number; kind: string; ref_id: string; title: string; icon_char: string | null;
  ts: Date; alive: boolean; reason?: string; group?: string;
};

/**
 * GET /api/me/favorites?kind=all|self_goods|rights_brand
 * kind=all 时返回全量并在端上按筛选切分（两类性质不同但列表项同构，筛选不必回源）
 */
favoriteRouter.get('/favorites', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const kind = String(req.query.kind ?? 'all');
    const where = kind === 'all' ? 'TRUE' : `f.kind = $3::varchar`;
    const params: unknown[] = [userId, siteId];
    if (kind !== 'all') params.push(kind);

    const { rows } = await pool.query(
      `SELECT f.id, f.kind, f.ref_id, f.title, f.icon_char, f.created_at,
              -- 失效判定：自营看status，权益看品牌是否还在配置表里（只存指针的必然结果）
              CASE WHEN f.kind = 'self_goods' THEN
                     COALESCE((SELECT g.status = 'on' FROM self_goods g
                                WHERE g.site_id = f.site_id AND g.goods_id::text = f.ref_id), false)
                   WHEN f.kind = 'rights_brand' THEN
                     COALESCE((SELECT 1 FROM brand_action_cfg b
                                WHERE b.brand_code = f.ref_id AND b.enabled), 0) = 1
                   ELSE true  -- cps_goods：上游无本地表，一律按可用，打开时透传由上游判定
              END AS alive
         FROM user_favorite f
        WHERE f.user_id = $1::bigint AND f.site_id = $2::uuid AND ${where}
        ORDER BY f.created_at DESC
        LIMIT 200`,
      params,
    );
    const items: Row[] = rows.map((r) => ({
      id: Number(r.id),
      kind: String(r.kind),
      ref_id: String(r.ref_id),
      title: String(r.title ?? ''),
      icon_char: r.icon_char ?? null,
      ts: r.created_at,
      alive: !!r.alive,
      reason: r.alive ? undefined : '已下架',
    }));
    res.json({
      ok: true,
      data: {
        total: items.length,
        counts: {
          self_goods: items.filter((i) => i.kind === 'self_goods').length,
          rights_brand: items.filter((i) => i.kind === 'rights_brand').length,
        },
        items,
      },
    });
  } catch (e) { next(e); }
});

/** POST /api/me/favorites {kind, ref_id, title, icon_char} → 收藏（幂等，重复收藏=置顶） */
favoriteRouter.post('/favorites', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const kind = parseKind(req.body?.kind);
    const refId = String(req.body?.ref_id ?? '').trim();
    if (!refId) throw new HttpError(400, '缺少 ref_id', 'BAD_REQUEST');
    const title = String(req.body?.title ?? '').trim().slice(0, 160);
    const iconChar = String(req.body?.icon_char ?? '').trim().slice(0, 8) || null;
    await pool.query(
      `INSERT INTO user_favorite (user_id, site_id, kind, ref_id, title, icon_char)
       VALUES ($1::bigint, $2::uuid, $3::varchar, $4::varchar, $5::varchar, $6::varchar)
       ON CONFLICT (user_id, site_id, kind, ref_id)
       DO UPDATE SET created_at = now(), title = EXCLUDED.title, icon_char = EXCLUDED.icon_char`,
      [userId, siteId, kind, refId, title || refId, iconChar],
    );
    res.json({ ok: true, data: { favorited: true, kind, kind_label: KIND_LABEL[kind] } });
  } catch (e) { next(e); }
});

/**
 * DELETE /api/me/favorites 全部取消收藏（06B 无此入口，留作运营/客服排障用）
 * ⛔ **必须注册在 `/favorites/:id` 之前**：Express 按注册顺序匹配，
 *    反过来会让无参请求被 `:id` 吞掉 → 匿名调用返回 404 而不是 401（鉴权形同虚设）。
 */
favoriteRouter.delete('/favorites', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM user_favorite WHERE user_id = $1::bigint AND site_id = $2::uuid RETURNING id`,
      [req.user!.userId, req.user!.siteId],
    );
    res.json({ ok: true, data: { cleared: rows.length } });
  } catch (e) { next(e); }
});

/**
 * DELETE /api/me/favorites/:id  单条取消（带 ref_id 兜底：id 不属于本人/本站时按ref_id 删，幂等）
 * 两种都支持是因为端上收藏态可能只有 ref_id（商详页那颗 ♡ 不知道 id）
 */
favoriteRouter.delete('/favorites/:id', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    const { rows } = await pool.query(
      `DELETE FROM user_favorite
        WHERE user_id = $1::bigint AND site_id = $2::uuid
          AND (id::text = $3::text OR (kind = $4::varchar AND ref_id = $5::varchar))
        RETURNING id`,
      [userId, siteId, String(req.params.id), parseKind(req.query.kind), String(req.query.ref_id ?? '')],
    );
    res.json({ ok: true, data: { removed: rows.length > 0 } });
  } catch (e) { next(e); }
});

/**
 * GET /api/me/footprints
 * 端上分组（今天/昨天/更早）在服务端算好返回 group 字段，理由：
 * 分组要按**服务端本地时区**切日边界，端上自己算会踩「toISOString 是 UTC，差 8 小时」的老坑。
 */
favoriteRouter.get('/footprints', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;
    const siteId = req.user!.siteId;
    // 读之前顺手裁一次（老数据/直接改库造数据也能自愈）
    await pruneFootprints(userId, siteId);
    const { rows } = await pool.query(
      `SELECT f.id, f.kind, f.ref_id, f.title, f.icon_char, f.viewed_at,
              CASE WHEN f.kind = 'self_goods' THEN
                     COALESCE((SELECT g.status = 'on' FROM self_goods g
                                WHERE g.site_id = f.site_id AND g.goods_id::text = f.ref_id), false)
                   WHEN f.kind = 'rights_brand' THEN
                     COALESCE((SELECT 1 FROM brand_action_cfg b
                                WHERE b.brand_code = f.ref_id AND b.enabled), 0) = 1
                   ELSE true  -- cps_goods：上游无本地表，一律按可用，打开时透传由上游判定
              END AS alive
         FROM user_footprint f
        WHERE f.user_id = $1::bigint AND f.site_id = $2::uuid
        ORDER BY f.viewed_at DESC
        LIMIT 200`,
      [userId, siteId],
    );
    const items: Row[] = rows.map((r) => ({
      id: Number(r.id),
      kind: String(r.kind),
      ref_id: String(r.ref_id),
      title: String(r.title ?? ''),
      icon_char: r.icon_char ?? null,
      ts: r.viewed_at,
      alive: !!r.alive,
      reason: r.alive ? undefined : '已下架',
      group: dayBucket(new Date(r.viewed_at)),
    }));
    res.json({
      ok: true,
      data: {
        total: items.length,
        // 隐私说明要展示真实上限，UI 文案与常量同源，避免文案写死 200 以后改常量不同步
        limits: { max_rows: FP_MAX_ROWS, keep_days: FP_KEEP_DAYS },
        counts: {
          today: items.filter((i) => i.group === 'today').length,
          yesterday: items.filter((i) => i.group === 'yesterday').length,
          earlier: items.filter((i) => i.group === 'earlier').length,
        },
        items,
      },
    });
  } catch (e) { next(e); }
});

/**
 * DELETE /api/me/footprints 全部清空（06C 二次确认弹层 → 二次确认后才调这里）
 * ⛔ **必须注册在 `/footprints/:id` 之前**：Express 按注册顺序匹配，
 *    反过来会让 06C 的「确认清空」被 `:id` 吞掉（空串当 id）→ 清空永远失败。
 */
favoriteRouter.delete('/footprints', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // ⛔ 必须 RETURNING 取行数：网关 rowCount = rows.length，DELETE 不带 RETURNING 时恒为 0
    //    （项目铁律，UPDATE/DELETE 判影响行数一律加 RETURNING）
    const { rows } = await pool.query(
      `DELETE FROM user_footprint WHERE user_id = $1::bigint AND site_id = $2::uuid RETURNING id`,
      [req.user!.userId, req.user!.siteId],
    );
    res.json({ ok: true, data: { cleared: rows.length } });
  } catch (e) { next(e); }
});

/** DELETE /api/me/footprints/:id 单条删除 */
favoriteRouter.delete('/footprints/:id', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM user_footprint
        WHERE user_id = $1::bigint AND site_id = $2::uuid AND id::text = $3::text
        RETURNING id`,
      [req.user!.userId, req.user!.siteId, String(req.params.id)],
    );
    res.json({ ok: true, data: { removed: rows.length > 0 } });
  } catch (e) { next(e); }
});

/**
 * GET /api/me/favorites/state?kind=&ref_id= → 端上那颗 ♡ 的初始态
 * 商详页要知道自己是否已收藏才能显示实心/空心，否则每次进页面都要拉整张列表。
 */
favoriteRouter.get('/favorites/state', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const kind = parseKind(req.query.kind);
    const refId = String(req.query.ref_id ?? '').trim();
    const { rows } = await pool.query(
      `SELECT 1 FROM user_favorite
        WHERE user_id = $1::bigint AND site_id = $2::uuid AND kind = $3::varchar AND ref_id = $4::varchar
        LIMIT 1`,
      [req.user!.userId, req.user!.siteId, kind, refId],
    );
    res.json({ ok: true, data: { favorited: rows.length > 0 } });
  } catch (e) { next(e); }
});