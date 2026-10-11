import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { HttpError } from './errors.js';
import { pool } from '../db/client.js';

export interface AdminJwtPayload {
  adminId: string;
  username: string;
  /** 平台超管可跨站；站点角色只能访问白名单站点 */
  role: string;
  siteIds: string[];
}

export function signAdminToken(payload: AdminJwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '12h' });
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    next(new HttpError(401, '未登录', 'UNAUTHORIZED'));
    return;
  }
  try {
    req.admin = jwt.verify(token, config.jwtSecret) as AdminJwtPayload;
    next();
  } catch {
    next(new HttpError(401, '登录已过期', 'TOKEN_EXPIRED'));
  }
}

/** 站点隔离：非平台超管只能访问白名单站点（§8.2③ 服务端强制） */
export function assertSiteAccess(admin: AdminJwtPayload, siteId: string): void {
  if (admin.role === 'platform_admin') return;
  if (!admin.siteIds.includes(siteId)) {
    throw new HttpError(403, '无该站点访问权限', 'SITE_FORBIDDEN');
  }
}

/**
 * 站点级配置写权限（2026-10-11 结算配置站点级化，docs/结算配置站点级化设计评审.md）：
 * 站点负责人（is_owner）可写本站；platform_admin 可代写任意站。对齐 admin-52 口径。
 */
export async function requireOwnerOrPlatform(admin: AdminJwtPayload, siteId: string): Promise<void> {
  if (admin.role === 'platform_admin') return;
  assertSiteAccess(admin, siteId);
  const { rows: own } = await pool.query(
    `SELECT 1 FROM admin_user_site WHERE admin_id = $1::bigint AND site_id = $2::uuid AND is_owner LIMIT 1`,
    [admin.adminId, siteId],
  );
  if (!own[0]) {
    throw new HttpError(403, '结算规则由站点负责人配置，请联系站点负责人', 'NOT_SITE_OWNER');
  }
}

// ---------------------------------------------------------------------------
// C 端用户 JWT（M2.2）：与 admin JWT 同密钥但 payload.typ 隔离（'user'），互不通用
// ---------------------------------------------------------------------------
export interface UserJwtPayload {
  typ: 'user';
  userId: number;
  siteId: string;
}

export function signUserToken(payload: Omit<UserJwtPayload, 'typ'>): string {
  return jwt.sign({ ...payload, typ: 'user' }, config.jwtSecret, { expiresIn: '30d' });
}

/** 可选登录态：token 有效且 typ=user 时挂 req.user；无效/缺失静默跳过（匿名转链路径） */
export function optionalUser(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret) as UserJwtPayload;
      if (payload.typ === 'user') {
        req.user = { userId: payload.userId, siteId: payload.siteId };
      }
    } catch {
      // 无效 token 按匿名处理，不拦截
    }
  }
  next();
}

/** 强制登录态（M2.3 订单/佣金等使用） */
export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new HttpError(401, '请先登录', 'UNAUTHORIZED'));
    return;
  }
  next();
}
