-- 024: 自营快递单物流信息（后台录入 → C 端订单详情展示）
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS logistics_snapshot JSONB DEFAULT NULL;
COMMENT ON COLUMN "order".logistics_snapshot IS '自营快递物流 {company, tracking_no, shipped_at}；CPS/直充单为 NULL';
