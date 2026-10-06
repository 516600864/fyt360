-- =============================================================
-- 028: tabbar 存量配置顺序换位（mini-01 设计稿 1:1 复刻配套）
-- 变更：位置 2（idx1）与位置 3（idx2）互换——
--       旧序 首页/会员权益/生活服务/我的 → 新序 首页/生活服务/会员权益/我的
-- 判定：仅当 idx1.target=rights 且 idx2.target=life 时互换（幂等，重跑无副作用）
-- 兼容：site.tabbar 两种形态（v1 数组 / v2 {items:[...]}) 都处理
-- 坑：PG 的 AND 不短路，jsonb_array_length(NULL) 会炸——全部用 CASE 包裹保证求值顺序
-- =============================================================

-- v1 数组形态
UPDATE site SET tabbar = jsonb_set(jsonb_set(tabbar, '{1}', tabbar->2), '{2}', tabbar->1)
WHERE CASE
  WHEN jsonb_typeof(tabbar) = 'array' AND jsonb_array_length(tabbar) >= 3
    THEN tabbar->1->'target'->>'value' = 'rights'
     AND tabbar->2->'target'->>'value' = 'life'
  ELSE false END;

-- v2 对象形态（items 内）
UPDATE site SET tabbar = jsonb_set(tabbar, '{items}',
  jsonb_set(jsonb_set(tabbar->'items', '{1}', tabbar->'items'->2), '{2}', tabbar->'items'->1)
) WHERE CASE
  WHEN jsonb_typeof(tabbar) = 'object' AND jsonb_typeof(tabbar->'items') = 'array'
       AND jsonb_array_length(tabbar->'items') >= 3
    THEN tabbar->'items'->1->'target'->>'value' = 'rights'
     AND tabbar->'items'->2->'target'->>'value' = 'life'
  ELSE false END;
