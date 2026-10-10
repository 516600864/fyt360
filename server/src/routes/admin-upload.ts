/**
 * 后台图片上传（轮播图/底部菜单图标等装修素材）。
 * 通道：@cloudbase/node-sdk 云存储（TCB_SECRET_ID/KEY 平台凭据，容器 EnvParams 注入）。
 * 永久 URL：https://{env}.tcb.qcloud.la/{cloudPath}（存储默认「所有用户可读」）。
 * body: { filename, data: base64 }（≤3MB 原始体积，前端 el-upload 自定义请求转 base64）
 */
import { Router, Request, Response, NextFunction } from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin } from '../middleware/auth.js';

export const uploadRouter = Router();

/** 公开媒体代理挂载于 /api/media（bucket 私有读 → 302 getTempFileURL） */
export const mediaRouter = Router();

const EXT_WHITELIST = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const MAX_RAW_BYTES = 3 * 1024 * 1024;

type CloudBaseApp = {
  uploadFile(opts: { cloudPath: string; fileContent: Buffer }): Promise<{ fileID?: string }>;
  getTempFileURL(opts: { fileList: string[] }): Promise<{ fileList: { fileID?: string; tempFileURL?: string; status?: number; code?: string }[] }>;
};
let tcbApp: CloudBaseApp | null = null;
let bucketPrefix = ''; // cloud://{env}.{bucket}（TCB_STORAGE_BUCKET 配置或首个 fileID 回填）

function tcb(): CloudBaseApp {
  if (tcbApp) return tcbApp;
  const secretId = process.env.TCB_SECRET_ID ?? '';
  const secretKey = process.env.TCB_SECRET_KEY ?? '';
  if (!process.env.TCB_ENV || !secretId || !secretKey) {
    throw new HttpError(503, '云存储通道未配置（缺 TCB_ENV/TCB_SECRET_ID/TCB_SECRET_KEY）', 'STORAGE_NOT_CONFIGURED');
  }
  const CloudBase = createRequire(import.meta.url)('@cloudbase/node-sdk');
  tcbApp = CloudBase.init({ secretId, secretKey, envId: process.env.TCB_ENV }) as CloudBaseApp;
  return tcbApp;
}

function resolveBucketPrefix(): string {
  if (bucketPrefix) return bucketPrefix;
  const b = process.env.TCB_STORAGE_BUCKET ?? '';
  if (b) {
    bucketPrefix = `cloud://${process.env.TCB_ENV}.${b}`;
    return bucketPrefix;
  }
  throw new HttpError(503, '缺 TCB_STORAGE_BUCKET 配置（存储桶名，形如 6679-{env}-{appid}）', 'BUCKET_NOT_CONFIGURED');
}

/** GET /api/media/uploads|avatar/{path} → 302 临时 URL（C 端渲染免登录）。
 *  前缀白名单：uploads=admin 图片 / avatar=C 端头像（2026-10-09 修复：avatar 前缀此前
 *  不在读取路由内 → 头像保存后 404 显示不出来，D先生 实测实锤）。 */
mediaRouter.get(/^\/(uploads|avatar)\/.+$/, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cloudPath = decodeURIComponent(req.path.slice(1));
    if (cloudPath.includes('..')) throw new HttpError(400, '非法路径', 'BAD_PATH');
    const app = tcb();
    const prefix = resolveBucketPrefix();
    const t = await app.getTempFileURL({ fileList: [`${prefix}/${cloudPath}`] });
    const f = t.fileList?.[0];
    if (!f?.tempFileURL) throw new HttpError(404, '文件不存在', 'MEDIA_NOT_FOUND');
    res.set('Cache-Control', 'public, max-age=600');
    res.redirect(f.tempFileURL);
  } catch (e) { next(e); }
});

/** 共享：base64 → 云存储上传（admin-upload 与 C 端 profile/avatar 同源复用） */
export async function tcbUploadRaw(cloudPath: string, buf: Buffer): Promise<{ fileID?: string }> {
  const r = await tcb().uploadFile({ cloudPath, fileContent: buf });
  if (!bucketPrefix && r?.fileID) {
    const m = r.fileID.match(/^(cloud:\/\/[^/]+)\//);
    if (m) bucketPrefix = m[1];
  }
  return r ?? {};
}

uploadRouter.post('/upload', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filename = String(req.body?.filename ?? '');
    const rawB64 = String(req.body?.data ?? '').replace(/^data:[^;]+;base64,/, '');
    if (!rawB64) throw new HttpError(400, '缺少图片数据（data base64）', 'NO_DATA');

    const buf = Buffer.from(rawB64, 'base64');
    if (!buf.length) throw new HttpError(400, '图片数据为空', 'EMPTY_FILE');
    if (buf.length > MAX_RAW_BYTES) throw new HttpError(413, '图片超过 3MB 上限', 'FILE_TOO_LARGE');

    const ext = path.extname(filename).slice(1).toLowerCase() || 'png';
    if (!EXT_WHITELIST.includes(ext)) {
      throw new HttpError(400, `不支持的格式：${ext}（仅 ${EXT_WHITELIST.join('/')}）`, 'BAD_EXT');
    }

    const now = new Date();
    const cloudPath = `uploads/${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}/${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const r = await tcb().uploadFile({ cloudPath, fileContent: buf });
    // 首个 fileID 回填桶前缀（双保险：TCB_STORAGE_BUCKET 未配置时冷启动后首个 media 请求仍可推导）
    if (!bucketPrefix && r?.fileID) {
      const m = r.fileID.match(/^(cloud:\/\/[^/]+)\//);
      if (m) bucketPrefix = m[1];
    }
    // bucket 私有读：回代理 URL（/api/media/* 302 → 临时 URL），域名走已配置的站点域名
    const base = process.env.PUBLIC_BASE_URL ?? 'https://mk.fyt360.cn';
    res.json({
      ok: true,
      data: {
        url: `${base}/api/media/${cloudPath}`,
        file_id: r?.fileID ?? '',
        bytes: buf.length,
      },
    });
  } catch (e) {
    next(e);
  }
});
