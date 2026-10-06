/**
 * 签到每日提醒（决策#32，2026-09-30）：云托管定时触发器回调 → POST /api/jobs/checkin-remind/cron。
 * 机制：一次性订阅 = 授权一次发一条（user_push_quota.quota）。
 * 流程：遍历站点 → 模板未配置诚实跳过 → 查 quota>0 且今日未签到用户 → subscribe/send（{n}=今日可得元宝）→ 成功 quota-1。
 * 凭据/模板跟 site_id 走（provider_config wechat_mini）；日期口径 Asia/Shanghai 与 checkin.ts 一致。
 */
import { pool } from '../db/client.js';
import { resolveProvider } from '../lib/provider.js';

const TOKEN_TTL_MS = 110 * 60 * 1000; // stable_token 有效期 7200s，留缓冲
const tokenCache = new Map<string, { token: string; expires: number }>();

async function getAccessToken(siteId: string, siteCode: string): Promise<string> {
  const hit = tokenCache.get(siteId);
  if (hit && hit.expires > Date.now()) return hit.token;
  const cred = await resolveProvider(siteCode, 'wechat_mini');
  if (!cred.apiSecret) throw new Error(`站点 ${siteCode} wechat_mini 凭据不完整`);
  const r = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid: cred.apikey, secret: cred.apiSecret }),
  });
  const j = (await r.json().catch(() => null)) as { access_token?: string; errmsg?: string } | null;
  if (!j?.access_token) throw new Error(`获取 access_token 失败：${j?.errmsg ?? '响应异常'}`);
  tokenCache.set(siteId, { token: j.access_token, expires: Date.now() + TOKEN_TTL_MS });
  return j.access_token;
}

/** 地图值递归替换 {n} 占位符（n = 今日可得元宝） */
function fillMap(map: Record<string, unknown>, n: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v && typeof v === 'object') out[k] = fillMap(v as Record<string, unknown>, n);
    else if (typeof v === 'string') out[k] = v.replaceAll('{n}', String(n));
    else out[k] = v;
  }
  return out;
}

function todayStr(): string {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function yesterdayStr(): string {
  return new Date(Date.now() + 8 * 3600 * 1000 - 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface RemindResult {
  sites: Array<{ site: string; skipped?: string; sent?: number; cleared?: number; failed?: number }>;
}

/** 全站点签到提醒（单次全量；由定时触发器每日 09:00 调起，亦可 admin 手动触发） */
export async function runCheckinRemind(): Promise<RemindResult> {
  const today = todayStr();
  const yesterday = yesterdayStr();
  const out: RemindResult['sites'] = [];

  const { rows: sites } = await pool.query(
    `SELECT s.site_id::text AS site_id, s.code, pc.config, pc.apikey
       FROM site s
       JOIN provider_config pc ON pc.site_id = s.site_id AND pc.provider = 'wechat_mini' AND pc.status = 'active'
      WHERE s.status = 'active'`
  );

  for (const s of sites) {
    // 模板/映射未配置 → 诚实跳过（不造假发送）
    let cfg: Record<string, unknown> = {};
    try {
      const raw = s.config;
      cfg = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
    } catch { cfg = {}; }
    const tmpl = String(cfg.tmpl_checkin ?? '').trim();
    const mapRaw = cfg.tmpl_checkin_map;
    const map = mapRaw && typeof mapRaw === 'object' ? (mapRaw as Record<string, unknown>) : null;
    if (!tmpl || !map || Object.keys(map).length === 0) {
      out.push({ site: s.code, skipped: 'push_not_configured' });
      continue;
    }

    try {
      const token = await getAccessToken(s.site_id, s.code);
      // 站点奖励梯度
      const { rows: srow } = await pool.query(`SELECT checkin_rewards FROM site WHERE site_id = $1::uuid LIMIT 1`, [s.site_id]);
      let rewards = [50, 60, 70, 80, 90, 100, 500];
      const rawRew = srow[0]?.checkin_rewards;
      if (Array.isArray(rawRew) && rawRew.length === 7) rewards = (rawRew as unknown[]).map(Number);

      // 有额度且今日未签到的用户（openid 必须有——订阅消息按 openid 发）
      const { rows: users } = await pool.query(
        `SELECT q.user_id, u.openid, q.quota, c.streak, c.last_date
           FROM user_push_quota q
           JOIN "user" u ON u.user_id = q.user_id AND u.openid IS NOT NULL
           LEFT JOIN checkin_record c ON c.site_id = q.site_id AND c.user_id = q.user_id
          WHERE q.site_id = $1::uuid AND q.quota > 0
            AND (c.user_id IS NULL OR (c.last_date AT TIME ZONE 'Asia/Shanghai')::date <> $2::date)`,
        [s.site_id, today]
      );

      let sent = 0;
      let cleared = 0;
      let failed = 0;
      for (const u of users) {
        const streak = Number(u.streak ?? 0);
        const lastDate = u.last_date ? String(u.last_date).slice(0, 10) : '';
        // 今日可得：昨日连签且未盆满 → rewards[streak]；盆满开新盆/断签重计 → rewards[0]
        const nextN = streak >= 7 ? rewards[0] : (lastDate === yesterday ? rewards[Math.min(streak, 6)] : rewards[0]);
        const body = {
          touser: String(u.openid),
          template_id: tmpl,
          page: 'pages/index/index',
          data: fillMap(map, nextN),
        };
        try {
          const r = await fetch(`https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const j = (await r.json().catch(() => null)) as { errcode?: number; errmsg?: string } | null;
          const code = j?.errcode ?? 0;
          if (code === 0) {
            // 发送成功 → 消耗一条额度
            await pool.query(
              `UPDATE user_push_quota SET quota = quota - 1, updated_at = now()
                WHERE user_id = $1::bigint AND quota > 0`,
              [u.user_id]
            );
            sent += 1;
          } else if (code === 43101) {
            // 用户未订阅/额度已耗尽 → 清零，避免反复空查
            await pool.query(`UPDATE user_push_quota SET quota = 0, updated_at = now() WHERE user_id = $1::bigint`, [u.user_id]);
            cleared += 1;
          } else {
            failed += 1;
            console.warn(`[checkin-remind] ${s.code}/${u.user_id} send err ${code}: ${j?.errmsg ?? ''}`);
          }
        } catch (e) {
          failed += 1;
          console.warn(`[checkin-remind] ${s.code}/${u.user_id} send error:`, e);
        }
      }
      out.push({ site: s.code, sent, cleared, failed });
    } catch (e) {
      out.push({ site: s.code, skipped: `error: ${(e as Error).message}` });
    }
  }
  return { sites: out };
}
