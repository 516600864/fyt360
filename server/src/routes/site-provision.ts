/**
 * 站点凭据开通（屏 52，决策 #43，D先生 2026-10-05）。
 *
 * 核心口径：**平台只建壳，绝碰凭据。**
 * 站点凭据是钱袋子（蚂蚁星球 key 能提现、微信支付私钥能扣款），必须由客户自己
 * 登录本站配置。平台管理员代填 = 跨站聚合态改别人钱袋子，绕过决策 #27；
 * 且 admin_audit_log.site_id 在跨站场景下无法归因。
 *
 * 五组凭据真相源**互不相同**（这是本文件存在的理由，屏 52 文案逐项写明）：
 *
 *   | 凭据              | 落点                          | 必填 | 连通性测试 |
 *   |-------------------|-------------------------------|------|-----------|
 *   | 蚂蚁星球 ⭐        | provider_config(mayixingqiu)  | 是   | ✅ 唯一测这组 |
 *   | 小程序             | provider_config(wechat_mini)  | 否   | ❌ 配错表现为登录静默失败 |
 *   | 微信公众号         | provider_config(wechat_mp)    | 否   | ❌ 配错表现为 OAuth code 换不回 openid |
 *   | 微信支付           | site_payment（独立表）        | 否   | ❌ 须真下单才能验 |
 *   | 企微客服           | site.kf_corp_id/kf_url/kf_status | 否 | ❌ 须人工在 MP 后台绑企业 ID |
 *
 * ⚠️ 小程序/公众号凭据都在 provider_config，**不在 site.appid/mini_secret**——
 * 后者只是屏 31 展示「小程序数」用的字段，与登录链路无关（迁移 005 只手工回填了 site-a）。
 *
 * 「已开通」判定 = provider_config 有 mayixingqiu 且 status='active' 且 test_status='passed'
 * （⛔ 光有 key 不算开通，配置对了但拉不动上游一样是死的；⛔ 停用中的凭据也不算）。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { requireAdmin, assertSiteAccess, type AdminJwtPayload } from '../middleware/auth.js';
import { writeAudit } from '../lib/audit.js';
import { fetchFasttype } from '../lib/haojingke.js';
import { invalidateProviderCache } from '../lib/provider.js';
import { invalidateProvisionCache } from '../middleware/provision-gate.js';

export const provisionRouter = Router();

/**
 * ⛔ 凭据是钱袋子：只有该站负责人（admin_user_site.is_owner）能配。
 *
 * 决策 #43 原文：「平台只建壳、绝不碰凭据」「负责人是该站凭据的唯一配置人」。
 * 故本校验**不放过 platform_admin** —— 超管若非该站 is_owner 同样 403：
 * 跨站代填 = 平台改客户钱袋子，绕过决策 #27 且 admin_audit_log.site_id 无法归因。
 *
 * ⚠️ 2026-10-05 修的实现缺陷：原实现只调 assertSiteAccess（有该站访问权即可），
 * 导致**任何被授权的普通成员（含只读运营）都能改这家站的蚂蚁 key / 支付私钥 / 企微凭据**。
 * assertSiteAccess 只回答"能不能看"，本函数回答"能不能改钱袋子"，两者语义必须分开。
 */
async function requireOwner(req: Request, siteId: string): Promise<AdminJwtPayload> {
  // UUID 守卫：app.use('/api/admin/sites/provision') 是前缀匹配，
  // /provisionXYZ 这类脏路径会被 Express 塞进来，直接透传给 SQL 会报 22P02。
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(siteId)) {
    throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
  }
  const admin = req.admin!;
  // 先查有没有访问权（区分「无权限」与「有权限但非负责人」两种拒绝，避免泄露站点存在性）
  assertSiteAccess(admin, siteId);
  const { rows: own } = await pool.query(
    `SELECT 1 FROM admin_user_site WHERE admin_id = $1::bigint AND site_id = $2::uuid AND is_owner LIMIT 1`,
    [admin.adminId, siteId],
  );
  if (!own[0]) {
    throw new HttpError(403, '只有该站负责人能配置凭据，请联系站点负责人或平台移交', 'NOT_SITE_OWNER');
  }
  return admin;
}

const maskSecret = (v: string | null | undefined): string => {
  const s = v == null ? '' : String(v);
  if (!s) return '';
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 3)}•••••${s.slice(-3)}`;
};

/** PEM 只回显头尾，绝不回传全文（1700+ 字符的私钥进 JSON 等于往外发） */
const maskPem = (v: string | null | undefined): string => {
  const s = v == null ? '' : String(v);
  if (!s) return '';
  if (s.length < 40) return '已配置';
  return `${s.slice(0, 34)}•••••（${s.length} 字节）`;
};

/**
 * ⛔ 掩码回填契约（2026-10-06，D先生拍板）：GET 回掩码、前端把掩码值回填输入框，
 * 提交时「未修改的字段」发空串 = 沿用原值。服务端在此做双向兜底：
 * 凡含 '•' 的入参（掩码串，真凭据不可能含该字符）一律当空串处理——
 * 防止前端守卫漏改/旧 bundle 把掩码串当真值写库（写坏 = 凭据报废，只能重配）。
 */
const dropMasked = (v: string): string => (v.includes('•') ? '' : v);

async function assertSiteExists(siteId: string): Promise<{ site_id: string; code: string; name: string; status: string }> {
  const { rows } = await pool.query(
    `SELECT site_id::text AS site_id, code, name, status FROM site WHERE site_id = $1::uuid LIMIT 1`,
    [siteId],
  );
  if (!rows[0]) throw new HttpError(404, '站点不存在', 'SITE_NOT_FOUND');
  return rows[0];
}

/** 该站当前是否已开通（唯一判定口径，白名单 middleware 与屏 52 共用此函数） */
export async function isSiteProvisioned(siteId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM provider_config
      WHERE site_id = $1::uuid AND provider = 'mayixingqiu'
        AND status = 'active' AND test_status = 'passed'
      LIMIT 1`,
    [siteId],
  );
  return rows.length > 0;
}

provisionRouter.use(requireAdmin);

// ══════════════════════════════════════════════════════════════
// GET /api/admin/sites/provision/:siteId → 四组凭据状态总览（屏 52 主数据源）
// ══════════════════════════════════════════════════════════════
provisionRouter.get('/:siteId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = String(req.params.siteId);
    await requireOwner(req, siteId);
    const site = await assertSiteExists(siteId);
    // 企微三字段不在 assertSiteExists 的返回里，单独取（掩码回显要用）
    const { rows: kfRows } = await pool.query(
      `SELECT kf_corp_id, kf_url, kf_status FROM site WHERE site_id = $1::uuid`,
      [siteId],
    );
    const kf = kfRows[0] ?? { kf_corp_id: null, kf_url: null, kf_status: 'disabled' };

    const [{ rows: pcRows }, { rows: payRows }] = await Promise.all([
      pool.query(
        `SELECT provider, apikey, api_secret, status, test_status, test_message, tested_at::text AS tested_at, updated_at::text AS updated_at
           FROM provider_config WHERE site_id = $1::uuid AND provider IN ('mayixingqiu','wechat_mini','wechat_mp')
          ORDER BY provider`,
        [siteId],
      ),
      // ⛔ 掩码回填契约：mch_key/serial_no 只出掩码态，原文绝不出 GET（密钥原文进 JSON = 往外发）
      pool.query(
        `SELECT mch_id, serial_no, mch_key, commission_rate::float AS commission_rate, status,
                (cert IS NOT NULL AND cert <> '') AS has_cert,
                left(cert, 34) AS cert_head, length(cert)::int AS cert_len
           FROM site_payment WHERE site_id = $1::uuid`,
        [siteId],
      ),
    ]);

const byProvider = new Map(pcRows.map((r) => [r.provider, r]));
  const ants = byProvider.get('mayixingqiu');
  const mini = byProvider.get('wechat_mini');
  const mp = byProvider.get('wechat_mp');
  const pay = payRows[0];

    const provisioned = Boolean(ants && ants.status === 'active' && ants.test_status === 'passed');

    res.json({
      ok: true,
      data: {
        site: { ...site, provisioned },
        // 屏 52 卡片顺序即此数组顺序
        groups: [
          {
            key: 'mayixingqiu',
            title: '蚂蚁星球开放平台',
            required: true,
            testable: true,
            store_at: 'provider_config（provider=mayixingqiu）',
            note: '本站全部 CPS 供给的唯一来源。能拉到 6 大品类 / 83 个品牌即视为连通。',
            configured: Boolean(ants),
            key_masked: maskSecret(ants?.apikey),
            secret_masked: maskSecret(ants?.api_secret),
            has_secret: Boolean(ants?.api_secret),
            status: ants?.status ?? '',
            test_status: ants?.test_status ?? 'untested',
            test_message: ants?.test_message ?? null,
            tested_at: ants?.tested_at ?? null,
            updated_at: ants?.updated_at ?? null,
          },
          {
            key: 'wechat_mini',
            title: '微信小程序',
            required: false,
            testable: false,
            store_at: 'provider_config（provider=wechat_mini，站点级唯一）',
            note: '不提供连通性测试：配错的表现是 C 端登录静默失败，服务端离线验不出来。填错只能真机点一次登录。',
            configured: Boolean(mini),
            key_masked: maskSecret(mini?.apikey),
            secret_masked: maskSecret(mini?.api_secret),
            has_secret: Boolean(mini?.api_secret),
            status: mini?.status ?? '',
            test_status: 'untested',
            note_extra: '仅自营站需要；纯 CPS 站不接小程序也能开通。',
          },
          {
            key: 'wechat_mp',
            title: '微信公众号',
            required: false,
            testable: false,
            store_at: 'provider_config（provider=wechat_mp，站点级唯一）',
            note: '不提供连通性测试：配错的表现是 OAuth code 换不回 openid（服务端 401），只能真机走一次 H5。',
            note_extra: 'H5 端静默登录（snsapi_base）的硬依赖 —— 未配置时 H5 进系统第一步即中断；纯 CPS + 只走小程序的站点可跳过。',
            configured: Boolean(mp),
            key_masked: maskSecret(mp?.apikey),
            secret_masked: maskSecret(mp?.api_secret),
            has_secret: Boolean(mp?.api_secret),
            status: mp?.status ?? '',
            test_status: 'untested',
          },
          {
            key: 'site_payment',
            title: '微信支付商户',
            required: false,
            testable: false,
            store_at: 'site_payment（独立表，站点级唯一）',
            note: '不提供连通性测试：商户凭据是否正确只有真下单才知道。仅自营团购需要，纯 CPS 站可跳过。',
            configured: Boolean(pay),
            mch_id_masked: maskSecret(pay?.mch_id),
            mch_key_masked: maskSecret(pay?.mch_key),
            serial_no_masked: maskSecret(pay?.serial_no),
            cert_masked: pay?.cert_head ? `${pay.cert_head}•••••（${pay.cert_len} 字节）` : '',
            has_key: Boolean(pay?.mch_key),
            has_cert: Boolean(pay?.has_cert),
            cert_len: pay?.cert_len ?? 0,
            commission_rate: pay?.commission_rate ?? null,
            status: pay?.status ?? '',
            // ⛔ 与 trade.ts 下单时的 notifyUrl 同源同值（PUBLIC_BASE_URL），设计稿要求只读展示，
            //   客户要拿它去微信支付商户平台填「支付回调域名」
            callback_url: `${process.env.PUBLIC_BASE_URL ?? 'https://mk.fyt360.cn'}/api/trade/notify/wxpay`,
          },
          {
            key: 'kf',
            title: '企业微信客服',
            required: false,
            testable: false,
            store_at: 'site.kf_corp_id / kf_url / kf_status',
            note: '不提供连通性测试：企业 ID 还须人工在微信公众平台后台绑定，平台侧无法代劳。',
            configured: Boolean(kf.kf_corp_id || kf.kf_url),
            corp_id: kf.kf_corp_id ?? null,
            kf_url_masked: kf.kf_url ? maskSecret(kf.kf_url) : '',
            status: kf.kf_status ?? 'disabled',
          },
        ],
        // 屏 52 顶部状态条
        provision_state: {
          provisioned,
          blocker: provisioned ? null : '蚂蚁星球凭据未配置或连通测试未通过',
          hint: '未开通时后台仅「凭据开通」可进入，其余功能一律锁死——空站点的看板/订单/商品全是 0，运营会误判成「平台没数据」。',
        },
      },
    });
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════
// PUT /api/admin/sites/provision/:siteId/mayixingqiu → 保存蚂蚁星球凭据（保存后自动测一次）
// ══════════════════════════════════════════════════════════════
provisionRouter.put('/:siteId/mayixingqiu', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = String(req.params.siteId);
    await requireOwner(req, siteId);
    const site = await assertSiteExists(siteId);

    // ⛔ 掩码回填契约：前端把掩码 key 回填输入框，未修改就发空串 → 空串/含•值 = 沿用原 apikey
    const apikey = dropMasked(String(req.body?.apikey ?? '').trim());
    const apiSecret = dropMasked(String(req.body?.api_secret ?? '').trim());

    // 留空表示「沿用原值」（掩码回显态改另一个字段时不能把已存的 key/secret 洗掉）
    const { rows: prev } = await pool.query(
      `SELECT apikey, api_secret FROM provider_config WHERE site_id = $1::uuid AND provider = 'mayixingqiu'`,
      [siteId],
    );
    const finalKey = apikey || prev[0]?.apikey || '';
    if (!finalKey) throw new HttpError(400, 'apikey 必填（唯一必填凭据）', 'APIKEY_REQUIRED');
    const finalSecret = apiSecret || prev[0]?.api_secret || null;

    await pool.query(
      `INSERT INTO provider_config (site_id, provider, apikey, api_secret, status, test_status, test_message, tested_at, updated_at)
       VALUES ($1::uuid, 'mayixingqiu', $2::text, $3::text, 'active', 'untested', NULL, NULL, now())
       ON CONFLICT (site_id, provider) DO UPDATE
         SET apikey = EXCLUDED.apikey, api_secret = EXCLUDED.api_secret,
             status = 'active', test_status = 'untested', test_message = NULL, tested_at = NULL,
             updated_at = now()`,
      [siteId, finalKey, finalSecret],
    );
    const tested = await runAntsTest(siteId, finalKey);
    // ⛔ 两处缓存都要清：provider 凭据缓存（不清新 key 60s 内不生效）+ 白名单开通缓存
    //   （不清的话运营填完点保存，侧栏仍是锁死的，要等 10s TTL 才自动解锁）
    invalidateProviderCache(site.code);
    invalidateProvisionCache(site.code);

    // ⛔ 2026-10-05 修复「保存测试通过但站点未开通」：pending 站点原来**没有任何地方**翻 active，
    //   而 C 端 site.ts 按 status='active' 门控 → 客户测通了站点对外仍是不可访问（D先生实走流程打回）。
    //   开通语义 = 蚂蚁凭据连通通过 → 站点自动启用。disabled 站不自动翻（运营明确停用的，恢复走 PATCH）。
    let siteActivated = false;
    if (tested.status === 'passed' && site.status === 'pending') {
      await pool.query(
        `UPDATE site SET status = 'active', updated_at = now() WHERE site_id = $1::uuid AND status = 'pending'`,
        [siteId],
      );
      siteActivated = true;
    }

    await writeAudit(req, {
      site_id: siteId,
      action: 'provision.mayixingqiu_save',
      target_type: 'provision',
      target_id: site.code,
      detail: { apikey_masked: maskSecret(finalKey), secret_changed: Boolean(apiSecret), test_status: tested.status, site_activated: siteActivated },
    });

    res.json({ ok: true, data: { saved: true, test: tested, provisioned: await isSiteProvisioned(siteId), site_activated: siteActivated } });
  } catch (e) { next(e); }
});

/**
 * 连通性测试：真调上游拉 fasttype 权益目录。
 * ⛔ 这是四组凭据里**唯一**做真实测试的 —— 判据是「拿到非空目录」，
 *   而不是「HTTP 200」（上游对错误 key 也可能返 200 + 空 data）。
 */
async function runAntsTest(siteId: string, apikey: string): Promise<{ status: string; message: string; items: number }> {
  let status = 'failed';
  let message = '';
  let items = 0;
  try {
    const r = await fetchFasttype(apikey, '1', true); // force=true：测试必须打上游，不能吃缓存
    if (r.ok && r.data.length > 0) {
      status = 'passed';
      items = r.data.length;
      message = `连通正常，权益目录 ${items} 项`;
    } else {
      status = 'failed';
      message = r.message || '上游返回空目录（key 可能无效，或该账号无权益目录权限）';
    }
  } catch (e) {
    status = 'failed';
    message = `上游请求异常：${String((e as Error).message ?? e).slice(0, 180)}`;
  }
  await pool.query(
    `UPDATE provider_config SET test_status = $2::text, test_message = $3::text, tested_at = now(), updated_at = now()
      WHERE site_id = $1::uuid AND provider = 'mayixingqiu'`,
    [siteId, status, message],
  );
  return { status, message, items };
}

/** POST /api/admin/sites/provision/:siteId/mayixingqiu/test → 单独重测（换网络/上游抖动后复测） */
provisionRouter.post('/:siteId/mayixingqiu/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = String(req.params.siteId);
    await requireOwner(req, siteId);
    const site = await assertSiteExists(siteId);
    const { rows } = await pool.query(
      `SELECT apikey FROM provider_config WHERE site_id = $1::uuid AND provider = 'mayixingqiu' AND status = 'active'`,
      [siteId],
    );
    if (!rows[0]) throw new HttpError(400, '尚未配置蚂蚁星球凭据', 'APIKEY_REQUIRED');

    const tested = await runAntsTest(siteId, rows[0].apikey);
    await writeAudit(req, {
      site_id: siteId, action: 'provision.mayixingqiu_test',
      target_type: 'provision', target_id: site.code,
      detail: { test_status: tested.status, items: tested.items },
    });
    res.json({ ok: true, data: { test: tested, provisioned: await isSiteProvisioned(siteId) } });
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════
// PUT /api/admin/sites/provision/:siteId/mini → 小程序 appid/secret
// ══════════════════════════════════════════════════════════════
// ⛔ 决策 #44：真相源是 provider_config(provider='wechat_mini')（跟 site_id 走）。
//    site.appid / site.mini_secret 只是屏 31 展示「小程序数」的展示字段，与登录链路无关；
//    这里两处**同写**只为兼容系统设置屏（它还在读 site.appid），别把 site.appid 当真相源。
provisionRouter.put('/:siteId/mini', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = String(req.params.siteId);
    await requireOwner(req, siteId);
    const site = await assertSiteExists(siteId);

    // ⛔ 掩码回填契约：appid/secret 空串（或掩码串）= 沿用原值，只允许改其一
    const appid = dropMasked(String(req.body?.appid ?? '').trim());
    const miniSecret = dropMasked(String(req.body?.mini_secret ?? '').trim());
    if (appid && !/^wx[0-9a-zA-Z]{16}$/.test(appid)) {
      throw new HttpError(400, 'appid 形如 wx 开头 + 16 位（微信公众平台 → 开发管理 → 开发设置）', 'BAD_APPID');
    }
    const { rows: prev } = await pool.query(`SELECT appid, mini_secret FROM site WHERE site_id = $1::uuid`, [siteId]);
    const finalAppid = appid || prev[0]?.appid || '';
    if (!finalAppid) throw new HttpError(400, 'appid 必填', 'APPID_REQUIRED');
    const finalSecret = miniSecret || prev[0]?.mini_secret || null;

    await pool.query(`UPDATE site SET appid = $2::text, mini_secret = $3::text, updated_at = now() WHERE site_id = $1::uuid`, [siteId, finalAppid, finalSecret]);
    await pool.query(
      `INSERT INTO provider_config (site_id, provider, apikey, api_secret, status, updated_at)
       VALUES ($1::uuid, 'wechat_mini', $2::text, $3::text, 'active', now())
       ON CONFLICT (site_id, provider) DO UPDATE
         SET apikey = EXCLUDED.apikey, api_secret = EXCLUDED.api_secret, status = 'active', updated_at = now()`,
      [siteId, finalAppid, finalSecret],
    );

    await writeAudit(req, {
      site_id: siteId, action: 'provision.mini_save',
      target_type: 'provision', target_id: site.code,
      detail: { appid_masked: maskSecret(finalAppid), secret_changed: Boolean(miniSecret) },
    });
    res.json({ ok: true, data: { saved: true, appid_masked: maskSecret(finalAppid), has_secret: Boolean(finalSecret) } });
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════
// PUT /api/admin/sites/provision/:siteId/mp → 微信公众号 appid/secret
// ══════════════════════════════════════════════════════════════
// 真相源 provider_config(provider='wechat_mp')：auth.ts 的 H5 静默登录（snsapi_base OAuth）
// 经 resolveProvider 读 apikey=appid / api_secret=secret。缺这组 = H5 端 100% 登不进
// （但按决策 #44 不影响「站点已开通」判定，白名单只认蚂蚁）。
provisionRouter.put('/:siteId/mp', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = String(req.params.siteId);
    await requireOwner(req, siteId);
    const site = await assertSiteExists(siteId);

    // ⛔ 掩码回填契约：appid/secret 空串（或掩码串）= 沿用原值
    const appid = dropMasked(String(req.body?.appid ?? '').trim());
    const secret = dropMasked(String(req.body?.api_secret ?? '').trim());
    // 公众号与小程序 appid 同形：wx 开头 + 16 位（仅校验新填的值，沿用原值不重复校验）
    if (appid && !/^wx[0-9a-zA-Z]{16}$/.test(appid)) {
      throw new HttpError(400, 'appid 形如 wx 开头 + 16 位（微信公众平台 → 设置与开发 → 基本配置）', 'BAD_APPID');
    }
    const { rows: prev } = await pool.query(
      `SELECT apikey, api_secret FROM provider_config WHERE site_id = $1::uuid AND provider = 'wechat_mp'`,
      [siteId],
    );
    const finalAppid = appid || prev[0]?.apikey || '';
    if (!finalAppid) throw new HttpError(400, 'appid 必填', 'APPID_REQUIRED');
    const finalSecret = secret || prev[0]?.api_secret || null;
    // ⛔ 首次配置必须 secret 齐全：H5 OAuth 两参缺一不可，留半套等于没配还自以为配了
    if (!finalSecret) throw new HttpError(400, 'app_secret 必填（微信公众平台 → 基本配置 → 开发者密码）', 'SECRET_REQUIRED');

    await pool.query(
      `INSERT INTO provider_config (site_id, provider, apikey, api_secret, status, updated_at)
       VALUES ($1::uuid, 'wechat_mp', $2::text, $3::text, 'active', now())
       ON CONFLICT (site_id, provider) DO UPDATE
         SET apikey = EXCLUDED.apikey, api_secret = EXCLUDED.api_secret, status = 'active', updated_at = now()`,
      [siteId, finalAppid, finalSecret],
    );
    invalidateProviderCache(site.code);

    await writeAudit(req, {
      site_id: siteId, action: 'provision.mp_save',
      target_type: 'provision', target_id: site.code,
      detail: { appid_masked: maskSecret(finalAppid), secret_changed: Boolean(secret) },
    });
    res.json({ ok: true, data: { saved: true, appid_masked: maskSecret(finalAppid), has_secret: Boolean(finalSecret) } });
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════
// PUT /api/admin/sites/provision/:siteId/payment → 微信支付商户（真相源 site_payment）
// ══════════════════════════════════════════════════════════════
// ⚠️ 屏 52 与「支付商户」菜单**同写这张表**，是同一真相源的两个入口，不存在重复。
//   区别只在定位：这里是「开通清单里的一项」，支付菜单是「日常改费率/换证书」。
// ⛔ cert 必须与 serial_no 配对（微信支付官方坑：证书序列号与私钥不对账会 400）。
const MERCHANT_ID_RE = /^\d{6,32}$/;
const SERIAL_RE = /^[0-9A-Fa-f]{8,64}$/;

provisionRouter.put('/:siteId/payment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = String(req.params.siteId);
    await requireOwner(req, siteId);
    const site = await assertSiteExists(siteId);

    const b = (req.body ?? {}) as Record<string, unknown>;
    // ⛔ 掩码回填契约：mch_id/mch_key/serial_no/cert 空串（或掩码串）= 沿用原值
    const mchId = dropMasked(String(b.mch_id ?? '').trim());
    const mchKey = dropMasked(String(b.mch_key ?? '').trim());
    const serialNo = dropMasked(String(b.serial_no ?? '').trim());
    const certPem = dropMasked(String(b.cert ?? '').trim());
    const rate = b.commission_rate !== undefined ? Number(b.commission_rate) : undefined;
    const wantActive = b.status === 'active';

    const { rows: prev } = await pool.query(
      `SELECT mch_id, mch_key, serial_no, cert, commission_rate::float AS commission_rate FROM site_payment WHERE site_id = $1::uuid`,
      [siteId],
    );
    const finalMchId = mchId || prev[0]?.mch_id || '';
    const finalKey = mchKey || prev[0]?.mch_key || '';
    const finalSerial = serialNo || prev[0]?.serial_no || '';
    const finalCert = certPem || prev[0]?.cert || '';
    if (!MERCHANT_ID_RE.test(finalMchId)) throw new HttpError(400, '商户号形如 6~32 位数字（微信支付商户平台 → 账户中心）', 'BAD_MCH_ID');
    if (finalKey && finalKey.length !== 32) throw new HttpError(400, 'APIv3 密钥固定 32 位', 'BAD_MCH_KEY');
    if (!SERIAL_RE.test(finalSerial)) throw new HttpError(400, '商户证书序列号形如一串十六进制（apiclient_cert.pem 中可见）', 'BAD_SERIAL_NO');
    // PEM 形状校验：只校验新填的证书（沿用原值不重复校验）
    if (certPem && !/-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----/.test(certPem)) {
      throw new HttpError(400, '商户私钥应为完整 PEM（apiclient_key.pem 全文，含 BEGIN/END 两行）', 'BAD_CERT');
    }
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 0 || rate > 1)) {
      throw new HttpError(400, '佣金费率须为 0~1 之间的小数（0.2 = 20%）', 'BAD_RATE');
    }
    // ⛔ 缺项时强制 disabled：标成 active 会让下单链路跑到一半才炸，比明确未开通更难排查
    if (!finalKey || !finalCert) {
      throw new HttpError(400, 'APIv3 密钥与商户私钥都是必填（首次配置必须两项齐全）', 'PAYMENT_INCOMPLETE');
    }
    const status = wantActive ? 'active' : 'disabled';

    await pool.query(
      `INSERT INTO site_payment (site_id, mch_id, mch_key, serial_no, cert, commission_rate, status)
       VALUES ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::numeric, $7::text)
       ON CONFLICT (site_id) DO UPDATE
         SET mch_id = EXCLUDED.mch_id, mch_key = EXCLUDED.mch_key, serial_no = EXCLUDED.serial_no,
             cert = EXCLUDED.cert, commission_rate = EXCLUDED.commission_rate, status = EXCLUDED.status`,
      [siteId, finalMchId, finalKey, finalSerial, finalCert, rate ?? prev[0]?.commission_rate ?? 0.2, status],
    );

    await writeAudit(req, {
      site_id: siteId, action: 'provision.payment_save',
      target_type: 'provision', target_id: site.code,
      detail: { mch_id_masked: maskSecret(finalMchId), status, cert_changed: Boolean(certPem), rate: rate ?? null },
    });
    res.json({ ok: true, data: { saved: true, status, mch_id_masked: maskSecret(finalMchId), cert_masked: maskPem(finalCert) } });
  } catch (e) { next(e); }
});

// ══════════════════════════════════════════════════════════════
// PUT /api/admin/sites/provision/:siteId/kf → 企微客服（真相源 site.kf_*）
// ══════════════════════════════════════════════════════════════
// ⛔ 不塞 provider_config（那是上游供给方凭据表，企微是我方自有通道，语义不同类）。
function parseCorpId(v: unknown): string | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim().replace(/\s/g, ''); // ⛔ 空格会让微信报「ID 不一致」（官方已知坑）
  if (!/^ww[0-9a-zA-Z]{10,32}$/.test(s)) throw new HttpError(400, '企业ID 形如 ww 开头的一串字符', 'BAD_KF_CORP_ID');
  return s;
}
function parseKfUrl(v: unknown): string | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  let u: URL;
  try { u = new URL(s); } catch { throw new HttpError(400, '客服链接格式不合法（应为 https://work.weixin.qq.com/kfid/... 完整链接）', 'BAD_KF_URL'); }
  if (u.protocol !== 'https:') throw new HttpError(400, '客服链接必须 https', 'BAD_KF_URL');
  const ok = u.hostname === 'work.weixin.qq.com' || u.hostname.endsWith('.weixin.qq.com');
  if (!ok) throw new HttpError(400, '客服链接仅允许企业微信官方域名', 'BAD_KF_URL');
  return s;
}

provisionRouter.put('/:siteId/kf', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const siteId = String(req.params.siteId);
    await requireOwner(req, siteId);
    const site = await assertSiteExists(siteId);

    const b = (req.body ?? {}) as Record<string, unknown>;
    // ⛔ 掩码回填契约：空串（或掩码串）= 沿用原值，只校验新填的值
    const corpIdRaw = dropMasked(String(b.corp_id ?? '').trim());
    const kfUrlRaw = dropMasked(String(b.kf_url ?? '').trim());
    const { rows: prevKf } = await pool.query(
      `SELECT kf_corp_id, kf_url FROM site WHERE site_id = $1::uuid`,
      [siteId],
    );
    const corpId = corpIdRaw ? parseCorpId(corpIdRaw) : (prevKf[0]?.kf_corp_id ?? null);
    const kfUrl = kfUrlRaw ? parseKfUrl(kfUrlRaw) : (prevKf[0]?.kf_url ?? null);
    let status = b.status === 'active' ? 'active' : 'disabled';
    if (!corpId || !kfUrl) {
      if (status === 'active') throw new HttpError(400, '企业ID 与客服链接都填了才能开通', 'KF_INCOMPLETE');
      status = 'disabled';
    }

    await pool.query(
      `UPDATE site SET kf_corp_id = $2::varchar, kf_url = $3::text, kf_status = $4::varchar, updated_at = now()
        WHERE site_id = $1::uuid`,
      [siteId, corpId, kfUrl, status],
    );
    await writeAudit(req, {
      site_id: siteId, action: 'provision.kf_save',
      target_type: 'provision', target_id: site.code,
      detail: { corp_id_masked: maskSecret(corpId), kf_url_changed: Boolean(kfUrlRaw), status },
    });
    res.json({ ok: true, data: { saved: true, status, corp_id: corpId, kf_url_masked: maskSecret(kfUrl) } });
  } catch (e) { next(e); }
});