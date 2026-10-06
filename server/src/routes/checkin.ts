/**
 * 聚宝盆签到（决策#31，画布 142:208 弹层 / 142:269 成功态）。
 * 挂载于 /api/me/checkin/*，requireUser（clogin 签发的 C 端 JWT）。
 * 机制：连签 7 天一盆；奖励梯度 site.checkin_rewards（后台可配，默认 50/60/70/80/90/100/500）；
 *       断签重新计盆（开新盆 cycle+1，无补签卡）；盆满（streak=7）后次签自动开新盆。
 * 奖励入元宝账户（签到=元宝第三来源，与购物返利/邀请奖励并列）。
 * 42P18 铁律：SQL 参数全部引用/显式 cast；网关无跨语句事务 → 签到=单语句 CTE 原子。
 * 日期口径：统一 (now() AT TIME ZONE 'Asia/Shanghai')::date。
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireUser } from '../middleware/auth.js';

export const checkinRouter = Router();

checkinRouter.use(requireUser);

/** 默认奖励梯度（与迁移 029 一致；site.checkin_rewards 非法时兜底） */
const DEFAULT_REWARDS = [50, 60, 70, 80, 90, 100, 500];

/** 读站点奖励梯度（长度/合法性容错，非法回默认） */
function parseRewards(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_REWARDS];
  const arr = raw.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0);
  return arr.length === 7 ? arr : [...DEFAULT_REWARDS];
}

async function loadRewards(siteId: string): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT checkin_rewards FROM site WHERE site_id = $1::uuid LIMIT 1`,
    [siteId]
  );
  return parseRewards(rows[0]?.checkin_rewards);
}

/** 用户站点解析：C 端 JWT 无 site 概念 → 取该用户注册所属站（user.site_id），无则首站 */
async function resolveSiteId(userId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT u.site_id::text AS site_id FROM "user" u WHERE u.user_id = $1::bigint LIMIT 1`,
    [userId]
  );
  if (rows[0]?.site_id) return String(rows[0].site_id);
  const { rows: fb } = await pool.query(`SELECT site_id::text AS site_id FROM site ORDER BY created_at LIMIT 1`);
  if (!fb[0]) throw new HttpError(500, '站点未初始化', 'NO_SITE');
  return String(fb[0].site_id);
}

interface DayRec { d: number; amount: number; date: string }

function shapeRecord(r: Record<string, unknown> | undefined, rewards: number[]) {
  const streak = Number(r?.streak ?? 0);
  const days = (Array.isArray(r?.days) ? r.days : []) as DayRec[];
  return {
    streak,
    cycle: Number(r?.cycle ?? 1),
    total_ingot: Number(r?.total_ingot ?? 0),
    days,
    today_checked: !!r?.last_date && String(r.last_date).slice(0, 10) === todayStr(),
    full: streak >= 7,
  };
}

/** Asia/Shanghai 今日（YYYY-MM-DD） */
function todayStr(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 站点签到提醒推送配置（provider_config wechat_mini.config，030：模板 ID 跟站点走） */
async function loadPushCfg(siteId: string): Promise<{ tmpl: string; map: Record<string, unknown> }> {
  const { rows } = await pool.query(
    `SELECT pc.config FROM provider_config pc
      WHERE pc.site_id = $1::uuid AND pc.provider = 'wechat_mini' AND pc.status = 'active'
      LIMIT 1`,
    [siteId]
  );
  let cfg: Record<string, unknown> = {};
  const raw = rows[0]?.config;
  if (raw != null) {
    try { cfg = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>); } catch { cfg = {}; }
  }
  return {
    tmpl: String(cfg.tmpl_checkin ?? '').trim(),
    map: (cfg.tmpl_checkin_map && typeof cfg.tmpl_checkin_map === 'object' ? cfg.tmpl_checkin_map : null) as Record<string, unknown> | null ?? {},
  };
}

/** GET /api/me/checkin/status → 弹层初始态（01B）：盆进度/梯度/今日可领额/元宝余额 */
checkinRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.user!.userId);
    const siteId = await resolveSiteId(userId);
    const rewards = await loadRewards(siteId);
    const { rows } = await pool.query(
      `SELECT streak, days, total_ingot, cycle, last_date FROM checkin_record
        WHERE site_id = $1::uuid AND user_id = $2::bigint LIMIT 1`,
      [siteId, userId]
    );
    const { rows: acc } = await pool.query(
      `SELECT balance FROM ingot_account WHERE user_id = $1::bigint LIMIT 1`,
      [userId]
    );
    const shaped = shapeRecord(rows[0], rewards);
    // 今天可领额：未签 → rewards[streak]（下一格）；已签 → 0（明日可领额给 next_amount）
    const todayAmount = shaped.today_checked ? 0 : (shaped.streak >= 7 ? rewards[0] : rewards[shaped.streak] ?? rewards[6]);
    const nextAmount = shaped.today_checked
      ? (shaped.streak >= 7 ? rewards[1] : rewards[shaped.streak + 1] ?? rewards[6])
      : todayAmount;
    const pushCfg = await loadPushCfg(siteId);
    res.json({
      ok: true,
      data: {
        ...shaped,
        rewards,
        today_amount: todayAmount,
        next_amount: nextAmount,
        balance: Number(acc[0]?.balance ?? 0),
        invite_reward: 500, // 01C 邀请小字口径
        push_tmpl: pushCfg.tmpl || null, // 有模板才下发，端上据此拉订阅授权
      },
    });
  } catch (e) { next(e); }
});

/**
 * POST /api/me/checkin/subscribe { state: 'accept' } → 订阅授权回执（决策#32 签到每日提醒）。
 * 一次性订阅：端上 requestSubscribeMessage 授权一次 = 可发一条 → quota+1；reject/静默不上报额度。
 * 42P18：ON CONFLICT DO UPDATE 中参数显式 cast。
 */
checkinRouter.post('/subscribe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.user!.userId);
    const siteId = await resolveSiteId(userId);
    const state = String(req.body?.state ?? '');
    if (state !== 'accept') {
      // reject/异常态：诚实落库不涨额度（updated_at 记录最近授权交互时间）
      await pool.query(
        `INSERT INTO user_push_quota (user_id, site_id, quota) VALUES ($1::bigint, $2::uuid, 0)
          ON CONFLICT (user_id) DO UPDATE SET updated_at = now()`,
        [userId, siteId]
      );
      return res.json({ ok: true, data: { accepted: false } });
    }
    const { rows } = await pool.query(
      `INSERT INTO user_push_quota (user_id, site_id, quota) VALUES ($1::bigint, $2::uuid, 1)
        ON CONFLICT (user_id) DO UPDATE SET quota = user_push_quota.quota + 1, updated_at = now()
        RETURNING quota`,
      [userId, siteId]
    );
    res.json({ ok: true, data: { accepted: true, quota: Number(rows[0]?.quota ?? 0) } });
  } catch (e) { next(e); }
});

/**
 * POST /api/me/checkin/do → 今日添金（01B→01C）。
 * 单语句 CTE 原子：占位 upsert（幂等建行）+ 条件更新（今日已签 → 0 行 → 409）+ 元宝入账。
 * 断签/盆满 → 重新计盆（streak=1, days 重置, cycle+1）。
 */
checkinRouter.post('/do', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.user!.userId);
    const siteId = await resolveSiteId(userId);
    const rewards = await loadRewards(siteId);

    // 1) 幂等占位行（首签建行；并发下 ON CONFLICT 无副作用）
    await pool.query(
      `INSERT INTO checkin_record (site_id, user_id) VALUES ($1::uuid, $2::bigint)
        ON CONFLICT (site_id, user_id) DO NOTHING`,
      [siteId, userId]
    );

    // 2) 原子签到（today Shanghai 口径；42P18：date/int 参数显式 cast）
    const { rows } = await pool.query(
      `WITH cfg AS (
         SELECT COALESCE((SELECT checkin_rewards FROM site WHERE site_id = $1::uuid), '[50,60,70,80,90,100,500]'::jsonb) AS rewards
       ), t AS (
         SELECT (now() AT TIME ZONE 'Asia/Shanghai')::date AS d
       ), cur AS (
         SELECT streak, days, total_ingot, cycle, last_date
           FROM checkin_record WHERE site_id = $1::uuid AND user_id = $2::bigint
       ), calc AS (
         SELECT
           CASE
             WHEN cur.last_date = (SELECT d FROM t) - 1 AND cur.streak >= 7 THEN 1            -- 盆满次签 → 开新盆
             WHEN cur.last_date = (SELECT d FROM t) - 1 THEN cur.streak + 1                   -- 连签
             ELSE 1                                                                            -- 首签/断签 → 重新计盆
           END AS ns,
           CASE
             WHEN cur.last_date IS NULL THEN cur.cycle                                        -- 首签 = 第 1 盆
             WHEN cur.last_date < (SELECT d FROM t) - 1 OR (cur.last_date = (SELECT d FROM t) - 1 AND cur.streak >= 7)
               THEN cur.cycle + 1                                                             -- 断签/盆满 → 新盆
             ELSE cur.cycle
           END AS nc,
           CASE
             WHEN cur.last_date = (SELECT d FROM t) - 1 AND cur.streak < 7 THEN cur.days      -- 延续本盆
             ELSE '[]'::jsonb                                                                  -- 新盆清空
           END AS nd,
           CASE
             WHEN cur.last_date = (SELECT d FROM t) - 1 AND cur.streak < 7 THEN cur.total_ingot
             ELSE 0
           END AS nt
         FROM cur
       ), amt AS (
         SELECT
           calc.ns,
           COALESCE(NULLIF(CAST(cfg.rewards->>(calc.ns - 1) AS int), 0),
                    (ARRAY[50,60,70,80,90,100,500])[calc.ns]) AS amount
         FROM calc CROSS JOIN cfg
       ), upd AS (
         UPDATE checkin_record c
            SET streak = amt.ns,
                days = calc.nd || jsonb_build_array(jsonb_build_object('d', amt.ns, 'amount', amt.amount, 'date', (SELECT d FROM t)::text)),
                total_ingot = calc.nt + amt.amount,
                cycle = calc.nc,
                last_date = (SELECT d FROM t),
                updated_at = now()
           FROM calc, amt
          WHERE c.site_id = $1::uuid AND c.user_id = $2::bigint
            AND c.last_date IS DISTINCT FROM (SELECT d FROM t)      -- 今日未签（已签 → 0 行 → 409）
         RETURNING c.streak, c.days, c.total_ingot, c.cycle, amt.amount
       ), acc AS (
         INSERT INTO ingot_account (user_id, balance, total_earned)
         SELECT $2::bigint, (SELECT amount FROM upd), (SELECT amount FROM upd)
          WHERE EXISTS (SELECT 1 FROM upd)                 -- 今日已签（upd 空）→ 零行插入，无副作用
         ON CONFLICT (user_id) DO UPDATE
            SET balance = ingot_account.balance + (SELECT amount FROM upd),
                total_earned = ingot_account.total_earned + (SELECT amount FROM upd)
         RETURNING balance
       ), tx AS (
         INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
         SELECT $2::bigint, 'CHECKIN_REWARD', 'checkin:' || (SELECT d FROM t)::text, (SELECT amount FROM upd),
                (SELECT balance FROM acc), '签到第' || (SELECT streak FROM upd)::text || '天'
         WHERE EXISTS (SELECT 1 FROM upd)
         RETURNING tx_id
       )
       SELECT upd.streak, upd.days, upd.total_ingot, upd.cycle, upd.amount,
              (SELECT balance FROM acc) AS balance_after, (SELECT tx_id FROM tx) AS tx_id
       FROM upd, acc`,
      [siteId, userId]
    );

    const r = rows[0];
    if (!r) throw new HttpError(409, '今天已经签过啦', 'ALREADY_CHECKED');

    const days = (Array.isArray(r.days) ? r.days : []) as DayRec[];
    res.json({
      ok: true,
      data: {
        streak: Number(r.streak),
        cycle: Number(r.cycle),
        total_ingot: Number(r.total_ingot),
        amount: Number(r.amount),
        balance_after: Number(r.balance_after),
        days,
        full: Number(r.streak) >= 7,
      },
    });
  } catch (e) { next(e); }
});
