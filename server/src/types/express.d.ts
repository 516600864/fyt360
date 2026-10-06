import type { Request } from 'express';
import type { AdminJwtPayload } from './auth.js';
import type { UserJwtPayload } from './auth.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: AdminJwtPayload;
      /** C 端登录态（optionalUser 注入，匿名请求不存在） */
      user?: Omit<UserJwtPayload, 'typ'>;
    }
  }
}

export {};
