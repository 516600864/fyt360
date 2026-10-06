-- =============================================================
-- 014: 半屏壳新增品牌 —— 周边特惠 / 比价寄（D先生 2026-09-27 第三批半扩名册确认）
-- 背景：D先生 下发 9 品牌半屏路径清单，其中 7 个 009 已录入且与清单逐字一致（零改动）：
--   华莱士 dining_06 type=1 / 鲜花配送 life_03 type=2 / 吃喝玩乐 meituan_16(+meituan_27) type=5
--   汉堡王 dining_08 type=7 / 百果园 dining_12 type=8 / 喜茶 dining_07 type=10 / 德克士 dining_10 type=16
-- 本批仅补名册缺行 2 个（09-26 盘点「文档支持但名册缺品牌」清单闭环，同批必胜客已于 010 补入）：
--   周边特惠 type=14 → meituan_37（与吃喝玩乐同族，本地特惠聚合）
--   比价寄   type=15 → life_06（寄快递比价，与 life_02 特惠快递同族）
-- 呼起方式：半屏壳 wx5f482af87ff127ca 自身 H5 页 pages/web/index
-- 占位符协议同 009：{apikey}=provider_config.mayixingqiu（跟站点走）/ {uid}=登录 user_id（匿名 1）
-- 幂等：INSERT WHERE NOT EXISTS，不覆盖已有行
-- =============================================================

INSERT INTO brand_action_cfg (site_scope, category, brand_code, name, action_type, miniapp_cfg, enabled)
SELECT 'all', 'meituan', 'meituan_37', '周边特惠', 'halfscreen',
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/web/index?apikey={apikey}&uid={uid}&type=14"}'::jsonb, TRUE
WHERE NOT EXISTS (SELECT 1 FROM brand_action_cfg WHERE site_scope = 'all' AND category = 'meituan' AND brand_code = 'meituan_37');

INSERT INTO brand_action_cfg (site_scope, category, brand_code, name, action_type, miniapp_cfg, enabled)
SELECT 'all', 'life', 'life_06', '比价寄', 'halfscreen',
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/web/index?apikey={apikey}&uid={uid}&type=15"}'::jsonb, TRUE
WHERE NOT EXISTS (SELECT 1 FROM brand_action_cfg WHERE site_scope = 'all' AND category = 'life' AND brand_code = 'life_06');
