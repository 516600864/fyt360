-- 007: 统一三级分佣开关口径（admin-33 不分配配置 与 admin-40 分佣开关 共用 dist_alloc 单一真相源）
-- 旧种子三项（内测体验站/618主会场/话费充值）为 mock 文案，统一为站点级/活动级/品类级三项
UPDATE platform_config
   SET value = '{"items":[{"key":"site_scope","label":"站点级 · 站内分销","on":true},{"key":"activity_seckill","label":"活动级 · 秒杀场次","on":false},{"key":"category_video","label":"品类级 · 影音会员直充","on":false}]}'::jsonb,
       updated_at = now()
 WHERE key = 'dist_alloc'
   AND value = '{"items":[{"key":"site_internal","label":"站点 · 内测体验站","on":true},{"key":"activity_618","label":"活动 · 618 主会场","on":true},{"key":"category_phone","label":"品类 · 话费充值","on":false}]}'::jsonb;
