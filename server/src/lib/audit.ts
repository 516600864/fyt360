/**
 * 管理端审计写入器（admin-50 操作日志）：admin_audit_log（001 已建表）。
 * 只记成功完成的写操作；失败不落库（结果列恒「成功」）。审计失败不阻塞主流程。
 */
import type { Request } from 'express';
import { pool } from '../db/client.js';

export interface AuditEntry {
  action: string;          // 如 provider.save / payment.toggle / admin.login
  target_type?: string;    // 模块：provider/payment/tabbar/schema/auth/admin
  target_id?: string;      // 对象标识：站点 code / 页面 key / 账号名
  site_id?: string | null; // 站点上下文（平台级操作留空）
  detail?: Record<string, unknown>;
}

export async function writeAudit(req: Request, entry: AuditEntry): Promise<void> {
  try {
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip || '';
    await pool.query(
      `INSERT INTO admin_audit_log (admin_id, site_id, action, target_type, target_id, detail, ip)
       VALUES ($1::bigint, $2::uuid, $3::text, $4::text, $5::text, $6::jsonb, $7::text)`,
      [
        String(req.admin?.adminId ?? 0), // 网关铁律：parameters 须全字符串
        entry.site_id || null,
        entry.action,
        entry.target_type ?? null,
        entry.target_id ?? null,
        entry.detail ? JSON.stringify(entry.detail) : null,
        ip,
      ],
    );
  } catch {
    // 审计失败静默（不阻塞业务主流程）
  }
}
