-- ============================================================
-- FYT360 001_init.sql · 全量建表（幂等）
-- 依据：《FYT360需求设计开发文档》v0.6.12 §10 + 决策 #22/#24/#25
-- 原则：
--   1. CREATE TABLE IF NOT EXISTS / DO $$ 块处理约束与索引 → 可重复执行
--   2. 所有业务表以 site_id 为多租户隔离键
--   3. site 表 = 小程序 appid/secret、微信支付商户参数唯一真源（决策 #25）
-- ============================================================

-- ------------------------------------------------------------
-- 1. site 租户站点（多开单元，决策 #25：凭据唯一真源；一站点一门店）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS site (
  site_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           VARCHAR(64) NOT NULL UNIQUE,          -- 站点标识（H5 分目录 / 小程序构建变量）
  name           VARCHAR(128) NOT NULL,
  appid          VARCHAR(64) DEFAULT NULL,             -- 小程序 appid（站点级唯一真源）
  mini_secret    TEXT DEFAULT NULL,                    -- 小程序 secret（应用层加密存储）
  theme          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- 主题 token（Design Token 覆盖值）
  plugins        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- 启用插件列表
  halfscreen_cfg JSONB NOT NULL DEFAULT '{}'::jsonb,   -- 半屏小程序配置
  launch_matrix  JSONB NOT NULL DEFAULT '[]'::jsonb,   -- 呼起矩阵
  domain         VARCHAR(255) DEFAULT NULL,            -- 绑定域名（可选）
  pay_mch_id     VARCHAR(64) DEFAULT NULL,             -- 微信支付商户号（站点级，决策 #25②）
  pay_api_v3_key TEXT DEFAULT NULL,                    -- 微信支付 APIv3 key（加密存储）
  pay_serial_no  VARCHAR(128) DEFAULT NULL,            -- 商户证书序列号
  shop_addr      VARCHAR(512) DEFAULT NULL,            -- 门店地址（一站点一门店，决策 #25⑥）
  status         VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. 页面与装修
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS page_schema (
  id          BIGSERIAL PRIMARY KEY,
  site_id     UUID NOT NULL REFERENCES site(site_id),
  page        VARCHAR(64) NOT NULL,                    -- home / rights / life / 自定义页
  schema_json JSONB NOT NULL DEFAULT '[]'::jsonb,      -- 组件树（§6.1 统一 Action 协议）
  version     INT NOT NULL DEFAULT 1,
  status      VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','offline')),
  source      VARCHAR(16) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS page_template (
  template_id  BIGSERIAL PRIMARY KEY,
  name         VARCHAR(128) NOT NULL,
  scene        VARCHAR(32) NOT NULL DEFAULT 'general', -- festival / promo / general
  schema_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  preview_img  TEXT DEFAULT NULL,
  ai_fewshot   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   BIGINT DEFAULT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS component_template (
  code       VARCHAR(64) PRIMARY KEY,                  -- swiper / nav / goods-feed 等 23 组件
  name       VARCHAR(128) NOT NULL,
  category   VARCHAR(32) NOT NULL DEFAULT 'basic',     -- basic / marketing / member / layout
  schema_tpl JSONB NOT NULL DEFAULT '{}'::jsonb,       -- 组件 Schema 模板（默认属性）
  status     VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_log (
  id         BIGSERIAL PRIMARY KEY,
  site_id    UUID DEFAULT NULL REFERENCES site(site_id),
  prompt     TEXT NOT NULL,
  schema_out JSONB DEFAULT NULL,
  operator   BIGINT DEFAULT NULL,                      -- admin_id
  version    INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 3. 品牌与活动（§5 / §3.1.2 生活缴费 10 大分类 159 业务入口）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brand_category (
  code     VARCHAR(64) PRIMARY KEY,                    -- dining / life / taxi / hotel / meituan / eleme / jd / tb / vip / pdd
  name     VARCHAR(64) NOT NULL,
  icon     TEXT DEFAULT NULL,
  sort     INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS brand_action_cfg (
  id           BIGSERIAL PRIMARY KEY,
  site_scope   VARCHAR(32) NOT NULL DEFAULT 'all',     -- all / 指定 site_id::text
  category     VARCHAR(64) NOT NULL REFERENCES brand_category(code),
  brand_code   VARCHAR(64) NOT NULL,
  name         VARCHAR(128) NOT NULL,
  icon         TEXT DEFAULT NULL,
  action_type  VARCHAR(16) NOT NULL DEFAULT 'plugin' CHECK (action_type IN ('plugin','halfscreen','launch')),
  miniapp_cfg  JSONB NOT NULL DEFAULT '{}'::jsonb,     -- appid / path / 插件参数
  h5_cfg       JSONB NOT NULL DEFAULT '{}'::jsonb,     -- url / 呼起参数
  health_status VARCHAR(16) NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('ok','degraded','down','unknown')),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_scope, category, brand_code)
);

CREATE TABLE IF NOT EXISTS activity (
  id        BIGSERIAL PRIMARY KEY,
  site_id   UUID NOT NULL REFERENCES site(site_id),
  name      VARCHAR(128) NOT NULL,
  brands    JSONB NOT NULL DEFAULT '[]'::jsonb,
  mode      VARCHAR(16) NOT NULL DEFAULT 'direct' CHECK (mode IN ('direct','page')),
  banner    TEXT DEFAULT NULL,
  rules     JSONB NOT NULL DEFAULT '{}'::jsonb,
  cta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  share_cfg JSONB NOT NULL DEFAULT '{}'::jsonb,
  sub_cards JSONB NOT NULL DEFAULT '[]'::jsonb,        -- 每卡含唯一 sub_card_id
  status    VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 4. 自营商品（决策 #24：site_id = 货主 = 销售站点，硬隔离）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS self_goods (
  goods_id      BIGSERIAL PRIMARY KEY,
  site_id       UUID NOT NULL REFERENCES site(site_id),
  title         VARCHAR(255) NOT NULL,
  main_imgs     JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail_imgs   JSONB NOT NULL DEFAULT '[]'::jsonb,
  video_url     TEXT DEFAULT NULL,
  skus          JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{sku_id, spec, price, stock, ...}]
  freight_tpl   JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_type VARCHAR(16) NOT NULL DEFAULT 'express' CHECK (delivery_type IN ('express','group')),
  status        VARCHAR(16) NOT NULL DEFAULT 'on' CHECK (status IN ('on','off')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seckill_activity (
  id            BIGSERIAL PRIMARY KEY,
  site_id       UUID NOT NULL REFERENCES site(site_id),
  goods_id      BIGINT NOT NULL REFERENCES self_goods(goods_id),
  seckill_price NUMERIC(10,2) NOT NULL CHECK (seckill_price >= 0),
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ NOT NULL,
  stock         INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  limit_per_user INT NOT NULL DEFAULT 1,
  status        VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled'))
);

-- ------------------------------------------------------------
-- 5. 订单（§4.5 三维状态机：platform / fulfill / refund）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "order" (
  id              BIGSERIAL PRIMARY KEY,
  order_sn        VARCHAR(64) NOT NULL UNIQUE,         -- 我方单号；provider_order_sn 供应商单号另存
  site_id         UUID NOT NULL REFERENCES site(site_id),
  provider        VARCHAR(32) NOT NULL DEFAULT 'self', -- self / mayixingqiu(蚂蚁星球) / jd / tb / pdd / vip
  provider_order_sn VARCHAR(128) DEFAULT NULL,
  platform        VARCHAR(16) NOT NULL DEFAULT 'mini', -- mini / h5
  pay_price       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (pay_price >= 0),  -- 实付
  commission      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (commission >= 0), -- 平台实际到手收益（佣金基数，§11.2）
  buyer_id        BIGINT NOT NULL,
  promoter_id     BIGINT DEFAULT NULL,                 -- 归因推广者 user_id（决策 #25⑦：推广位即 user_id）
  goods_snapshot  JSONB NOT NULL DEFAULT '{}'::jsonb,
  platform_status VARCHAR(24) NOT NULL DEFAULT 'created', -- 平台侧：created/paid/settled/closed
  fulfill_status  VARCHAR(24) NOT NULL DEFAULT 'none',    -- 履约侧：none/pending/shipped/delivered/verified
  refund_status   VARCHAR(24) NOT NULL DEFAULT 'none',    -- 售后侧：none/applying/refunded/partial
  paid_at         TIMESTAMPTZ DEFAULT NULL,
  settled_at      TIMESTAMPTZ DEFAULT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_coupon (
  coupon_id  BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES "order"(id),
  code       VARCHAR(64) NOT NULL UNIQUE,              -- 唯一券码
  qr         TEXT DEFAULT NULL,                        -- 券码 QR 内容/图片
  total_times INT NOT NULL DEFAULT 1,                  -- 可核销总次数
  used_times  INT NOT NULL DEFAULT 0,                  -- 已核销次数（部分核销）
  status     VARCHAR(16) NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','partial','used','expired')),
  expire_at  TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verify_log (
  id              BIGSERIAL PRIMARY KEY,
  coupon_id       BIGINT NOT NULL REFERENCES group_coupon(coupon_id),
  order_id        BIGINT NOT NULL,
  site_id         UUID NOT NULL,
  verifier_user_id BIGINT NOT NULL,                    -- 核销员 = C 端 user（决策 #25④）
  times           INT NOT NULL DEFAULT 1,
  result          VARCHAR(16) NOT NULL CHECK (result IN ('success','fail')),
  fail_reason     VARCHAR(255) DEFAULT NULL,
  verified_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 6. 优惠券（券包 / 领券中心 / 自营券共用，§3.3）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupon (
  id         BIGSERIAL PRIMARY KEY,
  site_id    UUID NOT NULL REFERENCES site(site_id),
  name       VARCHAR(128) NOT NULL,
  type       VARCHAR(16) NOT NULL CHECK (type IN ('cash_off','discount','exchange')),
  scope      VARCHAR(16) NOT NULL DEFAULT 'self' CHECK (scope IN ('self','rights')),
  amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  threshold  NUMERIC(10,2) NOT NULL DEFAULT 0,
  total      INT NOT NULL DEFAULT 0,
  issued     INT NOT NULL DEFAULT 0,
  valid_from TIMESTAMPTZ DEFAULT NULL,
  valid_to   TIMESTAMPTZ DEFAULT NULL,
  status     VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_coupon (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL,
  coupon_id     BIGINT NOT NULL REFERENCES coupon(id),
  status        VARCHAR(16) NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','used','expired')),
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_order_id BIGINT DEFAULT NULL
);

-- ------------------------------------------------------------
-- 7. 用户与关系树（§8.2⑤ / §11.1：按站点隔离，注册时一次锁定）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user" (
  user_id   BIGSERIAL PRIMARY KEY,
  site_id   UUID NOT NULL REFERENCES site(site_id),
  openid    VARCHAR(64) DEFAULT NULL,                  -- 小程序 openid
  unionid   VARCHAR(64) DEFAULT NULL,
  h5_openid VARCHAR(64) DEFAULT NULL,                  -- 公众号 openid
  nickname  VARCHAR(128) DEFAULT NULL,
  avatar    TEXT DEFAULT NULL,
  parent_id BIGINT DEFAULT NULL REFERENCES "user"(user_id),  -- 关系树三跳：注册时一次锁定，绑定后不可更改
  grand_id  BIGINT DEFAULT NULL,
  great_id  BIGINT DEFAULT NULL,
  invite_code VARCHAR(32) DEFAULT NULL UNIQUE,
  status    VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member_level (
  level_id    SERIAL PRIMARY KEY,
  code        VARCHAR(16) NOT NULL UNIQUE,             -- L1 / L2 / L3
  name        VARCHAR(64) NOT NULL,
  sort        INT NOT NULL DEFAULT 0,
  ingot_price INT NOT NULL DEFAULT 0,                  -- 元宝兑换价（L1=0 注册即得）
  self_rate   NUMERIC(5,4) NOT NULL DEFAULT 0,         -- 自购佣金比例（基数=平台到手收益）
  direct_rate NUMERIC(5,4) NOT NULL DEFAULT 0,         -- 直推比例
  team_rate   NUMERIC(5,4) NOT NULL DEFAULT 0,         -- 间推比例（三级内最后一跳）
  team2_rate  NUMERIC(5,4) NOT NULL DEFAULT 0,         -- 预留扩展，v1.0 不启用
  icon        TEXT DEFAULT NULL,
  "desc"      TEXT DEFAULT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS member (
  user_id           BIGINT PRIMARY KEY REFERENCES "user"(user_id),
  level_id          INT NOT NULL REFERENCES member_level(level_id),
  level_exchanged_at TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS ingot_account (
  user_id      BIGINT PRIMARY KEY REFERENCES "user"(user_id),
  balance      INT NOT NULL DEFAULT 0 CHECK (balance >= 0),   -- 元宝不可提现/转赠/兑现金
  frozen       INT NOT NULL DEFAULT 0 CHECK (frozen >= 0),    -- 退款待扣冻结（余额不足时挂账）
  total_earned INT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingot_tx (
  tx_id         BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES "user"(user_id),
  type          VARCHAR(32) NOT NULL CHECK (type IN ('ORDER_REBATE','INVITE_REWARD','CHECKIN_REWARD','LEVEL_EXCHANGE','REFUND_DEDUCT','ADMIN_ADJUST')),
  ref_id        VARCHAR(64) DEFAULT NULL,              -- order_id / 被邀请 user_id / level_code
  amount        INT NOT NULL,                          -- 正=发放 负=扣回
  balance_after INT NOT NULL,
  remark        VARCHAR(255) DEFAULT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS promoter (
  user_id            BIGINT PRIMARY KEY REFERENCES "user"(user_id),
  invite_code        VARCHAR(32) NOT NULL UNIQUE,
  commission_balance NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (commission_balance >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commission_flow (
  id         BIGSERIAL PRIMARY KEY,
  order_id   BIGINT NOT NULL REFERENCES "order"(id),
  user_id    BIGINT NOT NULL REFERENCES "user"(user_id),
  level      SMALLINT NOT NULL CHECK (level IN (1,2,3)), -- 1=自购 2=直推 3=间推
  amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  status     VARCHAR(16) NOT NULL DEFAULT 'estimated' CHECK (status IN ('estimated','available','withdrawn','invalid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS withdraw (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES "user"(user_id),
  amount     NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  channel    VARCHAR(16) NOT NULL DEFAULT 'wx_wallet',  -- 企业付款到零钱
  status     VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid','failed')),
  audit_by   BIGINT DEFAULT NULL,
  audit_at   TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkin_record (
  id          BIGSERIAL PRIMARY KEY,
  site_id     UUID NOT NULL,
  user_id     BIGINT NOT NULL REFERENCES "user"(user_id),
  streak      INT NOT NULL DEFAULT 0,           -- 当前盆内连签天数（1~7）
  days        JSONB NOT NULL DEFAULT '[]'::jsonb, -- 本盆逐日 [{d,amount,date}]
  total_ingot INT NOT NULL DEFAULT 0,
  cycle       INT NOT NULL DEFAULT 1,           -- 第几盆
  last_date   DATE,                             -- 最后签到日（Asia/Shanghai）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, user_id)
);

-- ------------------------------------------------------------
-- 8. 核销员（C 端身份，决策 #25④；仅可核销同 site_id 券）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verify_agent (
  id         BIGSERIAL PRIMARY KEY,
  site_id    UUID NOT NULL REFERENCES site(site_id),
  user_id    BIGINT NOT NULL REFERENCES "user"(user_id),
  role       VARCHAR(16) NOT NULL DEFAULT 'verifier',
  status     VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, user_id)
);

-- ------------------------------------------------------------
-- 9. 后台 RBAC 三表（§8.2：admin_user + admin_user_site + role）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role (
  role_code   VARCHAR(32) PRIMARY KEY,                 -- platform_admin / site_admin / readonly_ops
  name        VARCHAR(64) NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb       -- 菜单/动作级权限
);

CREATE TABLE IF NOT EXISTS admin_user (
  admin_id      BIGSERIAL PRIMARY KEY,
  username      VARCHAR(64) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          VARCHAR(32) NOT NULL DEFAULT 'site_admin' REFERENCES role(role_code),
  status        VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,   -- 初始密码首次登录强制改密（§14.2⑤）
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_user_site (
  id        BIGSERIAL PRIMARY KEY,
  admin_id  BIGINT NOT NULL REFERENCES admin_user(admin_id),
  site_id   UUID NOT NULL REFERENCES site(site_id),
  site_role VARCHAR(32) NOT NULL DEFAULT 'site_admin',
  UNIQUE (admin_id, site_id)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    BIGINT NOT NULL,
  site_id     UUID DEFAULT NULL,
  action      VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) DEFAULT NULL,
  target_id   VARCHAR(64) DEFAULT NULL,
  detail      JSONB DEFAULT NULL,
  ip          VARCHAR(64) DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 10. 供给方配置（决策 #25①：蚂蚁星球 key 跟 site_id 走）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_config (
  id         BIGSERIAL PRIMARY KEY,
  site_id    UUID NOT NULL REFERENCES site(site_id),
  provider   VARCHAR(32) NOT NULL,                     -- mayixingqiu / ...
  apikey     TEXT DEFAULT NULL,                        -- 应用层加密存储
  api_secret TEXT DEFAULT NULL,                        -- 应用层加密存储
  rate_limit JSONB NOT NULL DEFAULT '{}'::jsonb,
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,       -- 供应商扩展配置（tmpl_checkin 等）
  status     VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, provider)
);

-- ------------------------------------------------------------
-- 11. 埋点（§5.4 / §6.1④：楼层/子活动卡片转化统计）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS track_event (
  id          BIGSERIAL PRIMARY KEY,
  site_id     UUID NOT NULL,
  user_id     BIGINT DEFAULT NULL,
  event_type  VARCHAR(16) NOT NULL CHECK (event_type IN ('expose','click','convert')),
  target_type VARCHAR(32) NOT NULL CHECK (target_type IN ('page','floor','card','goods','activity')),
  target_id   VARCHAR(64) NOT NULL,
  props       JSONB DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 索引（幂等：IF NOT EXISTS）
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_page_schema_site_page   ON page_schema (site_id, page, status);
CREATE INDEX IF NOT EXISTS idx_brand_action_category   ON brand_action_cfg (category, enabled);
CREATE INDEX IF NOT EXISTS idx_activity_site           ON activity (site_id, status);
CREATE INDEX IF NOT EXISTS idx_self_goods_site         ON self_goods (site_id, status);
CREATE INDEX IF NOT EXISTS idx_order_site_created      ON "order" (site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_buyer             ON "order" (buyer_id);
CREATE INDEX IF NOT EXISTS idx_order_promoter          ON "order" (promoter_id);
CREATE INDEX IF NOT EXISTS idx_order_platform_sn       ON "order" (provider, provider_order_sn);
CREATE INDEX IF NOT EXISTS idx_order_platform_status   ON "order" (platform_status);
CREATE INDEX IF NOT EXISTS idx_user_site_unionid       ON "user" (site_id, unionid);
CREATE INDEX IF NOT EXISTS idx_user_parent             ON "user" (parent_id);
CREATE INDEX IF NOT EXISTS idx_ingot_tx_user           ON ingot_tx (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_commission_flow_order   ON commission_flow (order_id);
CREATE INDEX IF NOT EXISTS idx_commission_flow_user    ON commission_flow (user_id, status);
CREATE INDEX IF NOT EXISTS idx_verify_log_site_time    ON verify_log (site_id, verified_at);
CREATE INDEX IF NOT EXISTS idx_track_event_site        ON track_event (site_id, event_type, created_at);

-- 用户订阅消息授权额度（030：一次性订阅=授权一次发一条；签到每日提醒）
CREATE TABLE IF NOT EXISTS user_push_quota (
  user_id    BIGINT PRIMARY KEY REFERENCES "user"(user_id) ON DELETE CASCADE,
  site_id    UUID NOT NULL REFERENCES site(site_id) ON DELETE CASCADE,
  quota      INT NOT NULL DEFAULT 0 CHECK (quota >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upq_site_quota ON user_push_quota (site_id, quota) WHERE quota > 0;
CREATE INDEX IF NOT EXISTS idx_user_coupon_user        ON user_coupon (user_id, status);
CREATE INDEX IF NOT EXISTS idx_checkin_user          ON checkin_record (user_id);

-- ------------------------------------------------------------
-- 触发器：updated_at 自动维护（幂等：DROP IF EXISTS + CREATE）
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fyt_set_updated_at') THEN
    CREATE FUNCTION fyt_set_updated_at() RETURNS trigger AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['site','"order"','self_goods','admin_user','commission_flow','ingot_account']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %s', replace(t,'"',''), t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION fyt_set_updated_at()', replace(t,'"',''), t);
  END LOOP;
END $$;
