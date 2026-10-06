-- 002_ordersync.sql（M2.3）：订单同步/结算支持，幂等可重复执行
-- rebate_at    = 元宝返还+佣金分配已处理时间（NULL=待结算处理）
-- chargeback_at= 退款冲销已处理时间（NULL=待冲销处理）
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS rebate_at     TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS chargeback_at TIMESTAMPTZ DEFAULT NULL;

-- 同步扫描索引（按站点+供给方+平台状态拉待结算单）
CREATE INDEX IF NOT EXISTS idx_order_sync ON "order"(site_id, provider, platform_status);
-- 冲销幂等检查（按用户+类型+订单引用查已扣流水）
CREATE INDEX IF NOT EXISTS idx_ingot_tx_ref ON ingot_tx(user_id, type, ref_id);

-- 结算/冲销幂等原子保障：同一订单对同一用户只允许一条发放/扣回流水
-- （ref_id 在 ORDER_REBATE/REFUND_DEDUCT 场景存 order.id 数字串）
CREATE UNIQUE INDEX IF NOT EXISTS uq_ingot_tx_order_ref
  ON ingot_tx(user_id, type, ref_id)
  WHERE type IN ('ORDER_REBATE', 'REFUND_DEDUCT');
-- 同一订单同一跳位只允许一条佣金流水（重放/并发安全）
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_flow_order_level
  ON commission_flow(order_id, level);
