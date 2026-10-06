/**
 * 未开通站点白名单拦截（决策 #43，D先生 2026-10-05）。
 *
 * 背景：新建站点只是个「空壳」。没配蚂蚁星球凭据的站点，看板/订单/商品全是 0，
 * 运营进去第一反应是「平台没数据」而不是「还没配 key」——这是真会被投诉的。
 * 所以侧栏白名单模式：**只有「凭据开通」能点，其余全锁**，且判定在服务端。
 *
 * 为什么必须在服务端：前端置灰只是 UI 装饰，运营把请求地址改一下就能拿到数据，
 * 或者运维直接 curl。业务空白期的看板必须服务端也拿不到，才是真锁。
 *
 * 白名单路径（其余 /api/admin/* 一律拦）：
 *   - /api/auth/*                登录/改密（改密不能被站点状态卡住，否则进不去）
 *   - /api/admin/account/*       账户三页 + 消息中心（顶栏，决策#37）
 *   - /api/admin/sites/*         站点管理本体（屏 31：建壳/移交/停用）
 *   - /api/admin/sites/provision/* 屏 52 凭据开通向导 ← 唯一放行的业务入口
 *   - /api/admin/settings/*      系统设置（凭据矩阵，历史入口，不能断）
 *   - /api/admin/payment/*       支付商户（真相源在这里，未开通期也允许配置）
 *
 * 当前站从 `X-Fyt-Site` 头取（会话单站存前端 localStorage，见 api.js 注释）。
 * ⛔ 该头**不授予任何权限**：站点访问权仍由 assertSiteAccess 按 JWT.siteIds 判定，
 *    这里只回答「这个站开通了没有」，改头最多把自己的站换成另一个未开通站。
 */
import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from './errors.js';

const ALLOW_PREFIX = [
  '/api/auth',
  '/api/admin/account',
  '/api/admin/sites',
  '/api/admin/settings',
  '/api/admin/payment',
];

/** 这些前缀必须全量放行——它们是「把站开通」本身要用到的路径 */
const ALLOW_EXACT = new Set(['/api/admin/orders/filter-options']);

/** 未开通判定缓存：连通测试刚跑过不必每次请求都打 DB（10s TTL，够快且能自动生效） */
const cache = new Map<string, { provisioned: boolean; expires: number }>();
const CACHE_TTL_MS = 10_000;

async function queryProvisioned(siteCode: string): Promise<boolean> {
  const hit = cache.get(siteCode);
  if (hit && hit.expires > Date.now()) return hit.provisioned;
  const { rows } = await pool.query(
    `SELECT 1 FROM provider_config pc
       JOIN site s ON s.site_id = pc.site_id
      WHERE s.code = $1 AND pc.provider = 'mayixingqiu'
        AND pc.status = 'active' AND pc.test_status = 'passed'
      LIMIT 1`,
    [siteCode],
  );
  const provisioned = rows.length > 0;
  cache.set(siteCode, { provisioned, expires: Date.now() + CACHE_TTL_MS });
  return provisioned;
}

/** 连通测试/凭据保存后调它，免得运营刚测完还得等 10 秒才生效 */
export function invalidateProvisionCache(siteCode?: string): void {
  if (siteCode) cache.delete(siteCode);
  else cache.clear();
}

export async function provisionGate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const path = req.originalUrl.split('?')[0];
  if (ALLOW_EXACT.has(path)) { next(); return; }
  // ⚠️ startsWith 前缀匹配要带斜杠边界，否则 /api/admin/sitesXXX 会被误放行
  if (ALLOW_PREFIX.some((p) => path === p || path.startsWith(p + '/'))) { next(); return; }

  // ⛔ 2026-10-05 容错：HTTP 重复头（代理链路合法场景，Node 会合并）会变成 "code, code"。
  //   前端根因已修（api.js 与 main.js 双写站点头），但这里取第一段防御代理等中间层再引入，
  //   否则症状极阴险：凭据明明保存 passed 了，看板还是 403「code, code 尚未开通」。
  const siteCode = String(req.headers['x-fyt-site'] ?? '').split(',')[0].trim();
  // 平台工作台（聚合只读）无当前站概念 → 放行
  if (!siteCode) { next(); return; }

  try {
    const provisioned = await queryProvisioned(siteCode);
    if (provisioned) { next(); return; }
    next(new HttpError(
      403,
      `站点「${siteCode}」尚未开通：仅「凭据开通」可访问。配置蚂蚁星球 apikey 并通过连通性测试后自动解锁。`,
      'SITE_NOT_PROVISIONED',
    ));
  } catch (e) {
    next(e);
  }
}