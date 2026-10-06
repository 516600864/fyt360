// 定时任务触发（双通道）：
//   POST /api/jobs/<name>        admin 手动触发（调试/补拉，requireAdmin + assertSiteAccess）
//   POST /api/jobs/<name>/cron   云托管定时触发器回调（token = HMAC(JWT_SECRET,'<name>') 前 32 hex）
//   ordersync：订单同步（M2.3）；checkin-remind：签到订阅消息每日提醒（决策#32）
import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db/client.js';
import { runOrdersync } from '../jobs/ordersync.js';
import { runCheckinRemind } from '../jobs/checkin-remind.js';
import { runOrdersweep, PAY_WINDOW_MIN } from '../jobs/ordersweep.js';
import { requireAdmin, assertSiteAccess } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';

export const jobsRouter = Router();

/** 定时触发 token：无需引入新 env 变量，从 JWT_SECRET 派生 */
export function cronToken(name = 'ordersync'): string {
  return crypto.createHmac('sha256', process.env.JWT_SECRET ?? '').update(name).digest('hex').slice(0, 32);
}

async function resolveSite(req: Request): Promise<string> {
  const code = String(req.body?.code ?? req.query.code ?? '').trim() || 'site-a';
  const { rows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [code]);
  if (!rows[0]) throw new HttpError(404, 'SITE_NOT_FOUND', '站点不存在');
  return code;
}

jobsRouter.post('/ordersync/cron', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.query.token ?? req.headers['x-cron-token'] ?? '');
    if (!process.env.JWT_SECRET || token !== cronToken()) {
      throw new HttpError(401, 'BAD_CRON_TOKEN', '定时触发 token 无效');
    }
    const site = await resolveSite(req);
    const stats = await runOrdersync(site);
    res.json({ ok: true, data: stats });
  } catch (e) {
    next(e);
  }
});

jobsRouter.post('/ordersync', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const site = await resolveSite(req);
    assertSiteAccess(req.admin!, (await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [site])).rows[0].site_id);
    // tb 存量回填窗口（2026-09-23 pay_price=0 修复）：body.tb_start/tb_end ISO 串
    const tbStart = req.body?.tb_start ? new Date(String(req.body.tb_start)) : undefined;
    const tbEnd = req.body?.tb_end ? new Date(String(req.body.tb_end)) : undefined;
    const opts =
      tbStart && tbEnd && !Number.isNaN(tbStart.getTime()) && !Number.isNaN(tbEnd.getTime())
        ? { tbWindow: { start: tbStart, end: tbEnd } }
        : undefined;
    const stats = await runOrdersync(site, opts);
    res.json({ ok: true, data: stats });
  } catch (e) {
    next(e);
  }
});

/** 蚂蚁 4 类历史订单回填（2026-10-03接口清单落地，决策#39）
 *  POST /api/jobs/ordersync/backfill   body: { since?: ISO串（默认 2026-09-20）, providers?: ['pf','dc','recharge','movie'] }
 *  ⚠️ 测试apikey 累积订单 57 万条（pforder 实测 total=577548），故强制**按天分段**逐日拉取；
 *     缺省 since 即D先生指定的「仅同步 2026/9/20 之后」。
 *  归因过滤：只落 extend_id/uid = 本站 user_id 的行，其余（他人推广位）丢弃。 */
jobsRouter.post('/ordersync/backfill', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const site = await resolveSite(req);
    assertSiteAccess(req.admin!, (await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [site])).rows[0].site_id);
    const since = req.body?.since ? new Date(String(req.body.since)) : new Date('2026-09-20T00:00:00+08:00');
    if (Number.isNaN(since.getTime())) throw new HttpError(400, 'BAD_PARAM', 'since 不是合法日期');
    const valid = new Set(['pf', 'dc', 'recharge', 'movie']);
    const providers = Array.isArray(req.body?.providers)
      ? req.body.providers.map((p: unknown) => String(p)).filter((p: string) => valid.has(p))
      : undefined;
    if (providers && providers.length === 0) throw new HttpError(400, 'BAD_PARAM', 'providers 无有效值（可选 pf/dc/recharge/movie）');
    const stats = await runOrdersync(site, { backfillSince: since, backfillProviders: providers });
    res.json({ ok: true, data: { since: since.toISOString(), ...stats } });
  } catch (e) {
    next(e);
  }
});

// ── 签到订阅消息每日提醒（决策#32）─────────────────────────────────────────────
// 触发方式：SCF timer（checkin-remind-timer，每日 09:00 Asia/Shanghai）自动 POST 下列 URL。
// 触发器与 token 由deploy/scripts/function-deploy.mjs 自动创建/注入，**无需控制台手工配置**。
//   POST /api/jobs/checkin-remind/cron?token=<HMAC(JWT_SECRET,'checkin-remind') 前 32 hex>
jobsRouter.post('/checkin-remind/cron', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.query.token ?? req.headers['x-cron-token'] ?? '');
    if (!process.env.JWT_SECRET || token !== cronToken('checkin-remind')) {
      throw new HttpError(401, 'BAD_CRON_TOKEN', '定时触发 token 无效');
    }
    const stats = await runCheckinRemind();
    res.json({ ok: true, data: stats });
  } catch (e) {
    next(e);
  }
});

jobsRouter.post('/checkin-remind', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await runCheckinRemind();
    res.json({ ok: true, data: stats });
  } catch (e) {
    next(e);
  }
});

// ── 未支付订单超时自动关单（2026-10-02）──────────────────────────────────────
// 背景：自营下单即锁券 + 扣库存，用户不付款会无限期占用（实测积压 8 笔僵尸单）。
// 规则：created 态自营单满 PAY_WINDOW_MIN 分钟 → 自动关单 + 退券 + 回补库存。
// 触发方式：SCF timer（ordersweep-timer，每 5 分钟）自动 POST 下列 URL。
// 触发器与 token 由 deploy/scripts/function-deploy.mjs 自动创建/注入，**无需控制台手工配置**。
//   POST /api/jobs/ordersweep/cron?token=<HMAC(JWT_SECRET,'ordersweep') 前 32 hex>
// 手动触发（补跑/验证）：POST /api/jobs/ordersweep  body: { window_min }
jobsRouter.post('/ordersweep/cron', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.query.token ?? req.headers['x-cron-token'] ?? '');
    if (!process.env.JWT_SECRET || token !== cronToken('ordersweep')) {
      throw new HttpError(401, 'BAD_CRON_TOKEN', '定时触发 token 无效');
    }
    const stats = await runOrdersweep();
    res.json({ ok: true, data: stats });
  } catch (e) {
    next(e);
  }
});

jobsRouter.post('/ordersweep', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = Number(req.body?.window_min);
    const windowMin = Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), 60 * 24 * 30) : PAY_WINDOW_MIN;
    const stats = await runOrdersweep(windowMin);
    res.json({ ok: true, data: { window_min: windowMin, ...stats } });
  } catch (e) {
    next(e);
  }
});
