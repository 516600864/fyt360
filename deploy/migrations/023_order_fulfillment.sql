-- 023: 订单履约方式（自营快递/到店核销二选一，随 self_goods.delivery_type 下单落定）
-- 幂等：列已存在则跳过
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS fulfillment VARCHAR(16) NOT NULL DEFAULT 'express';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfillment_chk') THEN
    ALTER TABLE "order" ADD CONSTRAINT order_fulfillment_chk CHECK (fulfillment IN ('express','group'));
  END IF;
END $$;
