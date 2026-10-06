-- 039：成本价下沉到 SKU 级（修正 036 的设计缺陷）
--
-- 缺陷（D先生 2026-10-04 指出）：
--   036 把成本价放在**商品级** self_goods.cost_price（单值），
--   但到店团购商品是**多规格**的（skus jsonb 数组），不同规格售价可以差几百倍。
--   真实数据实例：
--     「一次洗衣」skus = [ {s1 1件 ¥0.01}, {s2 10件 ¥5.01} ]
--   用一个商品级成本去算两个规格的毛利 → 必错，且错得无声无息（看板不会报错，
--   只会给出一个看起来正常的假毛利）。
--
-- 本迁移：
--   1. 给 skus[] 每个元素加 cost 键（jsonb，NULL/缺失 = 该规格未录成本）
--   2. 存量回填：把商品级 cost_price 复制进该商品的每个 SKU
--      （口径等价迁移，不改变任何历史数字；cost_price 之后仍保留但语义降级为"新 SKU 的兜底默认"）
--
-- ⛔ 为什么不建独立的 self_goods_sku 规范化表：
--    项目铁律「CPS/商品不重复造表」+ self_goods.skus 已是既定真相源（决策#29 至店团购体系），
--    为一个可选字段拆表是过度设计。jsonb 加键是同一真相源内的最小改动。
--
-- ⛔ 为什么不 DROP 掉 self_goods.cost_price：
--    ① 列表页/历史数据已引用；② 新建商品时运营只想先录一个"大概成本"再逐个细化时，
--       它是唯一的兜底来源（sku.cost 缺失 → 回落 cost_price → 才是 NULL）。

-- ---------------- 存量回填 ----------------
-- 只在 cost_price 有值时才动 skus；已录 SKU 级成本的（理论上不存在，本迁移首次执行）
-- 不覆盖 —— 用 COALESCE 保证幂等：已存在的非空 cost 键保持不变。
--
-- ⛔ 为什么用 LATERAL：相关子查询的 FROM 列表里看不到 UPDATE 目标表 self_goods，
--    直接在 jsonb_agg 里引用 g.cost_price 会报 42P01 "missing FROM-clause entry for table g"；
--    LATERAL 把外层列显式引入子查询作用域。
-- ⛔ to_jsonb(...::text) 再 ::jsonb：numeric → jsonb 没有直接重载，会被当字符串字面量。
UPDATE self_goods g
   SET skus = (
     SELECT COALESCE(jsonb_agg(
       CASE
         WHEN NULLIF(e->>'cost', '') IS NOT NULL THEN e
         ELSE jsonb_set(e, '{cost}', to_jsonb(cp.v::text)::jsonb)
       END
       ORDER BY ord
     ), '[]'::jsonb)
     FROM jsonb_array_elements(g.skus) WITH ORDINALITY AS t(e, ord)
     CROSS JOIN LATERAL (SELECT g.cost_price AS v) AS cp
   )
 WHERE g.cost_price IS NOT NULL
   AND jsonb_typeof(g.skus) = 'array';

COMMENT ON COLUMN self_goods.skus IS
  'SKU 数组，每项 {sku_id, spec, price, stock, cost}。'
  'cost = 该规格的商家结算成本价（可空=未录，UI 显式给 NULL 不写 0）。'
  '下单时快照到 order.cost_amount；cost 缺失时回落商品级 cost_price，再缺则视为未录。';

COMMENT ON COLUMN self_goods.cost_price IS
  '商品级默认成本价（元）。**仅作为 SKU 未单独录成本时的兜底**；'
  '多规格商品应逐个 SKU 录成本（036 的单值设计已由 039 修正）。NULL = 未录。';
