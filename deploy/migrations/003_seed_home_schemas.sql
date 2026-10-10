-- 003_seed_home_schemas.sql：site-a 首页 Schema 种子（决策#26：H5 复用小程序首页同稿）
-- 合同 = packages/renderer/schema/page-v1.schema.json；内容源 = packages/renderer/schema/default-home.json
-- 幂等：site+page 已有 published 版本时不重复插入（后续版本由 DIY/AI 编辑器递增 version）

WITH doc(doc) AS (
  VALUES ('{"version":1,"page":"home","floors":[{"type":"search-bar","floor_id":"f-search","component_id":"c-search","props":{"logo_text":"券","placeholder":"搜索券 · 请输入商品名称","action_text":"签到有礼","action":{"type":"jump","target":"page","value":"/pages/rights/index"}}},{"type":"swiper","floor_id":"f-banner","component_id":"c-banner","props":{"autoplay":true,"interval":4000,"items":[{"title":"大牌点燃","emphasize":"5折起","tags":["差旅必备","爆款特惠"],"tail":"天天开抢","emoji":"🍔☕🍿🍩","bg":"linear-gradient(100deg, #e8336d 0%, #ff5d43 55%, #ffaa1d 100%)"},{"title":"吃喝玩乐购","emphasize":"一站全变现","tags":["自购省钱","分享赚钱"],"tail":"元宝当钱花","emoji":"🧡💰🎁","bg":"linear-gradient(100deg, #a31245 0%, #e8336d 60%, #ffaa1d 100%)"}]}},{"type":"nav","floor_id":"f-nav","component_id":"c-nav","props":{"columns":5,"items":[{"label":"大牌点餐","icon":"🍔","action":{"type":"plugin-launch","value":"mcdonalds"}},{"label":"咖啡茶饮","icon":"☕","action":{"type":"plugin-launch","value":"luckin"}},{"label":"折扣电影","icon":"🎬","action":{"type":"plugin-launch","value":"movie"}},{"label":"外卖红包","icon":"🧧","action":{"type":"plugin-launch","value":"ele"}},{"label":"打车出行","icon":"🚕","action":{"type":"plugin-launch","value":"travel"}},{"label":"旅游住宿","icon":"🏨","action":{"type":"plugin-launch","value":"hotel"}},{"label":"会员充值","icon":"⚡","action":{"type":"plugin-launch","value":"recharge"}},{"label":"特惠快递","icon":"📦","action":{"type":"plugin-launch","value":"express"}},{"label":"鲜花配送","icon":"💐","action":{"type":"plugin-launch","value":"flower"}},{"label":"领券中心","icon":"券","hot":true,"action":{"type":"jump","target":"page","value":"/pages/rights/index"}}]}},{"type":"coupon-strip","floor_id":"f-coupon","component_id":"c-coupon","props":{"amount":"¥20","note_top":"满可用","note_bottom":"全平台通用","action_text":"立即领取","action":{"type":"popup","value":"coupon_wall"}}},{"type":"brand-chips","floor_id":"f-brands","component_id":"c-brands","props":{"title":"品牌补贴日","badge":"低至5折","chips":["麦当劳","肯德基","星巴克","瑞幸","必胜客","塔斯汀","奈雪的茶","库迪咖啡"]}},{"type":"goods-feed","floor_id":"f-feed","component_id":"c-feed","data_source":{"mode":"platform_tab","params":{"tabs":["jd","tb","pdd","vip","self"]}},"props":{"title":"精选好物","more_text":"更多 >","page_size":10}}]}'::jsonb)
),
s AS (
  SELECT site_id FROM site WHERE code = 'site-a' LIMIT 1
),
ins AS (
  INSERT INTO page_schema (site_id, page, schema_json, version, status, source)
  SELECT s.site_id, x.page, doc.doc, 1, 'published', 'manual'
  FROM s CROSS JOIN doc
  CROSS JOIN (VALUES ('home'), ('home_h5')) AS x(page)
  WHERE NOT EXISTS (
    SELECT 1 FROM page_schema ps
     WHERE ps.site_id = s.site_id AND ps.page = x.page AND ps.status = 'published'
  )
  RETURNING 1
)
SELECT count(*) AS inserted FROM ins;
