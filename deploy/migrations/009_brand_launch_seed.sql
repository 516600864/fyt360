-- =============================================================
-- 009: 品牌呼起初始化数据（蚂蚁星球半屏小程序路径）
-- 来源：好京客开放平台插件文档
--   id=192 点餐、影票、团购优惠（https://www.haojingke.com/open/doc.html?id=192）
--   id=199 点餐、充值、影票插件（https://www.haojingke.com/open/doc.html?id=199）
-- 呼起方式：wx.openEmbeddedMiniProgram(appId=半屏壳 wx5f482af87ff127ca, path=完整插件/页面路径)
-- 占位符协议（端点 /api/site/brand-launch 动态替换）：
--   {apikey} = provider_config.mayixingqiu.apikey（跟站点走）
--   {uid}    = 登录用户 user_id（匿名 = 1）
-- 铁律：只录文档实锤路径；文档未提供的品牌保持空壳 {}（端点 404 诚实，不造假映射）
-- 幂等：仅当 miniapp_cfg 为空壳 {} 时写入，不覆盖运营手工配置
-- =============================================================

-- ---------- dining 点餐（插件：wx869ff9f322c1d2f0，type 参数 7 平台 + H5 web 页） ----------
UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"plugin-private://wx869ff9f322c1d2f0/pages/welcome/index?type=mdl&apikey={apikey}&uid={uid}&index=/pages/index/index"}'::jsonb
WHERE brand_code = 'dining_01' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 麦当劳 mdl

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"plugin-private://wx869ff9f322c1d2f0/pages/welcome/index?type=xbk&apikey={apikey}&uid={uid}&index=/pages/index/index"}'::jsonb
WHERE brand_code = 'dining_02' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 星巴克 xbk

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"plugin-private://wx869ff9f322c1d2f0/pages/welcome/index?type=nx&apikey={apikey}&uid={uid}&index=/pages/index/index"}'::jsonb
WHERE brand_code = 'dining_03' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 奈雪的茶 nx

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"plugin-private://wx869ff9f322c1d2f0/pages/welcome/index?type=kfc&apikey={apikey}&uid={uid}&index=/pages/index/index"}'::jsonb
WHERE brand_code = 'dining_04' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 肯德基 kfc

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"plugin-private://wx869ff9f322c1d2f0/pages/welcome/index?type=rx&apikey={apikey}&uid={uid}&index=/pages/index/index"}'::jsonb
WHERE brand_code = 'dining_05' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 瑞幸 rx

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"plugin-private://wx869ff9f322c1d2f0/pages/welcome/index?type=kd&apikey={apikey}&uid={uid}&index=/pages/index/index"}'::jsonb
WHERE brand_code = 'dining_09' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 库迪咖啡 kd

-- 点餐平台 H5 页（半屏壳自身页面 pages/web/index，type 枚举见文档第 8 节）
UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/web/index?apikey={apikey}&uid={uid}&type=1"}'::jsonb
WHERE brand_code = 'dining_06' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 华莱士 H5 type=1

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/web/index?apikey={apikey}&uid={uid}&type=10"}'::jsonb
WHERE brand_code = 'dining_07' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 喜茶 H5 type=10

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/web/index?apikey={apikey}&uid={uid}&type=7"}'::jsonb
WHERE brand_code = 'dining_08' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 汉堡王 H5 type=7

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/web/index?apikey={apikey}&uid={uid}&type=16"}'::jsonb
WHERE brand_code = 'dining_10' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 德克士 H5 type=16

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/web/index?apikey={apikey}&uid={uid}&type=8"}'::jsonb
WHERE brand_code = 'dining_12' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 百果园 H5 type=8

-- 点餐聚合（六平台聚合页，old=1 时只显示插件内六大平台）
UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"plugin-private://wx869ff9f322c1d2f0/pages/all/index?apikey={apikey}&uid={uid}&index=/pages/index/index"}'::jsonb
WHERE brand_code = 'dining_13' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 聚合点餐

-- ---------- life 生活服务 ----------
UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"plugin-private://wx459759608c80cf98/pages/index?movieuid={uid}&movieapikey={apikey}&homepath=/pages/home/home&index=/pages/home/home"}'::jsonb
WHERE brand_code = 'life_01' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 折扣电影票（影票插件 wx459759608c80cf98）

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/web/index?apikey={apikey}&uid={uid}&type=2"}'::jsonb
WHERE brand_code = 'life_03' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 鲜花配送 H5 type=2（鲜花快递）

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"plugin-private://wx92eb6fb9f1218f37/pages/recharge/index?apikey={apikey}&uid={uid}"}'::jsonb
WHERE brand_code = 'life_04' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 会员卡券（充值/点餐聚合页）

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/vipredeem/webview/index?apikey={apikey}&uid={uid}&env=miniprogram&view=home"}'::jsonb
WHERE brand_code = 'life_05' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 生活权益（积分兑换=会员权益列表）

-- ---------- meituan 美团 ----------
UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"plugin-private://wx8b412290993bf26a/pages/index/index?apikey={apikey}&uid={uid}&index=/pages/index/index"}'::jsonb
WHERE brand_code = 'meituan_04' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 美团到店（插件 wx8b412290993bf26a）

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/web/index?apikey={apikey}&uid={uid}&type=5"}'::jsonb
WHERE brand_code = 'meituan_16' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 吃喝玩乐 H5 type=5（吃喝玩乐聚合）

UPDATE brand_action_cfg SET action_type = 'halfscreen', miniapp_cfg =
  '{"appid":"wx5f482af87ff127ca","mode":"halfscreen","path":"pages/web/index?apikey={apikey}&uid={uid}&type=5"}'::jsonb
WHERE brand_code = 'meituan_27' AND site_scope = 'all' AND miniapp_cfg = '{}'::jsonb; -- 美团吃喝玩乐 H5 type=5
