-- 036：团购商品成本价 + 订单成本快照（admin-29 数据看板「到店团购毛利」的数据源）
--
-- 背景（D先生 2026-10-04 拍板 Q1）：
--   看板毛收入第二行「到店团购毛利 = 团购收款 − 团购成本 − 团购佣金 − 手续费」，
--   但 self_goods 只有售价（skus 里的 price），**没有商家结算成本价**，
--   库里 29 个 order 字段也没有任何金额快照能还原成本 → 毛利算不出来。
--
-- 本迁移：
--   1. self_goods.cost_price —— 商品级成本价（后台商品页录入，NULL = 未录）
--   2. order.cost_amount   —— 下单瞬间的成本价**快照**（防商品改价污染历史账）
--
-- ⛔ 为什么不直接在 order 上 JOIN self_goods 算成本：
--    商品改价/下架后，历史订单的成本会跟着变，看板账房会被追溯篡改。
--    财务口径必须快照，与 pay_price 同理。
--
-- ⚠️ 成本价是**商家结算成本**，不是我方采购价，两者语义不同：
--    到店团购是「用户付钱 → 我方过账 → 核销时付商家」，
--    成本 = 核销时结算给商家的金额。未录成本时毛利显示为 null（不可算），不填 0 骗人。

ALTER TABLE self_goods
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2) NULL;

ALTER TABLE "order"
  ADD COLUMN IF NOT EXISTS cost_amount numeric(12,2) NULL;

COMMENT ON COLUMN self_goods.cost_price IS
  '商家结算成本价（元）。到店团购毛利 = 收款 − 成本 − 佣金 − 手续费。NULL = 商家未录成本，该单毛利不可算。';
COMMENT ON COLUMN "order".cost_amount IS
  '下单时快照的商家结算成本价（元）。防止商品改价后历史账房被追溯篡改，与 pay_price 同理快照。';

-- 看板按成本口径聚合自营单时的覆盖索引
CREATE INDEX IF NOT EXISTS idx_order_cost_snapshot
  ON "order" (site_id, cost_amount)
  WHERE cost_amount IS NOT NULL;

-- ---------------- 历史回填 ----------------
-- 存量自营单：一律留 NULL（不猜成本）。
-- 宁可看板显示"成本待录入"，也不能拿售价当成本算出一个假毛利。
-- 历史单若要补成本，走商家对账后按单回填。
