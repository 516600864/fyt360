// 供给侧配置解析（决策 #25①：apikey/secret 跟 site_id 走，存 provider_config，不落 .env）
// 通用入口 resolveProvider(siteCode, provider)：mayixingqiu / wechat_mini 等按站点取凭据
import type { Pool } from 'pg';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';

export interface ProviderCred {
  siteId: string;
  apikey: string;
  apiSecret: string | null;
}

export interface HjkProviderConfig {
  siteId: string;
  apikey: string;
  /** md5 签名密钥（dcorder/movieorder/recharge 签名接口必需，null=未配置，签名类接口跳过） */
  apiSecret: string | null;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { cred: ProviderCred | null; expires: number }>();

/** 按 site code + provider 解析供应商凭据，60s 缓存；未配置抛 503 */
export async function resolveProvider(
  siteCode: string | undefined,
  provider: string
): Promise<ProviderCred> {
  const code = siteCode?.trim() || 'site-a';
  const ck = `${provider}:${code}`;
  const hit = cache.get(ck);
  if (hit && hit.expires > Date.now()) {
    if (!hit.cred) throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', `该站点未配置 ${provider} 凭据`);
    return hit.cred;
  }

  const { rows } = await pool.query(
    `SELECT pc.site_id, pc.apikey, pc.api_secret
       FROM provider_config pc
       JOIN site s ON s.site_id = pc.site_id
      WHERE s.code = $1 AND pc.provider = $2 AND pc.status = 'active'
      LIMIT 1`,
    [code, provider]
  );
  const cred: ProviderCred | null = rows[0]
    ? {
        siteId: String(rows[0].site_id),
        apikey: String(rows[0].apikey),
        apiSecret: rows[0].api_secret != null ? String(rows[0].api_secret) : null,
      }
    : null;
  cache.set(ck, { cred, expires: Date.now() + CACHE_TTL_MS });
  if (!cred) throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', `该站点未配置 ${provider} 凭据`);
  return cred;
}

/** 蚂蚁星球（mayixingqiu）配置：商品代理/转链/订单同步共用 */
export async function resolveHjkConfig(siteCode?: string): Promise<HjkProviderConfig> {
  const cred = await resolveProvider(siteCode, 'mayixingqiu');
  return { siteId: cred.siteId, apikey: cred.apikey, apiSecret: cred.apiSecret };
}

export function invalidateProviderCache(siteCode?: string): void {
  if (siteCode) {
    for (const k of cache.keys()) {
      if (k.endsWith(`:${siteCode}`)) cache.delete(k);
    }
  } else {
    cache.clear();
  }
}
