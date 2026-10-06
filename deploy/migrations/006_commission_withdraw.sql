-- 006: 佣金结算配置(admin-33) + 提现审核(admin-34) 数据面补齐
-- platform_config：平台级键值配置（决策#6 提现门槛 / 决策#12 不分配 / 决策#21 元宝规则）
CREATE TABLE IF NOT EXISTS platform_config (
  key        VARCHAR(64) PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT DEFAULT NULL
);

INSERT INTO platform_config (key, value)
SELECT v.key, v.value
FROM (VALUES
  ('ingot_rule',    '{"self_return":100,"invite_reward":500}'::jsonb),
  ('withdraw_rule', '{"min_amount":10,"fee_rate":0,"per_txn_limit":5000}'::jsonb),
  ('dist_alloc',    '{"items":[{"key":"site_internal","label":"站点 · 内测体验站","on":true},{"key":"activity_618","label":"活动 · 618 主会场","on":true},{"key":"category_phone","label":"品类 · 话费充值","on":false}]}'::jsonb)
) AS v(key, value)
WHERE NOT EXISTS (SELECT 1 FROM platform_config c WHERE c.key = v.key);

-- withdraw 补列：驳回原因 / 打款时间（audit_by/audit_at 已有）
ALTER TABLE withdraw ADD COLUMN IF NOT EXISTS reject_reason VARCHAR(255) DEFAULT NULL;
ALTER TABLE withdraw ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ DEFAULT NULL;
