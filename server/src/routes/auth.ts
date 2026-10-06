import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/client.js';
import { signAdminToken, signUserToken, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { resolveProvider } from '../lib/provider.js';
import { code2Session, mpOAuth, type WxSession } from '../lib/wechat.js';
import { INVITE_REWARD_INGOT } from '../lib/constants.js';
import { writeAudit } from '../lib/audit.js';

export const authRouter = Router();

/**
 * 邀请绑定（M4 分销闭环收口）：
 * 登录请求携带 invite 邀请码（mini 分享卡 path / h5 URL query 透传），绑定成功给邀请人发
 * INVITE_REWARD_INGOT 元宝。规则：
 *  - 邀请人须同站点、status='active'、invite_code 命中且非本人；
 *  - parent_id IS NULL 即可绑（新用户首绑 + 老用户补绑均可，裂变优先；首绑后不可改）；
 *  - 三跳关系一次写齐（parent_id/grand_id/great_id），UPDATE ... WHERE parent_id IS NULL
 *    行锁串行化保证并发下仅一次绑定、仅一次发放；
 *  - 元宝发放照抄 ordersync rebateSql 的 CTE 模式（tx + account upsert，balance_after 独立回填）。
 * 返回是否实际发生绑定。
 */
export async function bindInviter(siteId: string, userId: number, invite: unknown): Promise<boolean> {
  const code = String(invite ?? '').trim().toUpperCase();
  if (!code) return false;
  const { rows: inv } = await pool.query(
    `SELECT user_id, parent_id, grand_id FROM "user"
      WHERE site_id = $1 AND invite_code = $2 AND user_id <> $3 AND status = 'active' LIMIT 1`,
    [siteId, code, userId]
  );
  if (!inv[0]) return false;
  const parent = inv[0];
  const { rows: bound } = await pool.query(
    `UPDATE "user" SET parent_id = $2::bigint, grand_id = $3::bigint, great_id = $4::bigint
      WHERE user_id = $1::bigint AND parent_id IS NULL RETURNING user_id`,
    [userId, parent.user_id, parent.parent_id, parent.grand_id]
  );
  if (!bound[0]) return false;
  await pool.query(
    `WITH tx AS (
       INSERT INTO ingot_tx (user_id, type, ref_id, amount, balance_after, remark)
       VALUES ($1::bigint, 'INVITE_REWARD', $2::text, $3::int, 0, $4)
       RETURNING tx_id
     ), acc AS (
       INSERT INTO ingot_account (user_id, balance, total_earned) VALUES ($1::bigint, $3::int, $3::int)
       ON CONFLICT (user_id) DO UPDATE SET
         balance = ingot_account.balance + EXCLUDED.balance,
         total_earned = ingot_account.total_earned + EXCLUDED.total_earned,
         updated_at = now()
       RETURNING balance
     )
     SELECT (SELECT count(*)::int FROM tx) AS inserted`,
    // ⚠ 网关坑：JSON number 传给 ::text cast 参数会 500 EXEC_ERROR，ref_id 必须传 string
    [parent.user_id, String(userId), INVITE_REWARD_INGOT, `邀请新用户 #${userId}`]
  );
  // balance_after 回填（data-modifying CTE 间快照隔离，须独立语句；仅回填占位值 0，幂等）
  await pool.query(
    `UPDATE ingot_tx SET balance_after = COALESCE((SELECT balance FROM ingot_account WHERE user_id = $1::bigint), 0)
      WHERE user_id = $1::bigint AND type = 'INVITE_REWARD' AND ref_id = $2::text AND balance_after = 0`,
    [String(parent.user_id), String(userId)]
  );
  return true;
}

/**
 * user 查/建（C 端进系统即 openid 入库，2026-09-22 D先生定稿）：
 * ① 按 (site_id, openid列) 查；② 未命中且带 unionid → 按 (site_id, unionid) 查老用户并
 *    回填本端 openid 列（unionid 合并：同一人小程序/H5 一条记录，佣金/关系树不分叉）；
 * ③ 仍未命中 → 建新档。invite_code 补写与 member L1 建档幂等。
 * openidCol：mini→'openid'，h5→'h5_openid'
 */
async function ensureUser(
  siteId: string,
  openidCol: 'openid' | 'h5_openid',
  sess: WxSession
): Promise<{ userId: number; isNew: boolean }> {
  const { rows: existRows } = await pool.query(
    `SELECT user_id, status FROM "user" WHERE site_id = $1 AND ${openidCol} = $2 LIMIT 1`,
    [siteId, sess.openid]
  );
  if (existRows[0]) {
    // 决策 #32 红线：禁用账号即时拦截静默登录（含重登录）
    if (existRows[0].status === 'banned') throw new HttpError(403, '账号已被禁用，如有疑问请联系客服', 'ACCOUNT_BANNED');
    return { userId: Number(existRows[0].user_id), isNew: false };
  }

  if (sess.unionid) {
    // unionid 合并：复用同站点老用户，回填本端 openid
    const { rows: unionRows } = await pool.query(
      `SELECT user_id, unionid, status FROM "user" WHERE site_id = $1 AND unionid = $2 LIMIT 1`,
      [siteId, sess.unionid]
    );
    if (unionRows[0]) {
      if (unionRows[0].status === 'banned') throw new HttpError(403, '账号已被禁用，如有疑问请联系客服', 'ACCOUNT_BANNED');
      await pool.query(
        `UPDATE "user" SET ${openidCol} = $2, unionid = COALESCE(unionid, $3) WHERE user_id = $1`,
        [Number(unionRows[0].user_id), sess.openid, sess.unionid]
      );
      return { userId: Number(unionRows[0].user_id), isNew: false };
    }
  }

  const { rows: insRows } = await pool.query(
    `INSERT INTO "user" (site_id, ${openidCol}, unionid, status) VALUES ($1, $2, $3, 'active') RETURNING user_id`,
    [siteId, sess.openid, sess.unionid ?? null]
  );
  return { userId: Number(insRows[0].user_id), isNew: true };
}

/** C 端登录后置：invite_code 补写 + member L1 建档（均幂等）+ 邀请绑定 + 签 C 端 JWT */
async function finalizeLogin(siteId: string, userId: number, isNew: boolean, invite?: unknown) {
  const inviteCode = 'FYT' + userId.toString(36);
  await pool.query(`UPDATE "user" SET invite_code = $2 WHERE user_id = $1 AND invite_code IS NULL`, [
    userId,
    inviteCode,
  ]);
  await pool.query(
    `INSERT INTO member (user_id, level_id)
     SELECT $1, l.level_id FROM member_level l WHERE l.code = 'L1'
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  const bound = await bindInviter(siteId, userId, invite);
  return { token: signUserToken({ userId, siteId }), userId, inviteCode, isNew, invitedBound: bound };
}

/** 后台登录：admin_user + admin_user_site 三表体系（§8.2） */
authRouter.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      throw new HttpError(400, '用户名或密码不能为空', 'BAD_REQUEST');
    }

    const { rows } = await pool.query(
      `SELECT admin_id, username, password_hash, role, status
         FROM admin_user
        WHERE username = $1 LIMIT 1`,
      [username]
    );
    const admin = rows[0];
    if (!admin || admin.status !== 'active' || !(await bcrypt.compare(password, admin.password_hash))) {
      throw new HttpError(401, '用户名或密码错误', 'BAD_CREDENTIALS');
    }

    const { rows: siteRows } = await pool.query(
      `SELECT site_id, site_role FROM admin_user_site WHERE admin_id = $1`,
      [admin.admin_id]
    );

    const token = signAdminToken({
      adminId: admin.admin_id,
      username: admin.username,
      role: admin.role,
      siteIds: siteRows.map((r) => r.site_id),
    });

    await writeAudit(req, { action: 'admin.login', target_type: 'auth', target_id: admin.username });

    res.json({
      ok: true,
      data: {
        token,
        admin: { adminId: admin.admin_id, username: admin.username, role: admin.role },
        sites: siteRows,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * C 端登录-小程序：code2session → ensureUser（unionid 合并）→ invite_code/member L1 → JWT 30d。
 * 邀请绑定：body.invite 邀请码（分享卡/链接透传），bindInviter 绑三跳 + 邀请人发元宝。
 */
authRouter.post('/clogin', async (req, res, next) => {
  try {
    const siteCode = String(req.body?.site ?? '').trim() || 'site-a';
    const code = String(req.body?.code ?? '').trim();
    if (!code) throw new HttpError(400, '缺少微信登录 code', 'BAD_REQUEST');

    const { rows: siteRows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [siteCode]);
    if (!siteRows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    const siteId = String(siteRows[0].site_id);

    // 小程序 appid/secret 跟 site_id 走（provider_config.provider='wechat_mini'），未配置 503
    const cred = await resolveProvider(siteCode, 'wechat_mini');
    if (!cred.apiSecret) throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', '该站点微信小程序凭据不完整');
    const sess = await code2Session(cred.apikey, cred.apiSecret, code);

    const { userId, isNew } = await ensureUser(siteId, 'openid', sess);
    res.json({ ok: true, data: await finalizeLogin(siteId, userId, isNew, req.body?.invite) });
  } catch (e) {
    next(e);
  }
});

/**
 * C 端登录-公众号 H5（2026-09-22 定稿：不存在脱离微信环境的 H5 场景，进系统即静默授权入库）：
 * OAuth code（snsapi_base）→ mpOAuth → ensureUser（unionid 合并，openid 列=h5_openid）→ JWT 30d。
 * body.invite 邀请码随登录绑定（H5 bootstrap 从 URL query 透传，OAuth 回跳保留）。
 * 显示登录（头像昵称）是后续独立行为，不在此处。
 */
authRouter.post('/hlogin', async (req, res, next) => {
  try {
    const siteCode = String(req.body?.site ?? '').trim() || 'site-a';
    const code = String(req.body?.code ?? '').trim();
    if (!code) throw new HttpError(400, '缺少公众号授权 code', 'BAD_REQUEST');

    const { rows: siteRows } = await pool.query(`SELECT site_id FROM site WHERE code = $1 LIMIT 1`, [siteCode]);
    if (!siteRows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
    const siteId = String(siteRows[0].site_id);

    // 公众号 appid/secret 跟 site_id 走（provider_config.provider='wechat_mp'），未配置 503
    const cred = await resolveProvider(siteCode, 'wechat_mp');
    if (!cred.apiSecret) throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', '该站点公众号凭据不完整');
    const sess = await mpOAuth(cred.apikey, cred.apiSecret, code);

    const { userId, isNew } = await ensureUser(siteId, 'h5_openid', sess);
    res.json({ ok: true, data: await finalizeLogin(siteId, userId, isNew, req.body?.invite) });
  } catch (e) {
    next(e);
  }
});

/** 公众号 OAuth 跳转所需 appid（公开信息，非密钥）：H5 进系统构造 authorize URL 用 */
authRouter.get('/mpconfig', async (req, res, next) => {
  try {
    const siteCode = String(req.query.site ?? '').trim() || 'site-a';
    const cred = await resolveProvider(siteCode, 'wechat_mp');
    res.json({ ok: true, data: { appid: cred.apikey } });
  } catch (e) {
    next(e);
  }
});

/** 管理员改密（系统设置屏）：验旧密 → 新密 ≥8 位 → bcrypt 更新 */
authRouter.post('/admin/password', requireAdmin, async (req, res, next) => {
  try {
    const oldPwd = String(req.body?.old_password ?? '');
    const newPwd = String(req.body?.new_password ?? '');
    if (newPwd.length < 8) throw new HttpError(400, '新密码至少 8 位', 'BAD_PASSWORD');
    if (newPwd === oldPwd) throw new HttpError(400, '新密码不能与旧密码相同', 'SAME_PASSWORD');

    const { rows } = await pool.query(
      `SELECT admin_id, password_hash FROM admin_user WHERE admin_id::text = $1::text AND status = 'active' LIMIT 1`,
      [String(req.admin!.adminId)], // 网关铁律：parameters 须全字符串，number 直接 DATABASE_EXEC_ERROR
    );
    if (!rows[0]) throw new HttpError(404, '账号不存在或已停用', 'ADMIN_NOT_FOUND');
    if (!(await bcrypt.compare(oldPwd, rows[0].password_hash))) {
      throw new HttpError(400, '旧密码不正确', 'WRONG_OLD_PASSWORD');
    }
    // ⚠️ must_change_password 必须同条置回 false（决策 #37 修 bug）：
    //    旧实现只改 password_hash 不动该标记 → 改完密码下次登录仍被强制改密拦，永久死循环。
    await pool.query(
      `UPDATE admin_user SET password_hash = $1::text, must_change_password = false WHERE admin_id::text = $2::text`,
      [
        await bcrypt.hash(newPwd, 10),
        String(req.admin!.adminId), // 网关铁律：parameters 须全字符串
      ]
    );
    await writeAudit(req, { action: 'admin.password_change', target_type: 'auth', target_id: req.admin!.username });
    // 强制重登：改密后旧 token 仍在有效期内，前端收到 must_relogin 后清本地态回登录页
    res.json({ ok: true, data: { changed: true, must_relogin: true } });
  } catch (e) {
    next(e);
  }
});
