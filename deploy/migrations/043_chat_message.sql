-- 043：AI 助手对话历史（mini-29，决策 #46/#47，D先生 2026-10-07）
--
-- 需求背景（AI 管家 = 本站出票亭）：
--   对话历史「存」（#46 已定）：user_id + site_id 隔离（同收藏/足迹口径，跨站不可见）。
--   站长/平台超管均无权查看用户对话 —— 本表不设任何站长端查询端点。
--
-- ═══ 字段设计 ═══
--   session_id  TEXT：前端生成的会话串（单一滚动会话，预留多窗）
--   role        user | assistant
--   kind        text | goods_card | service_card | parse_card
--   content     TEXT：文本正文；卡片态存摘要文案
--   meta        JSONB：意图 JSON / 卡片引用。⛔ 不落商品全量快照，只落 ref_id 引用 ——
--               回看历史时价格重新透传（对齐收藏「点击时取最新价」哲学，失效态兜底）。
--
--   留存：最近 200 条 / 30 天，写入时同步 prune（复用足迹 prune-on-write 模式，决策 #41 同款，
--   ⛔ 不挂 cron —— cron.ts 是 M1 空壳，别为一张表起 worker）。

CREATE TABLE IF NOT EXISTS chat_message (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  site_id     UUID   NOT NULL,
  session_id  TEXT   NOT NULL,
  role        TEXT   NOT NULL,
  kind        TEXT   NOT NULL DEFAULT 'text',
  content     TEXT   NOT NULL,
  meta        JSONB  DEFAULT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE chat_message IS
  'AI 助手对话历史（mini-29）。隔离=user_id+site_id（跨站不可见）；留存 200 条/30 天写入时 prune；站长/平台均无查询端点（决策#46）。';

CREATE INDEX IF NOT EXISTS idx_chat_message_user_site
  ON chat_message (user_id, site_id, created_at DESC);
