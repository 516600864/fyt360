-- 033: 后台账户设置（决策 #37 配套，D先生 2026-10-03）
--
-- 背景：
--   顶栏账户下拉 5 项里，「个人资料 / 修改密码 / 我的操作日志」三项此前**无表无端点无设计**，
--   审计只查得到全站视角（admin-50 的 /api/admin/settings/audit，platformOnly）。
--   本迁移补齐三块：
--     ① admin_user 增补 3 个可编辑字段（nickname / avatar / email）——此前 8 列里没有任何
--        可编辑的个人信息，「个人资料」页根本无从填起。
--     ② admin_notification 表——只存**已读态**，消息本体实时派生不落库。
--     ③ must_change_password 语义澄清（列已存在，仅注释，不改结构）。
--
-- ② 的设计取向（重要，勿改成"消息也落库"）：
--   消息本体三源全部从既有表实时派生 ——
--     order          → 订单异动（退款/核销异常/回调失败）
--     admin_audit_log→ 审计回执（调账/禁用/重发券码/改密，回推操作者本人，闭合决策 #32 留痕红线）
--     admin_notification(source='system') → 系统公告（唯一需要落库的一源）
--   本表只回答一个问题："某人读过哪条"。消息本体若落库会与源表双写、失同步，
--   违反「唯一落库面」精神；source/source_id 组成的唯一约束天然幂等，重复标记已读不报错。

-- ─────────────────────────────────────────────────────────────
-- ① admin_user 增补可编辑字段（幂等：列已存在则跳过）
-- ─────────────────────────────────────────────────────────────
ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS nickname varchar(64);
ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS avatar    text;
ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS email     varchar(128);

-- 邮箱格式约束：仅在非空时校验，允许历史空值（存量账号三列均为 NULL）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_admin_user_email'
  ) THEN
    ALTER TABLE admin_user
      ADD CONSTRAINT ck_admin_user_email
      CHECK (email IS NULL OR email = '' OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  END IF;
END $$;

COMMENT ON COLUMN admin_user.nickname IS '账户下拉/个人资料页展示名；为空时前端回退 username';
COMMENT ON COLUMN admin_user.avatar    IS '头像 URL；为空时前端回退 username 首字母圆形色块';
COMMENT ON COLUMN admin_user.email     IS '联系邮箱，仅个人资料页自用，不参与登录/通知下发';
-- must_change_password：强制改密标记。改密成功后须置回 false（决策 #37 修此语义）。
COMMENT ON COLUMN admin_user.must_change_password IS 'true=下次登录强制改密。/api/admin/password 改密成功后必须置 false，否则改完仍被拦。';

-- ─────────────────────────────────────────────────────────────
-- ② 消息已读表（消息本体不落库，见文件头设计说明）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_notification (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id    uuid,                          -- 平台级公告为 NULL
  admin_id   bigint      NOT NULL,          -- 已读归属人（回执类只写操作者本人）
  -- 消息来源，与实时派生源一一对应
  source     varchar(16) NOT NULL
    CHECK (source IN ('order','audit','system')),
  -- 源表主键字符串，如 admin_audit_log.id='123' / system 公告用其自身 id
  source_id  varchar(64) NOT NULL,
  read_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_notif_admin_source UNIQUE (admin_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_notif_admin_read
  ON admin_notification (admin_id, read_at DESC);
-- 按站点拉「该站点有多少条未读」用（铃铛圆点只需知道有无，不做数字角标，仍建索引备后用）
CREATE INDEX IF NOT EXISTS idx_notif_site
  ON admin_notification (site_id, admin_id);
