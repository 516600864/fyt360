/**
 * 签到奖励梯度配置（决策#31：奖励梯度后台可配，checkin_record 承接记录）。
 * 挂载于 /api/admin/checkin；存储 = site.checkin_rewards（jsonb 数组 7 项，随 GET /api/me/checkin/status 下发）。
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';

export const checkinAdminRouter = Router();

/** 站点解析（与 admin-tabbar.ts 同款语义） */
async function adminSiteId(admin: AdminJwtPayload, code: string): Promise<string> {
  if (code) {
    const { rows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 OR site_id::text = $1 LIMIT 1`, [code]);
    if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    assertSiteAccess(admin, String(rows[0].site_id));
    return String(rows[0].site_id);
  }
  if (admin.siteIds.length === 1) return admin.siteIds[0];
  if (admin.role === 'platform_admin') {
    const { rows } = await pool.query(`SELECT site_id::text AS site_id FROM site ORDER BY created_at LIMIT 1`);
    return String(rows[0].site_id);
  }
  throw new HttpError(400, '须指定站点', 'SITE_REQUIRED');
}

/** 站点推送配置读取（provider_config wechat_mini.config，030） */
async function loadPushCfg(siteId: string): Promise<{ tmpl: string; map: string }> {
  const { rows } = await pool.query(
    `SELECT config FROM provider_config
      WHERE site_id = $1::uuid AND provider = 'wechat_mini' AND status = 'active' LIMIT 1`,
    [siteId]
  );
  let cfg: Record<string, unknown> = {};
  const raw = rows[0]?.config;
  if (raw != null) {
    try { cfg = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>); } catch { cfg = {}; }
  }
  const map = cfg.tmpl_checkin_map;
  return {
    tmpl: String(cfg.tmpl_checkin ?? ''),
    map: map ? JSON.stringify(map, null, 2) : '',
  };
}

/** GET /api/admin/checkin → 当前梯度 + 推送配置（未配置回默认） */
checkinAdminRouter.get('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await adminSiteId(req.admin!, String(req.query.site ?? req.headers['x-fyt-site'] ?? ''));
    const { rows } = await pool.query(`SELECT checkin_rewards FROM site WHERE site_id = $1::uuid LIMIT 1`, [siteId]);
    const raw = rows[0]?.checkin_rewards;
    const rewards = Array.isArray(raw) && raw.length === 7 ? (raw as number[]) : [50, 60, 70, 80, 90, 100, 500];
    const push = await loadPushCfg(siteId);
    res.json({ ok: true, data: { rewards, customized: Array.isArray(raw), push } });
  } catch (e) { next(e); }
});

/** PUT /api/admin/checkin {rewards:[7 项正整数]} → 保存梯度（D1~D6 日常 + D7 大奖） */
checkinAdminRouter.put('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await adminSiteId(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const raw = req.body?.rewards;
    if (!Array.isArray(raw) || raw.length !== 7) {
      throw new HttpError(400, 'rewards 须为 7 项数组（D1~D7）', 'BAD_REWARDS');
    }
    const rewards = raw.map((v: unknown) => Number(v));
    if (rewards.some((v: number) => !Number.isInteger(v) || v <= 0 || v > 1_000_000)) {
      throw new HttpError(400, '每项须为正整数（≤1000000）', 'BAD_REWARD_VALUE');
    }
    await pool.query(
      `UPDATE site SET checkin_rewards = $2::jsonb, updated_at = now() WHERE site_id = $1::uuid`,
      [siteId, JSON.stringify(rewards)]
    );
    await writeAudit(req, {
      action: 'checkin.rewards.save',
      target_type: 'checkin',
      target_id: siteId,
      site_id: siteId,
      detail: { rewards },
    });
    res.json({ ok: true, data: { saved: true, rewards } });
  } catch (e) { next(e); }
});

/** PUT /api/admin/checkin/push-config {tmpl, map} → 签到提醒订阅消息模板配置（030：跟站点走）
 *  tmpl=一次性订阅模板 ID；map=模板字段映射 JSON，值支持 {n} 占位（=今日可得元宝） */
checkinAdminRouter.put('/push-config', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = await adminSiteId(req.admin!, String(req.body?.site ?? req.headers['x-fyt-site'] ?? ''));
    const tmpl = String(req.body?.tmpl ?? '').trim();
    let map: Record<string, unknown> = {};
    const mapRaw = req.body?.map;
    if (mapRaw != null && String(mapRaw).trim() !== '') {
      try {
        map = typeof mapRaw === 'object' ? (mapRaw as Record<string, unknown>) : JSON.parse(String(mapRaw));
      } catch {
        throw new HttpError(400, '字段映射须为合法 JSON', 'BAD_MAP');
      }
    }
    if (map && Object.keys(map).length > 0 && (!tmpl || !map || typeof map !== 'object' || Array.isArray(map))) {
      throw new HttpError(400, '填写字段映射时模板 ID 必填', 'BAD_TMPL');
    }
    const { rows: ex } = await pool.query(
      `SELECT id FROM provider_config WHERE site_id = $1::uuid AND provider = 'wechat_mini' LIMIT 1`,
      [siteId]
    );
    if (!ex[0]) throw new HttpError(400, '该站点未配置微信小程序凭据，请先到「系统设置」配置', 'WECHAT_MINI_MISSING');
    const config = { tmpl_checkin: tmpl, ...(tmpl ? { tmpl_checkin_map: map } : {}) };
    await pool.query(
      `UPDATE provider_config SET config = $2::jsonb, updated_at = now()
        WHERE site_id = $1::uuid AND provider = 'wechat_mini'`,
      [siteId, JSON.stringify(config)]
    );
    await writeAudit(req, {
      action: 'checkin.push_config.save',
      target_type: 'checkin',
      target_id: siteId,
      site_id: siteId,
      detail: { tmpl, map_keys: Object.keys(map ?? {}) },
    });
    res.json({ ok: true, data: { saved: true, configured: !!tmpl && Object.keys(map ?? {}).length > 0 } });
  } catch (e) { next(e); }
});
