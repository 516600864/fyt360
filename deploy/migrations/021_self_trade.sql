-- 021: 自营交易链（决策：商户号已有凭据后补 / 站点级固定佣金率 / 元宝与 CPS 同规）
-- 幂等

-- 订单表补自营所需 3 列
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS address_snapshot JSONB DEFAULT NULL; -- {name,phone,region,detail}
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS sku_snapshot   JSONB DEFAULT NULL;    -- {sku_id,spec,price}
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS payment_no     VARCHAR(64) DEFAULT NULL; -- 微信支付单号

-- 站点级微信支付配置（凭据跟 site_id 走，铁律；cert=商户私钥 PEM）
CREATE TABLE IF NOT EXISTS site_payment (
  site_id         UUID PRIMARY KEY REFERENCES site(site_id),
  mch_id          VARCHAR(32)  NOT NULL,
  mch_key         TEXT         NOT NULL,            -- APIv3 key（回调解密）
  serial_no       VARCHAR(64)  NOT NULL,            -- 商户 API 证书序列号
  cert            TEXT         NOT NULL,            -- 商户私钥 PEM（apiclient_key.pem）
  commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.2000, -- 自营毛利率（佣金基数=实付×rate）
  status          VARCHAR(16)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 触发器 trg_self_goods_updated_at 引用 updated_at，但 001 建表漏列（UPDATE self_goods 全体报 42703）
ALTER TABLE self_goods ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
