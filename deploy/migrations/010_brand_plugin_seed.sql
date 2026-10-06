-- 010_brand_plugin_seed.sql —— 点餐插件轨确认数据（D先生 2026-09-27 逐条确认）
-- 接入方式：宿主 app.json（manifest.json mp-weixin.plugins）引入 mayi-ordering（provider wx869ff9f322c1d2f0）
--          + mayi-delivery（provider wx5f482af87ff127ca，wm=1 外卖功能跳转所需）
-- 端上打开：navigateTo(plugin://mayi-ordering/welcome|all?...)，不再走半屏壳
-- 占位符：{apikey}=mayixingqiu key（跟站点走）、{uid}=登录 user_id（匿名 1）——brand-launch 端点动态替换
-- 幂等：UPDATE 无条件覆盖（本批为确认数据，优先于 009 半屏初始化）；INSERT WHERE NOT EXISTS 防重
-- wm=1 显示外卖功能（D先生 已确认引入外卖插件）；如需隐藏改 wm=（空）即可

-- ① 7 个平台页品牌：kfc/mdl/nx/xbk/bsk/kd/rx/tst → plugin://mayi-ordering/welcome?type=X
UPDATE brand_action_cfg SET action_type = 'plugin', enabled = TRUE,
  miniapp_cfg = jsonb_build_object('mode', 'plugin', 'path', 'plugin://mayi-ordering/welcome?type=' || t.ptype || '&apikey={apikey}&uid={uid}&index=/pages/index/index&wm=1')
FROM (VALUES
  ('dining_04', 'kfc'),  -- 肯德基
  ('dining_01', 'mdl'),  -- 麦当劳
  ('dining_03', 'nx'),   -- 奈雪的茶
  ('dining_02', 'xbk'),  -- 星巴克
  ('dining_09', 'kd'),   -- 库迪咖啡
  ('dining_05', 'rx'),   -- 瑞幸
  ('dining_11', 'tst')   -- 塔斯汀（文档新增支持，原空壳填入）
) AS t(brand_code, ptype)
WHERE brand_action_cfg.brand_code = t.brand_code;

-- ② 聚合点餐（六大平台聚合页）
UPDATE brand_action_cfg SET action_type = 'plugin', enabled = TRUE,
  miniapp_cfg = jsonb_build_object('mode', 'plugin', 'path', 'plugin://mayi-ordering/all?apikey={apikey}&uid={uid}&index=/pages/index/index&wm=1')
WHERE brand_code = 'dining_13';

-- ③ 必胜客（名册原无此行，文档支持 bsk）——补名册 + 配置
INSERT INTO brand_action_cfg (site_scope, category, brand_code, name, action_type, miniapp_cfg, enabled)
SELECT 'all', 'dining', 'dining_14', '必胜客', 'plugin',
  jsonb_build_object('mode', 'plugin', 'path', 'plugin://mayi-ordering/welcome?type=bsk&apikey={apikey}&uid={uid}&index=/pages/index/index&wm=1'), TRUE
WHERE NOT EXISTS (SELECT 1 FROM brand_action_cfg WHERE site_scope = 'all' AND category = 'dining' AND brand_code = 'dining_14');
