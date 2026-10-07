import express from 'express';
import { pool } from './db/client.js';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { authRouter } from './routes/auth.js';
import { siteRouter } from './routes/site.js';
import { goodsRouter } from './routes/goods.js';
import { linkRouter } from './routes/link.js';
import { jobsRouter } from './routes/jobs.js';
import { ingotRouter } from './routes/ingot.js';
import { dashboardRouter } from './routes/dashboard.js';
import { ordersRouter } from './routes/orders.js';
import { sitesRouter } from './routes/sites.js';
import { adminGoodsRouter } from './routes/admin-goods.js';
import { distributionRouter } from './routes/distribution.js';
import { aiRouter } from './routes/ai.js';
import { withdrawRouter } from './routes/withdraw.js';
import { commissionRouter } from './routes/commission.js';
import { verifyRouter } from './routes/verify.js';
import { marketingRouter } from './routes/marketing.js';
import { schemaRouter } from './routes/schema.js';
import { uploadRouter, mediaRouter } from './routes/admin-upload.js';
import { tabbarRouter } from './routes/admin-tabbar.js';
import { paymentRouter } from './routes/admin-payment.js';
import { settingsRouter } from './routes/admin-settings.js';
import { meRouter } from './routes/me.js';
import { profileRouter } from './routes/profile.js';
import { tradeRouter } from './routes/trade.js';
import { memberRouter } from './routes/member.js';
import { rightsRouter } from './routes/rights.js';
import { chatRouter } from './routes/chat.js';
import { checkinRouter } from './routes/checkin.js';
import { favoriteRouter } from './routes/favorite.js'; // 决策#41 我的收藏 / 浏览足迹
import { provisionRouter } from './routes/site-provision.js'; // 决策#43 屏52 凭据开通向导（4 组凭据，唯一做连通测试的是蚂蚁星球）
import { provisionGate } from './middleware/provision-gate.js'; // 决策#43 未开通站点白名单拦截（server 端强制，绕前端也拿不到数据）
import { checkinAdminRouter } from './routes/admin-checkin.js';
import { hotwordAdminRouter } from './routes/admin-hotword.js';
import { accountAdminRouter } from './routes/admin-account.js';
import { membersRouter } from './routes/members.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' })); // 装修素材 base64 上传（≤3MB 原图）

// 健康探针（云托管探活 + M1 验收项）
app.get('/healthz', async (_req, res) => {
  let dbOk = false;
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch {
    dbOk = false;
  }
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    service: 'fyt360-api',
    env: config.tcbEnv,
    db: dbOk,
    time: new Date().toISOString(),
  });
});

// ⛔ 2026-10-05：API 响应一律 no-store。Express 默认给 JSON 带 ETag + Last-Modified
//   且不带 Cache-Control，中间任何一层（浏览器启发式缓存 / tcbgw 边缘节点）都可能把
//   GET 旧响应吐回来 —— 症状极阴险：保存 200 成功，页面重新拉取却还是保存前的旧状态，
//   用户结论永远是「没保存上」。API 是动态数据，谁都不许缓存。
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/site', siteRouter);
// 决策#43：未开通站点的业务接口白名单拦截。必须挂在所有 /api/admin/* 路由之前。
//   C 端（/api/site）与登录（/api/auth）不受影响——运营进得去才能把站开通。
app.use('/api/admin', provisionGate);
app.use('/api/link', linkRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/admin/ingot', ingotRouter);
app.use('/api/admin/dashboard', dashboardRouter);
app.use('/api/admin/orders', ordersRouter);
app.use('/api/admin/members', membersRouter);
// ⚠️ 顺序有讲究：provisionRouter 必须**先**挂载。
//   app.use('/api/admin/sites/provision') 是字符串前缀匹配，/sites/provisionXYZ
//   也会命中并被当成 siteId='provisionXYZ'；而 sitesRouter 里有 PATCH/DELETE '/:id'，
//   谁先注册谁先吃。provision 的路径多一层、更具体，先挂它最安全，
//   且下面还有 UUID 守卫兜底（双重保险）。
app.use('/api/admin/sites/provision', provisionRouter); // 屏 52 凭据开通向导
app.use('/api/admin/sites', sitesRouter);
app.use('/api/admin', adminGoodsRouter);
app.use('/api/admin/distribution', distributionRouter);
app.use('/api/admin/ai', aiRouter);
app.use('/api/admin/withdraw', withdrawRouter);
app.use('/api/admin/commission', commissionRouter);
app.use('/api/admin/verify', verifyRouter);
app.use('/api/admin/marketing', marketingRouter);
app.use('/api/admin/schema', schemaRouter);
app.use('/api/admin', uploadRouter); // POST /api/admin/upload
app.use('/api/admin/tabbar', tabbarRouter);
app.use('/api/admin/payment', paymentRouter); // 支付商户：站点级微信支付凭据管理（M9 数据面 site_payment）
app.use('/api/admin/settings', settingsRouter); // 系统设置：供应商凭据矩阵 + 审计概览（改密在 /api/auth/admin/password）
app.use('/api/me', meRouter);
app.use('/api/profile', profileRouter);
app.use('/api/trade', tradeRouter); // 自营交易链：详情/下单/支付/回调 // C 端资料：手机号绑定/地址/昵称头像 // M4 分销 C 端：佣金钱包/提现/邀请
app.use('/api/me/member', memberRouter); // M5 权益会员 C 端：等级/元宝/兑换记录/券包
app.use('/api/me/checkin', checkinRouter); // 聚宝盆签到（决策#31）：status/do
app.use('/api/me', favoriteRouter); // 决策#41 我的收藏 / 浏览足迹（画布 06B / 06C）：/favorites /footprints
app.use('/api/admin/checkin', checkinAdminRouter); // 签到奖励梯度配置（site.checkin_rewards）
app.use('/api/admin/hotwords', hotwordAdminRouter); // 07B 相关搜索热词表（032 search_hotword）
app.use('/api/admin/account', accountAdminRouter); // 决策#37 账户设置：个人资料/我的操作日志/消息中心三源（033 admin_notification）
app.use('/api/rights', rightsRouter); // M5 权益 C 端：fasttype 透传（品牌卡/档位）
app.use('/api/chat', chatRouter); // mini-29 AI 助手（决策 #46/#47）：/boot /sse /history
app.use('/api/media', mediaRouter); // GET /api/media/uploads/* 公开媒体代理
app.use('/api', goodsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`[fyt360-api] listening on :${config.port} (env=${config.tcbEnv})`);
});

// 云托管实例优雅退出
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
