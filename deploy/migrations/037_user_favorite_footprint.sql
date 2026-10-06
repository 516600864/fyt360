-- 037：我的收藏 / 浏览足迹（决策 #41，画布 mini-06B / mini-06C 增补稿）
--
-- 背景：
--   MineView 功能宫格里「我的收藏」「浏览足迹」是两个**无 url 的死占位**，点击只会 toast「建设中」。
--   决策 #41 落地这两页。两张表的共同铁律（下面逐条说明，因为每条都是踩过的坑）：
--
-- ⛔① **只存指针，不存快照**
--    撞「CPS 商品不入库」铁律：CPS 商品 / 到店服务 / 权益兑换的**价格、库存、上下架状态全在上游**，
--    我方只存一个「入口指针」。点击时重新透传（走 handleAction / 商详接口）拿最新价。
--    → 所以两表都**没有 price / stock / status 字段**，也**不做定时同步**。
--    → 代价是**必须有失效态**：上游把商品下架了，指针还在但打不开 → UI 要能显示「已下架」。
--
-- ⛔② **title 必须冗余一份**
--    列表每行都渲染名称。如果 title 靠点击时回查上游，瀑布流会每行发一次请求 → 卡死。
--    冗余 title 的代价就是①的失效态，用「已下架」兜住，这是有意识的取舍。
--    冗余的是**展示用快照**，不是业务数据，不参与任何价格/库存口径。
--
-- ⛔③ **两表都带 site_id（跟站点不跟人）**
--    决策 #27铁律：后台会话永远单站、服务商品站点独有。
--    若跟user_id 走，用户切到B 站就会看到 A 站的收藏 → 违反隔离。
--    唯一键都带 site_id，读写一律 WHERE site_id = 当前用户所属站。
--
-- ⛔④ **足迹有硬上限：最近 200 条 + 保留 30 天**
--    足迹是用户行为数据，会无限膨胀。写入后由应用层 prune（见me.ts pruneFootprints），
--    不做定时任务（无 cron 依赖，且清理成本极低）。
--    ⚠️ 隐私：足迹**仅供用户自己回看**，不得用于推荐 / 运营展示 / 跨站画像（产品红线）。

-- ================ 我的收藏 ================
CREATE TABLE IF NOT EXISTS user_favorite (
  id          bigserial PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  site_id     uuid        NOT NULL REFERENCES site(site_id)      ON DELETE CASCADE,
  -- 业务分类：到店服务 self_goods / 权益兑换 rights_brand（决策 #35：两类性质不同，列表不混）
  kind        varchar(32) NOT NULL DEFAULT 'self_goods',
  -- 指针：自营商品= self_goods.id；权益= brand_action_cfg.code
  ref_id      varchar(64) NOT NULL,
  title       varchar(160) NOT NULL,           -- ②冗余展示名，非业务数据
  icon_char   varchar(8)  NULL,                -- 首字/emoji 图标（上游无图，403 高发，故只存字符）
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_favorite_kind_chk CHECK (kind IN ('self_goods', 'rights_brand'))
);

-- 同一用户在同一站点收藏同一入口只留一条（重复收藏走 ON CONFLICT 更新 created_at → 相当于"置顶"）
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_favorite
  ON user_favorite (user_id, site_id, kind, ref_id);
-- 列表按收藏时间倒序
CREATE INDEX IF NOT EXISTS idx_user_favorite_list
  ON user_favorite (user_id, site_id, created_at DESC);

COMMENT ON TABLE user_favorite IS
  '我的收藏（决策 #41）。只存入口指针不存商品快照；title 冗余仅供列表渲染。收藏≠下单，价格库存以打开时为准。';
COMMENT ON COLUMN user_favorite.kind IS
  '业务分类：self_goods=到店服务 / rights_brand=权益兑换。决策 #35 两者性质不同，列表不得混块。';
COMMENT ON COLUMN user_favorite.title IS
  '冗余展示名（铁律②）。不可作为业务依据；商品改名后需重新收藏才会更新。';

-- ================ 浏览足迹 ================
CREATE TABLE IF NOT EXISTS user_footprint (
  id          bigserial PRIMARY KEY,
  user_id     bigint      NOT NULL REFERENCES "user"(user_id) ON DELETE CASCADE,
  site_id     uuid        NOT NULL REFERENCES site(site_id)      ON DELETE CASCADE,
  kind        varchar(32) NOT NULL DEFAULT 'self_goods',
  ref_id      varchar(64) NOT NULL,
  title       varchar(160) NOT NULL,
  icon_char   varchar(8)  NULL,
  viewed_at   timestamptz NOT NULL DEFAULT now(),   -- 归组（今天/昨天/更早）用这个
  CONSTRAINT user_footprint_kind_chk CHECK (kind IN ('self_goods', 'rights_brand'))
);

-- 同一用户在同一站点看同一入口只留**一条**（重复浏览刷新 viewed_at → 置顶，不堆重复）
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_footprint
  ON user_footprint (user_id, site_id, kind, ref_id);
-- 列表按浏览时间倒序；prune 超限时按此索引裁剪
CREATE INDEX IF NOT EXISTS idx_user_footprint_list
  ON user_footprint (user_id, site_id, viewed_at DESC);

COMMENT ON TABLE user_footprint IS
  '浏览足迹（决策 #41）。上限最近 200 条 + 保留 30 天，应用层 prune。⚠️隐私：仅供用户自己回看，禁止用于推荐/运营展示。';
COMMENT ON COLUMN user_footprint.viewed_at IS
  '最近一次浏览时间。重复浏览同一入口只更新此字段（不新增行），并据此做「今天/昨天/更早」分组。';