-- 022: 系统设置屏（admin-50）前置——provider_config 补 updated_at（画布「更新于」字段）
ALTER TABLE provider_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
