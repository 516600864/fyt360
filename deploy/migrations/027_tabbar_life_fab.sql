-- =============================================================
-- 027: tabbar 存量配置语义修正（决策#30 毛玻璃 4+1 定稿配套）
-- 变更：Tab 行「订单」→「生活服务」（🧭 双态，target builtin/life）；
--       style/fab 不落强制值——server 侧 normalize 兜底（glass + 一键查券 FAB）
-- 兼容：site.tabbar 两种形态（v1 数组 / v2 {items:[...]}) 都处理
-- 幂等：仅当存在 name='订单' 的项时改写
-- =============================================================

-- v1 数组形态
UPDATE site SET tabbar = (
  SELECT jsonb_agg(
    CASE WHEN elem->>'name' = '订单'
      THEN elem || '{"name":"生活服务","emoji":"🧭","emoji_active":"🧭","target":{"type":"builtin","value":"life"}}'::jsonb
      ELSE elem END
    ORDER BY ord
  )
  FROM jsonb_array_elements(tabbar) WITH ORDINALITY AS t(elem, ord)
) WHERE jsonb_typeof(tabbar) = 'array'
  AND tabbar @? '$[*] ? (@.name == "订单")';

-- v2 对象形态（items 内）
UPDATE site SET tabbar = jsonb_set(tabbar, '{items}', (
  SELECT jsonb_agg(
    CASE WHEN elem->>'name' = '订单'
      THEN elem || '{"name":"生活服务","emoji":"🧭","emoji_active":"🧭","target":{"type":"builtin","value":"life"}}'::jsonb
      ELSE elem END
    ORDER BY ord
  )
  FROM jsonb_array_elements(tabbar->'items') WITH ORDINALITY AS t(elem, ord)
)) WHERE jsonb_typeof(tabbar->'items') = 'array'
  AND tabbar @? '$.items[*] ? (@.name == "订单")';
