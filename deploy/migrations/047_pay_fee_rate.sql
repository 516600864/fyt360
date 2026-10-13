-- 047: site_payment 新增独立「支付手续费费率」字段（方案 A，2026-10-13 D先生 钦定）
-- 背景：commission_rate（20%）语义 = 到店团购平台抽成（核销时 settleRebateOnVerify 落 order.commission），
--       但看板曾拿它当微信支付费率算手续费 → 语义混用 + 双扣。现拆出独立字段 pay_fee_rate。
-- 幂等：IF NOT EXISTS，连跑两次等价。默认 0.006 = 微信 JSAPI 标准费率 0.6%。
ALTER TABLE site_payment
  ADD COLUMN IF NOT EXISTS pay_fee_rate numeric NOT NULL DEFAULT 0.006;

COMMENT ON COLUMN site_payment.pay_fee_rate IS
  '微信支付手续费费率（0~0.1），看板「支付手续费」= 有流水的自营实收 × 此费率；与 commission_rate（团购抽成）语义无关';
