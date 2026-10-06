-- 031: 营销券闭环（档 C：领券 + 下单抵扣）
-- 背景：coupon/user_coupon 表已建但无任何写入点（user_coupon 恒 0 行），券条只是搬文案。
-- 本迁移打通：领取（一人一券）→ 券包 → 下单抵扣（锁券）→ 取消/退款退券。
--
-- 1) order 落券痕迹：coupon_id = user_coupon.id（非 coupon.id，指"哪一张用户券"）；coupon_discount = 本单实际抵扣额
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS coupon_id bigint;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS coupon_discount numeric NOT NULL DEFAULT 0;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_coupon_discount_check') THEN
    ALTER TABLE "order" ADD CONSTRAINT order_coupon_discount_check CHECK (coupon_discount >= 0);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_order_coupon ON "order" (coupon_id);

-- 2) user_coupon 补字段：expire_at = 领取时券有效期快照（券主表改期不影响已领）；used_at = 核销时间
ALTER TABLE user_coupon ADD COLUMN IF NOT EXISTS expire_at timestamp with time zone;
ALTER TABLE user_coupon ADD COLUMN IF NOT EXISTS used_at timestamp with time zone;

-- 3) 一人一券：唯一索引兜底并发（领取走 ON CONFLICT DO NOTHING，重复领返回已领）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_coupon ON user_coupon (user_id, coupon_id);

-- 4) 券包查询索引：按用户 + 状态
CREATE INDEX IF NOT EXISTS idx_user_coupon_user_status ON user_coupon (user_id, status);
