/**
 * M5 权益 C 端（画布 05 会员权益 / 11 档位选择）。
 * 挂载于 /api/rights/*，optionalUser（匿名可看，登录态注入站点供应商 key）。
 * 数据面 = 蚂蚁星球 fasttype 实时透传（不落库——CPS 铁律，与 admin redeem/types 同源）。
 * 分组语义：fasttype 每条 = 一个可兑换档位（cid 即呼起弹窗参数）；按 type 分组即画布 05 品牌卡。
 * 兑换动作 = brand-launch(life_05) 半屏呼起 + cid 弹窗参数（f-redeem-entry 同款协议，已真机验证）。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { HttpError } from '../middleware/errors.js';
import { optionalUser } from '../middleware/auth.js';
import { resolveHjkConfig } from '../lib/provider.js';
import { fetchFasttype } from '../lib/haojingke.js';

export const rightsRouter = Router();

rightsRouter.get('/catalog', optionalUser, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 登录态 → 站点 code → 站点级蚂蚁 key（供应商 key 跟 site_id 走，铁律）
    let siteCode: string | undefined;
    if (req.user?.siteId) {
      const { rows } = await pool.query(`SELECT code FROM site WHERE site_id = $1 LIMIT 1`, [req.user.siteId]);
      siteCode = rows[0]?.code;
    }
    const { apikey } = await resolveHjkConfig(siteCode);
    // 全量目录固定 uid=1（D先生 定稿：上游按 uid 缓存，真实 uid 每人打穿缓存拖慢响应；uid 归属仅在呼起时经 brand-launch {uid} 注入）
    // 统一取数：8s 超时 + 5min 进程内缓存 + 并发去重（裸 fetch 曾拖死整条链路，2026-10-03）
    const ft = await fetchFasttype(apikey, '1');
    if (!ft.ok) {
      throw new HttpError(502, `权益列表获取失败：${ft.message ?? '响应异常'}`, 'UPSTREAM_ERROR');
    }
    const j = { data: ft.data };

    // 归一化（与 admin redeem/types 同款：img 规格后缀拆分）
    const items = j.data.map((x) => {
      const [rawImg = '', rawSpec = ''] = String(x.img ?? '').split('|');
      const spec = rawSpec.replace(/!img$/, '').trim();
      const name = String(x.cname ?? x.couponName ?? '');
      return {
        cid: Number(x.id),
        name: name + (spec ? ` ${spec}` : ''),
        brand: name, // 不含规格的品牌名（分组内去重展示用）
        type: String(x.type ?? '') || '其他',
        type_code: String(x.typeCode ?? ''),
        img: rawImg.replace(/!img$/, ''),
        min_points: Number(x.min_points ?? 0),
        max_points: Number(x.max_points ?? 0),
        max_save: Number(x.max_save ?? 0),
      };
    });

    // 按 type 分组 → 画布 05 品牌卡（N 档可选 / 积分起 / 最高省）+ 11 档位明细
    const groupMap = new Map<string, typeof items>();
    for (const it of items) {
      const arr = groupMap.get(it.type) ?? [];
      arr.push(it);
      groupMap.set(it.type, arr);
    }
    const groups = [...groupMap.entries()].map(([type, list]) => ({
      key: list[0].type_code || type,
      name: type,
      count: list.length,
      min_points: Math.min(...list.map((i) => i.min_points).filter((n) => n > 0)) || 0,
      max_save: Math.max(...list.map((i) => i.max_save)),
      items: list,
    }));

    res.json({ ok: true, data: { groups, total: items.length } });
  } catch (e) {
    next(e);
  }
});

/** GET /api/rights/brands → 生活服务页数据面（D先生 定稿 2026-09-30：10 分类 148 品牌全进本页）
 *  数据源 = brand_action_cfg（落库配置表，非 CPS 透传，不违铁律）；按 brand_category.sort 排序；
 *  点击动作 = /api/site/brand-launch?code=<brand_code> 三轨分流（act 实时转链 / halfscreen 半屏 / plugin 插件，
 *  端上复用 core/action.js plugin-launch 分发）。mode 随 item 下发；不返回 miniapp_cfg（不暴露路径/凭据）。 */
rightsRouter.get('/brands', optionalUser, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.sort, c.code AS cat_code, c.name AS cat_name,
              b.brand_code, b.name, COALESCE(b.miniapp_cfg->>'mode', b.action_type) AS mode
         FROM brand_action_cfg b
         JOIN brand_category c ON c.code = b.category
        WHERE b.enabled = TRUE
        ORDER BY c.sort, b.id`,
    );
    const groupMap = new Map<string, { key: string; name: string; count: number; items: Array<Record<string, unknown>> }>();
    for (const r of rows) {
      let g = groupMap.get(r.cat_code);
      if (!g) {
        g = { key: r.cat_code, name: r.cat_name, count: 0, items: [] };
        groupMap.set(r.cat_code, g);
      }
      g.items.push({ brand_code: r.brand_code, name: r.name, mode: r.mode });
      g.count = g.items.length;
    }
    const groups = [...groupMap.values()];
    res.json({ ok: true, data: { groups, total: rows.length } });
  } catch (e) {
    next(e);
  }
});
