-- 020: 收货地址表 + 用户手机号（画布 27 收货地址 / 26 手机号一键登录）
-- 幂等：全部 IF NOT EXISTS / ADD COLUMN IF NOT EXISTS

CREATE TABLE IF NOT EXISTS user_address (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES "user"(user_id),
  name       VARCHAR(64)  NOT NULL,                 -- 收货人
  phone      VARCHAR(32)  NOT NULL,                 -- 联系电话
  region     VARCHAR(128) NOT NULL DEFAULT '',     -- 省市区（picker 三级串）
  detail     VARCHAR(256) NOT NULL,                -- 详细地址
  tag        VARCHAR(16)  NOT NULL DEFAULT '家',   -- 标签：家/公司/学校
  is_default SMALLINT     NOT NULL DEFAULT 0,      -- 默认地址（每用户唯一，partial unique index 兜底）
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_address_default
  ON user_address (user_id) WHERE is_default = 1;

-- 手机号一键登录（getPhoneNumber → server 换真实号码落库）
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS phone VARCHAR(32) DEFAULT NULL;
