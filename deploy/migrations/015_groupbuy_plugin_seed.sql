-- 015_groupbuy_plugin_seed.sql —— 美团团购插件轨（D先生 2026-09-27 确认）
-- mayi-tg 插件（provider wx8b412290993bf26a）引入 manifest.json（mayi-ordering/mayi-movie 同款）
-- meituan_04 美团到店：半屏壳 plugin-private://wx8b412290993bf26a（009）→ 宿主内嵌插件轨（011 同款语义，显式覆盖）
-- 团购主页 = pages/index/index；参数 apikey={apikey}/uid={uid} 端点动态替换
--   index=/pages/index/index（我们小程序主页）；isswitch/cid/keyword 文档标注「按需」，暂不传
--   店铺详情页路径带 id=店铺ID，动态值不适合静态种子，不录
-- 移动积分（type=card）：D先生 确认已下线 —— 名册本无此行（09-26 盘点「未扩」），零操作，此处存档
UPDATE brand_action_cfg
   SET action_type = 'plugin', enabled = TRUE,
       miniapp_cfg = jsonb_build_object(
         'mode', 'plugin',
         'path', 'plugin://mayi-tg/index?apikey={apikey}&uid={uid}&index=/pages/index/index'
       )
 WHERE brand_code = 'meituan_04'
   AND name = '美团到店';
