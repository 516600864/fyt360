-- 030: 签到订阅消息每日提醒（决策#32，D先生 指令 2026-09-30）
-- ① provider_config 加通用扩展列 config：存微信订阅消息模板配置（tmpl_checkin/tmpl_checkin_map）
--    凭据跟 site_id 走铁律（决策#25①）——模板 ID 也跟站点走（每个小程序各自申请模板）
ALTER TABLE provider_config ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN provider_config.config IS '供应商扩展配置 {tmpl_checkin, tmpl_checkin_map} 等（应用层读取，勿存敏感凭据）';

-- ② 用户订阅授权额度：一次性订阅 = 授权一次可发一条（端上签到成功后引导授权，quota+1）
--    定时任务发送成功后 quota-1；43101（未订阅/已耗尽）清零
CREATE TABLE IF NOT EXISTS user_push_quota (
  user_id    BIGINT PRIMARY KEY REFERENCES "user"(user_id) ON DELETE CASCADE,
  site_id    UUID NOT NULL REFERENCES site(site_id) ON DELETE CASCADE,
  quota      INT NOT NULL DEFAULT 0 CHECK (quota >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upq_site_quota ON user_push_quota (site_id, quota) WHERE quota > 0;
