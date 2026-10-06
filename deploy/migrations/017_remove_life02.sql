-- 017: 移除「特惠快递」(life_02) —— 与 life_06 比价寄(halfscreen type=15)为同一业务重复行，D先生 2026-09-27 拍板移除
DELETE FROM brand_action_cfg WHERE brand_code = 'life_02';
