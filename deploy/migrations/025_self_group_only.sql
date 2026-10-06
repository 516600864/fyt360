-- 025: 自营全面移除快递发货（2026-09-29 需求更正）——仅保留到店团购/核销模式
-- 背景：系统大量使用插件支付，与微信官方小程序发货信息管理冲突，自营发货电商整体下线。
-- 幂等：可重复执行。
BEGIN;

-- 1) 自营商品统一为到店团购
UPDATE self_goods SET delivery_type = 'group' WHERE delivery_type <> 'group';

-- 2) 历史快递自营单归 group
UPDATE "order" SET fulfillment = 'group' WHERE provider = 'self' AND fulfillment = 'express';

-- 3) 已发货/已收货的旧快递单回到「待核销」
UPDATE "order" SET fulfill_status = 'pending'
 WHERE provider = 'self' AND fulfill_status IN ('shipped', 'delivered');

-- 4) 已结算自营单缺券补发（幂等；券码 GC{orderId} 与 settleSelfOrder 同规则，7 天有效）
INSERT INTO group_coupon (order_id, code, total_times, status, expire_at)
SELECT o.id, 'GC' || o.id, 1, 'unused', COALESCE(o.settled_at, now()) + INTERVAL '7 days'
  FROM "order" o
 WHERE o.provider = 'self' AND o.platform_status = 'settled' AND o.fulfillment = 'group'
   AND NOT EXISTS (SELECT 1 FROM group_coupon gc WHERE gc.order_id = o.id);

-- 5) 物流快照列随快递链路一并移除
ALTER TABLE "order" DROP COLUMN IF EXISTS logistics_snapshot;

COMMIT;
