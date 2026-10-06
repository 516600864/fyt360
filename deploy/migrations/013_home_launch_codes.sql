-- 013: 首页金刚区/品牌补贴 chips 的呼起 code 对齐名册（2026-09-27）
-- 根因：nav 的 action.value 用了语义短码（mcdonalds/luckin/movie...）、brand-chips 是纯中文
-- 字符串数组，与 brand_action_cfg.brand_code（dining_01 等）完全对不上 → 点击全部
-- 404「品牌呼起配置未录入」。本迁移把两层 value 统一对齐名册系统 code。
-- 值固定幂等：重放无变化。守卫：仅当仍含旧短码/字符串 chips 时执行。
-- 有真实呼起配置：dining_13 聚合点餐 / dining_05 瑞幸 / life_01 影票 / life_04 会员卡券 / life_03 鲜花；
-- 名册存在但未录呼起（空壳，点击诚实提示「未配置小程序呼起参数」）：
-- eleme_08 饿了么红包 / taxi_01 网约车新客 / hotel_02 美团酒店 / life_02 特惠快递。
UPDATE page_schema
   SET schema_json = jsonb_set(
         schema_json,
         '{floors}',
         (
           SELECT jsonb_agg(
                    CASE
                      WHEN f->>'type' = 'nav' THEN jsonb_set(
                           f, '{props,items}',
                           '[
                              {"label":"大牌点餐","icon":"🍔","action":{"type":"plugin-launch","value":"dining_13"}},
                              {"label":"咖啡茶饮","icon":"☕","action":{"type":"plugin-launch","value":"dining_05"}},
                              {"label":"折扣电影","icon":"🎬","action":{"type":"plugin-launch","value":"life_01"}},
                              {"label":"外卖红包","icon":"🧧","action":{"type":"plugin-launch","value":"eleme_08"}},
                              {"label":"打车出行","icon":"🚕","action":{"type":"plugin-launch","value":"taxi_01"}},
                              {"label":"旅游住宿","icon":"🏨","action":{"type":"plugin-launch","value":"hotel_02"}},
                              {"label":"会员充值","icon":"⚡","action":{"type":"plugin-launch","value":"life_04"}},
                              {"label":"特惠快递","icon":"📦","action":{"type":"plugin-launch","value":"life_02"}},
                              {"label":"鲜花配送","icon":"💐","action":{"type":"plugin-launch","value":"life_03"}},
                              {"label":"领券中心","icon":"券","hot":true,"action":{"type":"jump","target":"page","value":"/pages/rights/index"}}
                            ]'::jsonb)
                      WHEN f->>'type' = 'brand-chips' THEN jsonb_set(
                           f, '{props,chips}',
                           '[
                              {"label":"麦当劳","value":"dining_01"},
                              {"label":"肯德基","value":"dining_04"},
                              {"label":"星巴克","value":"dining_02"},
                              {"label":"瑞幸","value":"dining_05"},
                              {"label":"必胜客","value":"dining_14"},
                              {"label":"塔斯汀","value":"dining_11"},
                              {"label":"奈雪的茶","value":"dining_03"},
                              {"label":"库迪咖啡","value":"dining_09"}
                            ]'::jsonb)
                      ELSE f
                    END
                    ORDER BY ord
                  )
            FROM jsonb_array_elements(schema_json->'floors') WITH ORDINALITY AS t(f, ord)
         )
       ),
       version = version + 1,
       updated_at = now()
 WHERE page = 'home'
   AND status = 'published'
   AND (schema_json::text LIKE '%"mcdonalds"%' OR schema_json::text LIKE '%"chips": ["麦当劳"%');
