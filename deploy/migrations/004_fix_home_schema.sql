-- 004_fix_home_schema.sql：修复 site-a 线上空壳 home schema（2026-09-23 真机 UI 崩主因）
-- 背景：003 为 WHERE NOT EXISTS 幂等种子，线上已存在骨架版 published home（swiper/nav items 全空、缺券条/品牌楼层）→ seed 永远未生效。
-- 本迁移显式把 published home 覆盖为完整 6 层（内容源 = packages/renderer/schema/default-home.json，与画布 mini-01 对齐）；h5_home 已是完整版不动。
-- 幂等：可重复执行（UPDATE 覆盖，version 自增）。

WITH doc(doc) AS (
  VALUES ('{ "version": 1, "page": "home", "floors": [ { "type": "search-bar", "floor_id": "f-search", "component_id": "c-search", "props": { "logo_text": "券", "placeholder": "搜索券 · 京东 / 淘宝 / 拼多多", "action_text": "签到有礼", "action": { "type": "jump", "target": "page", "value": "/pages/rights/index" } } }, { "type": "swiper", "floor_id": "f-banner", "component_id": "c-banner", "props": { "autoplay": true, "interval": 4000, "items": [ { "title": "大牌点燃", "emphasize": "5折起", "tags": ["差旅必备", "爆款特惠"], "tail": "天天开抢", "emoji": "🍔☕🍿🍩", "bg": "linear-gradient(100deg, #e8336d 0%, #ff5d43 55%, #ffaa1d 100%)" }, { "title": "吃喝玩乐购", "emphasize": "一站全变现", "tags": ["自购省钱", "分享赚钱"], "tail": "元宝当钱花", "emoji": "🧡💰🎁", "bg": "linear-gradient(100deg, #a31245 0%, #e8336d 60%, #ffaa1d 100%)" } ] } }, { "type": "nav", "floor_id": "f-nav", "component_id": "c-nav", "props": { "columns": 5, "items": [ { "label": "大牌点餐", "icon": "🍔", "action": { "type": "plugin-launch", "value": "mcdonalds" } }, { "label": "咖啡茶饮", "icon": "☕", "action": { "type": "plugin-launch", "value": "luckin" } }, { "label": "折扣电影", "icon": "🎬", "action": { "type": "plugin-launch", "value": "movie" } }, { "label": "外卖红包", "icon": "🧧", "action": { "type": "plugin-launch", "value": "ele" } }, { "label": "打车出行", "icon": "🚕", "action": { "type": "plugin-launch", "value": "travel" } }, { "label": "旅游住宿", "icon": "🏨", "action": { "type": "plugin-launch", "value": "hotel" } }, { "label": "会员充值", "icon": "⚡", "action": { "type": "plugin-launch", "value": "recharge" } }, { "label": "特惠快递", "icon": "📦", "action": { "type": "plugin-launch", "value": "express" } }, { "label": "鲜花配送", "icon": "💐", "action": { "type": "plugin-launch", "value": "flower" } }, { "label": "领券中心", "icon": "券", "hot": true, "action": { "type": "jump", "target": "page", "value": "/pages/rights/index" } } ] } }, { "type": "coupon-strip", "floor_id": "f-coupon", "component_id": "c-coupon", "props": { "amount": "¥20", "note_top": "满可用", "note_bottom": "全平台通用", "action_text": "立即领取", "action": { "type": "popup", "value": "coupon_wall" } } }, { "type": "brand-chips", "floor_id": "f-brands", "component_id": "c-brands", "props": { "title": "品牌补贴日", "badge": "低至5折", "chips": ["麦当劳", "肯德基", "星巴克", "瑞幸", "必胜客", "塔斯汀", "奈雪的茶", "库迪咖啡"] } }, { "type": "goods-feed", "floor_id": "f-feed", "component_id": "c-feed", "data_source": { "mode": "platform_tab", "params": { "tabs": ["jd", "tb", "pdd", "vip", "self"] } }, "props": { "title": "精选好物", "more_text": "更多 >", "page_size": 10 } } ] }')
),
s AS (
  SELECT site_id FROM site WHERE code = 'site-a' LIMIT 1
),
upd AS (
  UPDATE page_schema ps
     SET schema_json = doc.doc::jsonb, version = ps.version + 1
    FROM s CROSS JOIN doc
   WHERE ps.site_id = s.site_id AND ps.page = 'home' AND ps.status = 'published'
  RETURNING 1
)
SELECT count(*) AS updated FROM upd;

-- 顺带修复 site.theme 键名（camelCase → kebab-case 全名，否则 SchemaPage 内联覆盖全部无效）
UPDATE site
   SET theme = '{"primary":"#E8336D","secondary":"#FFAA1D","surface":"#FFF6E9","primary-dark":"#A31245","border-thick":"3px","radius-lg":"20px"}'::jsonb
 WHERE code = 'site-a';
