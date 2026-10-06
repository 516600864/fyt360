/**
 * 支付商户（admin-38 支付进件屏落地）：站点级微信支付凭据管理（site_payment）。
 * 数据面：M9 自营交易链 wxpay.resolvePayConfig 消费本表（status='active'）。
 * 安全：mch_key/cert/serial 永不回传原文（掩码 + has_xxx 布尔）；编辑留空=保留原值。
 * 站点隔离：列表按权限范围（决策#27 聚合只读）；写操作绑定显式站点 ID + assertSiteAccess。
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';

export const paymentRouter = Router();

async function resolveSiteScope(admin: AdminJwtPayload, code: string): Promise<string[]> {
  const isPlatform = admin.role === 'platform_admin';
  if (code) {
    const { rows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 OR site_id::text = $1 LIMIT 1`, [code]);
    if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    const siteId = String(rows[0].site_id);
    assertSiteAccess(admin, siteId);
    return [siteId];
  }
  if (isPlatform) {
    const { rows } = await pool.query(`SELECT site_id::text AS id FROM site ORDER BY created_at`);
    return rows.map((r) => String(r.id));
  }
  if (!admin.siteIds.length) throw new HttpError(403, '无站点权限', 'SITE_FORBIDDEN');
  return admin.siteIds;
}

const maskMch = (id: string) => (id.length > 8 ? `${id.slice(0, 4)}****${id.slice(-4)}` : id);
const maskSerial = (s: string) => (s.length > 10 ? `${s.slice(0, 4)}****${s.slice(-4)}` : '****');

/** GET /api/admin/payment/overview → KPI + 逐站点凭据状态（敏感字段只回掩码/布尔） */
paymentRouter.get('/overview', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sites = await resolveSiteScope(req.admin!, String(req.query.site ?? ''));
    const { rows } = await pool.query(
      `SELECT s.site_id::text AS site_id, s.code AS site_code, s.name AS site_name, s.appid,
              p.mch_id, p.serial_no, p.mch_key, p.cert, p.commission_rate::float AS rate,
              p.status, p.created_at
         FROM site s LEFT JOIN site_payment p ON p.site_id = s.site_id
        WHERE s.site_id::uuid = ANY($1::uuid[])
        ORDER BY s.created_at`,
      [sites],
    );
    const list = rows.map((r) => ({
      site_id: r.site_id,
      site_code: r.site_code,
      site_name: r.site_name,
      appid: r.appid ?? '',
      configured: !!r.mch_id,
      mch_id: r.mch_id ?? '',
      mch_masked: r.mch_id ? maskMch(r.mch_id) : '',
      serial_masked: r.serial_no ? maskSerial(r.serial_no) : '',
      has_key: !!r.mch_key,
      has_cert: !!r.cert,
      commission_rate: r.rate ?? null,
      status: r.status ?? null,
      created_at: r.created_at ?? null,
    }));
    const kpis = {
      total: list.length,
      active: list.filter((x) => x.configured && x.status === 'active').length,
      unconfigured: list.filter((x) => !x.configured).length,
      disabled: list.filter((x) => x.configured && x.status === 'disabled').length,
    };
    res.json({ ok: true, data: { kpis, list } });
  } catch (e) { next(e); }
});

function validateCred(f: { mch_id: string; mch_key: string; serial_no: string; cert: string }): void {
  if (!/^\d{8,12}$/.test(f.mch_id)) throw new HttpError(400, '商户号须为 8~12 位数字', 'BAD_MCH_ID');
  if (!/^[0-9A-Za-z]{32}$/.test(f.mch_key)) throw new HttpError(400, 'APIv3 密钥须为 32 位字母数字', 'BAD_MCH_KEY');
  if (!/^[0-9A-Za-z-]{8,64}$/.test(f.serial_no)) throw new HttpError(400, '证书序列号格式不正确', 'BAD_SERIAL');
  if (!/(BEGIN (RSA )?PRIVATE KEY)/.test(f.cert)) throw new HttpError(400, '商户私钥须为 PEM 格式（apiclient_key.pem 原文）', 'BAD_CERT');
}

/** PUT /api/admin/payment/:siteId — 新建须全量；已存在时留空的密钥字段保留原值；{status} 单独可切换启停 */
paymentRouter.put('/:siteId', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = String(req.params.siteId);
    assertSiteAccess(req.admin!, siteId);
    const { rows: exRows } = await pool.query(
      `SELECT site_id::text AS site_id, mch_id, mch_key, serial_no, cert, status FROM site_payment WHERE site_id = $1::uuid LIMIT 1`,
      [siteId],
    );
    const ex = exRows[0];
    const b = req.body ?? {};

    // 仅切状态
    if (b.status !== undefined && b.mch_id === undefined) {
      if (!ex) throw new HttpError(400, '该站点尚未配置支付凭据', 'NOT_CONFIGURED');
      if (!['active', 'disabled'].includes(String(b.status))) throw new HttpError(400, 'status 仅限 active/disabled', 'BAD_STATUS');
      await pool.query(`UPDATE site_payment SET status = $1::text WHERE site_id = $2::uuid`, [b.status, siteId]);
      await writeAudit(req, { action: 'payment.toggle', target_type: 'payment', target_id: String(b.status), site_id: siteId });
      res.json({ ok: true, data: { site_id: siteId, status: b.status } });
      return;
    }

    const rate = b.commission_rate === undefined ? undefined : Number(b.commission_rate);
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 0 || rate > 1)) {
      throw new HttpError(400, '佣金率须在 0~1 之间', 'BAD_RATE');
    }

    const merged = {
      mch_id: String(b.mch_id ?? ex?.mch_id ?? ''),
      mch_key: String(b.mch_key ?? ex?.mch_key ?? ''),
      serial_no: String(b.serial_no ?? ex?.serial_no ?? ''),
      cert: String(b.cert ?? ex?.cert ?? ''),
    };
    // 编辑时留空的密钥字段沿用原值 → 仅对"最终值"整体校验
    validateCred(merged);

    if (!ex) {
      await pool.query(
        `INSERT INTO site_payment (site_id, mch_id, mch_key, serial_no, cert, commission_rate, status)
         VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::numeric, $7::text)`,
        [siteId, merged.mch_id, merged.mch_key, merged.serial_no, merged.cert, rate ?? 0.2, String(b.status ?? 'active')],
      );
    } else {
      const status = ['active', 'disabled'].includes(String(b.status)) ? String(b.status) : ex.status;
      await pool.query(
        `UPDATE site_payment
            SET mch_id = $1::text, mch_key = $2::text, serial_no = $3::text, cert = $4::text,
                commission_rate = $5::numeric, status = $6::text
          WHERE site_id = $7::uuid`,
        [merged.mch_id, merged.mch_key, merged.serial_no, merged.cert, rate ?? 0.2, status, siteId],
      );
    }
    await writeAudit(req, { action: ex ? 'payment.update' : 'payment.create', target_type: 'payment', target_id: merged.mch_id, site_id: siteId });
    res.json({ ok: true, data: { site_id: siteId, status: ex ? undefined : String(b.status ?? 'active') } });
  } catch (e) { next(e); }
});
