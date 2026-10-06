-- 038：收藏/足迹 kind 放宽到三类（补 037）
--
-- 背景（实现 06B/06C 时发现的口径缺口）：
--   037 的 CHECK 只允许 self_goods / rights_brand 两类，对应设计稿 06B 的两个筛选档。
--   但 **CPS 商品详情页（pages/goods/detail.vue，jd/tb/pdd/vip）也有一颗 ♡**，
--   决策 #41 明确要求把它接上（原来是点一下 toast「功能即将开放」的死占位）。
--   CPS 商品既不是到店团购、也不是权益兑换，塞进任一类都是撒谎。
--
--   → 新增第三类 cps_goods。CPS 商品**只存指针不存快照**（id +标题），
--     绝不落库价格 / 库存 / 图片 —— 与「CPS 商品不入库」铁律同源，不冲突。
--
-- 筛选口径：06B 顶部仍是三档（全部 / 到店服务 / 权益兑换，画稿定稿不动）；
--   cps_goods 只出现在「全部」下，副标显示「CPS 好物」。
--   若后续要给CPS 单开一档筛选，那是设计稿变更，需 D先生另行拍板，不在本迁移范围。

ALTER TABLE user_favorite    DROP CONSTRAINT IF EXISTS user_favorite_kind_chk;
ALTER TABLE user_footprint   DROP CONSTRAINT IF EXISTS user_footprint_kind_chk;

ALTER TABLE user_favorite
  ADD CONSTRAINT user_favorite_kind_chk
  CHECK (kind IN ('self_goods', 'rights_brand', 'cps_goods'));

ALTER TABLE user_footprint
  ADD CONSTRAINT user_footprint_kind_chk
  CHECK (kind IN ('self_goods', 'rights_brand', 'cps_goods'));

COMMENT ON COLUMN user_favorite.kind IS
  '业务分类：self_goods=到店服务 / rights_brand=权益兑换（决策 #35 两类性质不同，列表不混）/ cps_goods=CPS 商品入口（038 追加，只存指针）。';
COMMENT ON COLUMN user_footprint.kind IS
  '同user_favorite.kind：CPS 商品足迹同样只存指针 + 冗余标题，绝不落价格库存。';