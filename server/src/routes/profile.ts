/**
 * C 端个人资料（画布 26 登录授权 / 27 收货地址 / 28 设置）。
 * 挂载于 /api/profile/*，requireUser（手机号与地址均需登录态）。
 * 手机号 = 小程序 getPhoneNumber code → stable_token → getuserphonenumber 换真实号码（凭据跟 site_id 走）。
 * 地址 = user_address 表，每用户 ≤20 条，默认地址唯一（partial unique index 兜底）。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireUser, optionalUser } from '../middleware/auth.js';
import { resolveProvider } from '../lib/provider.js';
import { tcbUploadRaw } from './admin-upload.js';

export const profileRouter = Router();

// token 解析（clogin JWT → req.user）；不挂 optionalUser 则 requireUser 永远 401（me.ts 同款坑）
profileRouter.use(optionalUser);

const MAX_ADDRESSES = 20;

/** 小程序 stable_token（provider_config wechat_mini 凭据，跟 site_id 走） */
async function getMiniAccessToken(siteId: string): Promise<string> {
  const { rows } = await pool.query(`SELECT code FROM site WHERE site_id = $1::uuid LIMIT 1`, [siteId]);
  const cred = await resolveProvider(rows[0]?.code, 'wechat_mini');
  if (!cred.apiSecret) throw new HttpError(503, '该站点微信小程序凭据不完整', 'PROVIDER_NOT_CONFIGURED');
  const r = await fetch('https://api.weixin.qq.com/cgi-bin/stable_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid: cred.apikey, secret: cred.apiSecret }),
  });
  const j = (await r.json().catch(() => null)) as { access_token?: string; errmsg?: string } | null;
  if (!j?.access_token) throw new HttpError(502, `获取小程序凭证失败：${j?.errmsg ?? '响应异常'}`, 'WX_TOKEN_ERROR');
  return j.access_token;
}

/** POST /api/profile/phone → 手机号一键登录绑定（body: { code }） */
profileRouter.post('/phone', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = String(req.body?.code ?? '');
    if (!code) throw new HttpError(400, '缺少 code', 'BAD_PARAM');
    const token = await getMiniAccessToken(req.user!.siteId);
    const r = await fetch(`https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const j = (await r.json().catch(() => null)) as
      | { errcode?: number; errmsg?: string; phone_info?: { phoneNumber?: string; purePhoneNumber?: string } }
      | null;
    const phone = j?.phone_info?.purePhoneNumber ?? j?.phone_info?.phoneNumber;
    if (!phone) throw new HttpError(502, `手机号获取失败：${j?.errmsg ?? `errcode=${j?.errcode}`}`, 'WX_PHONE_ERROR');
    await pool.query(`UPDATE "user" SET phone = $1::varchar WHERE user_id = $2::bigint`, [phone, req.user!.userId]);
    res.json({ ok: true, data: { phone: phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') } });
  } catch (e) {
    next(e);
  }
});

/** POST /api/profile → 更新昵称/头像（头像昵称填写能力） */
profileRouter.post('/', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const nickname = String(req.body?.nickname ?? '').trim().slice(0, 64);
    const avatar = String(req.body?.avatar ?? '').trim().slice(0, 1024);
    if (!nickname && !avatar) throw new HttpError(400, '无可更新字段', 'BAD_PARAM');
    await pool.query(
      `UPDATE "user" SET
         nickname = CASE WHEN $1::varchar <> '' THEN $1::varchar ELSE nickname END,
         avatar   = CASE WHEN $2::text   <> '' THEN $2::text   ELSE avatar   END
       WHERE user_id = $3::bigint`,
      [nickname, avatar, req.user!.userId],
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** GET /api/profile/addresses → 地址列表（默认排前，新排后） */
profileRouter.get('/addresses', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, phone, region, detail, tag, is_default
       FROM user_address WHERE user_id = $1::bigint
       ORDER BY is_default DESC, id DESC LIMIT 20`,
      [req.user!.userId],
    );
    res.json({
      ok: true,
      data: rows.map((r) => ({
        id: Number(r.id),
        name: r.name,
        phone: String(r.phone).replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2'),
        region: r.region,
        detail: r.detail,
        tag: r.tag,
        is_default: r.is_default === 1,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/** 校验地址 body 并归一化 */
function parseAddrBody(b: Record<string, unknown>) {
  const name = String(b.name ?? '').trim().slice(0, 64);
  const phone = String(b.phone ?? '').trim().slice(0, 32);
  const region = String(b.region ?? '').trim().slice(0, 128);
  const detail = String(b.detail ?? '').trim().slice(0, 256);
  const tag = ['家', '公司', '学校'].includes(String(b.tag)) ? String(b.tag) : '家';
  const isDefault = b.is_default === true || b.is_default === 1 ? 1 : 0;
  if (!name || !phone || !detail) throw new HttpError(400, '收货人/电话/详细地址不能为空', 'BAD_PARAM');
  if (!/^1\d{10}$/.test(phone)) throw new HttpError(400, '手机号格式不正确', 'BAD_PHONE');
  return { name, phone, region, detail, tag, isDefault };
}

/** POST /api/profile/addresses → 新增（首条自动默认；≤20 条） */
profileRouter.post('/addresses', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const a = parseAddrBody(req.body ?? {});
    const cnt = await pool.query(`SELECT COUNT(*)::int AS n FROM user_address WHERE user_id = $1::bigint`, [req.user!.userId]);
    if (cnt.rows[0].n >= MAX_ADDRESSES) throw new HttpError(400, `最多可保存 ${MAX_ADDRESSES} 条收货地址`, 'ADDR_LIMIT');
    const isFirst = cnt.rows[0].n === 0;
    const isDefault = isFirst ? 1 : a.isDefault;
    if (isDefault) await pool.query(`UPDATE user_address SET is_default = 0 WHERE user_id = $1::bigint`, [req.user!.userId]);
    const { rows } = await pool.query(
      `INSERT INTO user_address (user_id, name, phone, region, detail, tag, is_default)
       VALUES ($1::bigint, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::varchar, $7::int)
       RETURNING id`,
      [req.user!.userId, a.name, a.phone, a.region, a.detail, a.tag, isDefault],
    );
    res.json({ ok: true, data: { id: Number(rows[0].id) } });
  } catch (e) {
    next(e);
  }
});

/** PUT /api/profile/addresses/:id → 编辑（归属校验） */
profileRouter.put('/addresses/:id', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '地址 ID 不合法', 'BAD_PARAM');
    const a = parseAddrBody(req.body ?? {});
    const own = await pool.query(`SELECT id FROM user_address WHERE id = $1::bigint AND user_id = $2::bigint LIMIT 1`, [id, req.user!.userId]);
    if (!own.rows[0]) throw new HttpError(404, '地址不存在', 'ADDR_NOT_FOUND');
    if (a.isDefault) await pool.query(`UPDATE user_address SET is_default = 0 WHERE user_id = $1::bigint`, [req.user!.userId]);
    await pool.query(
      `UPDATE user_address SET name=$1::varchar, phone=$2::varchar, region=$3::varchar, detail=$4::varchar, tag=$5::varchar,
         is_default = $6::int, updated_at = now()
       WHERE id = $7::bigint AND user_id = $8::bigint`,
      [a.name, a.phone, a.region, a.detail, a.tag, a.isDefault, id, req.user!.userId],
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/profile/addresses/:id → 删除（删默认时自动顺延最新一条为默认） */
profileRouter.delete('/addresses/:id', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '地址 ID 不合法', 'BAD_PARAM');
    const r = await pool.query(`DELETE FROM user_address WHERE id = $1::bigint AND user_id = $2::bigint RETURNING is_default`, [id, req.user!.userId]);
    if (!r.rows[0]) throw new HttpError(404, '地址不存在', 'ADDR_NOT_FOUND');
    if (r.rows[0].is_default === 1) {
      await pool.query(
        `UPDATE user_address SET is_default = 1 WHERE id = (
           SELECT id FROM user_address WHERE user_id = $1::bigint ORDER BY id DESC LIMIT 1 )`,
        [req.user!.userId],
      );
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** POST /api/profile/addresses/:id/default → 设默认 */
profileRouter.post('/addresses/:id/default', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, '地址 ID 不合法', 'BAD_PARAM');
    const own = await pool.query(`SELECT id FROM user_address WHERE id = $1::bigint AND user_id = $2::bigint LIMIT 1`, [id, req.user!.userId]);
    if (!own.rows[0]) throw new HttpError(404, '地址不存在', 'ADDR_NOT_FOUND');
    await pool.query(`UPDATE user_address SET is_default = 0 WHERE user_id = $1::bigint`, [req.user!.userId]);
    await pool.query(`UPDATE user_address SET is_default = 1, updated_at = now() WHERE id = $1::bigint AND user_id = $2::bigint`, [id, req.user!.userId]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** POST /api/profile/avatar → C 端头像上传（body: { filename, data: base64 }，复用云存储通道） */
profileRouter.post('/avatar', requireUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filename = String(req.body?.filename ?? 'avatar.png');
    const rawB64 = String(req.body?.data ?? '').replace(/^data:[^;]+;base64,/, '');
    if (!rawB64) throw new HttpError(400, '缺少图片数据（data base64）', 'NO_DATA');
    const buf = Buffer.from(rawB64, 'base64');
    if (!buf.length) throw new HttpError(400, '图片数据为空', 'EMPTY_FILE');
    if (buf.length > 1024 * 1024) throw new HttpError(413, '头像超过 1MB 上限', 'FILE_TOO_LARGE');
    const ext = ['png', 'jpg', 'jpeg', 'webp'].includes(filename.split('.').pop()?.toLowerCase() ?? '') ? filename.split('.').pop()!.toLowerCase() : 'png';
    const cloudPath = `avatar/u${req.user!.userId}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
    await tcbUploadRaw(cloudPath, buf);
    const base = process.env.PUBLIC_BASE_URL ?? 'https://mk.fyt360.cn';
    res.json({ ok: true, data: { url: `${base}/api/media/${cloudPath}` } });
  } catch (e) {
    next(e);
  }
});
