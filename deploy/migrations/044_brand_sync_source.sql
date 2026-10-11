-- =============================================================
-- 044: 品牌三轨对账 sync_source 列（D先生 2026-10-10 裁决：评审文档四项全按方案）
-- docs/品牌三轨对账同步设计评审.md
--
-- sync_source: manual=人工直配（016 等种子）/ auto=上游驱动（对账 job 维护）
--   裁决④：历史 125 行 mode=act 全回填 auto（语义=上游活动驱动，job 只碰这些行）
-- 幂等：ADD COLUMN IF NOT EXISTS + 条件 UPDATE（二次执行 0 行）
-- =============================================================

ALTER TABLE brand_action_cfg
  ADD COLUMN IF NOT EXISTS sync_source VARCHAR(8) NOT NULL DEFAULT 'manual';

UPDATE brand_action_cfg SET sync_source = 'auto'
 WHERE miniapp_cfg->>'mode' = 'act' AND sync_source = 'manual';
