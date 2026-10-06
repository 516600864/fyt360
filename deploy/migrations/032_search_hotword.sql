-- 032: 07B 相关搜索接真实词表（D先生 2026-10-03）
--
-- 背景（先有旧账）：
--   07B「相关搜索」原为端上硬编码 5 个词 ['每日坚果','空气炸锅','肯德基','麦当劳','视频会员']。
--   其中「每日坚果」「空气炸锅」是**自造词**——站内 self_goods / brand_action_cfg 均无此商品，
--   点了必然零结果（违反「严禁 AI 加戏」铁律）；后 3 个是从 brand_action_cfg 抄的硬编码快照，
--   品牌改名/下架后词表不会跟着变。
--   同页「隆重推荐」位是写死的假卡（腾讯 VIP ¥199 / 边看剧边吃火锅），已随本次一并移除
--   ——腾讯 VIP 属 CPS 品类却用假价格做种草，同样是加戏。
--
-- 本迁移把词表落到 DB，运营可控、端上实时拉：
--   ① search_hotword —— 运营热词表（人工可增删改/调权重/启停），是「相关搜索」的主词源。
--   ② search_keyword_log —— 端上真实搜索词上报流水（只入库，不做统计看板）。
--      等有真实流量后，这里可按 word 聚合出真热搜，再回灌 search_hotword。
--
-- 词源铁律：所有词必须来自真实数据面（brand_action_cfg 服务名 / brand_category 分类名
--   / fasttype 权益品牌名），禁止凭空造词。种子数据由 seed-hotwords.mjs 从这些表实拉去重生成。

CREATE TABLE IF NOT EXISTS search_hotword (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id    uuid        NOT NULL,
  word       varchar(64) NOT NULL,
  weight     int         NOT NULL DEFAULT 0,   -- 越大越靠前；后台可调
  enabled    boolean     NOT NULL DEFAULT true,
  -- 词来源：manual=后台手工加 / service=brand_action_cfg / category=brand_category
  --         / rights=fasttype 权益品牌。用于溯源，非 manual 的词理论上可由源表重新生成。
  source     varchar(16) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','service','category','rights')),
  sort       int         NOT NULL DEFAULT 0,   -- 同权重时的稳定次序
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hotword_site_word UNIQUE (site_id, word)
);

CREATE INDEX IF NOT EXISTS idx_hotword_site_rank
  ON search_hotword (site_id, enabled, weight DESC, sort, id);

-- 真实搜索词流水（端上 POST /api/site/search-log 上报）。
-- 不做统计看板，但先落表：有量后一条 GROUP BY 即可出真热搜，替代人工配词。
CREATE TABLE IF NOT EXISTS search_keyword_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  site_id    uuid        NOT NULL,
  word       varchar(64) NOT NULL,
  user_id    bigint,                        -- 匿名搜索为 NULL（未登录不阻塞）
  -- 来源页：search_result=07B / search=07 平台专属 / home_search=首页搜索条
  source     varchar(24) NOT NULL DEFAULT 'search_result',
  -- 该次搜索是否有结果（用于识别「搜了但零结果」= 词表缺口）
  hit_count  int         NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kwlog_site_time ON search_keyword_log (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kwlog_site_word ON search_keyword_log (site_id, word);
-- 统计用：按天聚合同词的搜索量（真热搜的原料）
CREATE INDEX IF NOT EXISTS idx_kwlog_word_day ON search_keyword_log (word, created_at);
