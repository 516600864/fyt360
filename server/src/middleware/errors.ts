import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'HTTP_ERROR'
  ) {
    super(message);
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ ok: false, code: 'NOT_FOUND', message: '接口不存在' });
}

/** 粗粒度错误指纹，用于日志聚合（同一类错误只打一行，不刷屏）。 */
function errorFingerprint(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
  return name + err.message.replace(/[0-9a-f]{8,}/gi, '#').slice(0, 120);
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ ok: false, code: err.code, message: err.message });
    return;
  }
  // 未知错误：服务端记录详情，对外只给通用信息（不泄露内部堆栈）
  // ⚠️ 务必带上「方法 + 路径 + 错误指纹」——否则线上只有一句「服务内部错误」，
  //    定位时完全无从下手（2026-10-04 AI 换肤 500 就是这么查了半天的）。
  const fp = errorFingerprint(err);
  console.error(`[unhandled] ${req.method} ${req.originalUrl} | ${fp}`);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err);
  }
  // ⛔ 生产也回传指纹：指纹是**脱敏后的错误摘要**（不含 SQL 原文/凭据），
  //    「服务内部错误」五个字在线上等于零信息量，排查只能靠这个。
  //    需要完全静默时把 DEBUG_FINGERPRINT=false 塞进 .env。
  const showFp = process.env.NODE_ENV !== 'production'
    || !/^(false|0|no)$/i.test(String(process.env.DEBUG_FINGERPRINT ?? 'true'));
  res.status(500).json({
    ok: false,
    code: 'INTERNAL',
    message: '服务内部错误',
    ...(showFp ? { detail: fp } : {}),
  });
}
