-- 029: 聚宝盆签到（决策#31）数据面
-- 机制：连签 7 天一盆（梯度 D1~D7，默认 50/60/70/80/90/100/D7=500 元宝），断签重新计盆（开新盆，无补签卡）。
-- 梯度存 site.checkin_rewards（后台可配）；record 一人一站点一行，days 存本盆逐日明细。

-- 历史遗留：旧版「每签一行」流水表（2026-09-30 确认 0 行数据）→ 重建为「一盆一行」模型
DROP TABLE IF EXISTS checkin_record;

ALTER TABLE site
  ADD COLUMN IF NOT EXISTS checkin_rewards jsonb NOT NULL DEFAULT '[50,60,70,80,90,100,500]'::jsonb;

CREATE TABLE IF NOT EXISTS checkin_record (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id     uuid        NOT NULL,
  user_id     bigint      NOT NULL,
  streak      int         NOT NULL DEFAULT 0,      -- 当前盆内连签天数（1~7）
  days        jsonb       NOT NULL DEFAULT '[]'::jsonb, -- 本盆逐日 [{d,amount,date}]
  total_ingot int         NOT NULL DEFAULT 0,      -- 本盆累计元宝
  cycle       int         NOT NULL DEFAULT 1,      -- 第几盆
  last_date   date,                                -- 最后签到日（Asia/Shanghai 口径，断签判定）
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_checkin_site_user UNIQUE (site_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_checkin_user ON checkin_record (user_id);

-- 元宝流水类型白名单放行签到奖励（001 定义的 CHECK）
ALTER TABLE ingot_tx DROP CONSTRAINT IF EXISTS ingot_tx_type_check;
ALTER TABLE ingot_tx ADD CONSTRAINT ingot_tx_type_check
  CHECK (type IN ('ORDER_REBATE','INVITE_REWARD','CHECKIN_REWARD','LEVEL_EXCHANGE','REFUND_DEDUCT','ADMIN_ADJUST'));

-- 存量首页/装修 schema：搜索条「签到有礼」胶囊 action 由 jump rights → popup/checkin
-- （只精确命中现行签到胶囊配置 value=/pages/rights/index，不误伤其他楼层；type 兼容 search-bar/f-search-bar 两种写法）
UPDATE page_schema SET schema_json = sub.new_schema, updated_at = now()
FROM (
  SELECT p.id AS pid,
    jsonb_set(p.schema_json, '{floors}', (
      SELECT jsonb_agg(
        CASE WHEN (f->>'type') IN ('search-bar', 'f-search-bar')
             THEN jsonb_set(f, '{props,action}', '{"type":"popup","target":"checkin"}'::jsonb, true)
             ELSE f END
        ORDER BY ord
      ) FROM jsonb_array_elements(p.schema_json->'floors') WITH ORDINALITY AS t(f, ord)
    )) AS new_schema
  FROM page_schema p
  WHERE p.schema_json->'floors' IS NOT NULL
) sub
WHERE page_schema.id = sub.pid
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(page_schema.schema_json->'floors') f
    WHERE (f->>'type') IN ('search-bar', 'f-search-bar')
      AND (f->'props'->'action'->>'type') = 'jump'
      AND (f->'props'->'action'->>'value') = '/pages/rights/index'
  );
