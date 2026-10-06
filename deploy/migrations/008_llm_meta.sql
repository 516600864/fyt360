-- 008: llm_log 补生成元数据列（A1 AI 装修生成留痕）
-- 幂等：IF NOT EXISTS
ALTER TABLE llm_log ADD COLUMN IF NOT EXISTS page        TEXT NOT NULL DEFAULT 'home';      -- 生成目标页：home / home_h5
ALTER TABLE llm_log ADD COLUMN IF NOT EXISTS model       TEXT NOT NULL DEFAULT '';          -- 模型标识（cloudbase/hy3）
ALTER TABLE llm_log ADD COLUMN IF NOT EXISTS duration_ms INT  NOT NULL DEFAULT 0;          -- 生成耗时
ALTER TABLE llm_log ADD COLUMN IF NOT EXISTS tokens_in   INT  NOT NULL DEFAULT 0;           -- 输入 token
ALTER TABLE llm_log ADD COLUMN IF NOT EXISTS tokens_out  INT  NOT NULL DEFAULT 0;           -- 输出 token
ALTER TABLE llm_log ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'ok';        -- ok / failed（失败时 schema_out 为空、error 留 prompt 尾部）

-- page_schema.source 已含 'ai' 枚举语义（TEXT 列无需变更），此处仅注释留痕。
