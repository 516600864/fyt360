-- 035：CPS 订单补「上游状态更新时间」列
--
-- 背景（D先生 2026-10-04 提问「下单时间是不是搞错了」）：
--   pforder 走 querytype=2，即**按 updated_at（状态更新时刻）筛窗口**，
--   但响应里落库用的是 ordertime（下单时刻）→ paid_at。
--   两者错位 12~31 天（实测下单→结算 p50=295h、max=760h），
--   导致「窗口按更新时间走、数据按下单时间存」，结构性漏单。
--
-- 本迁移：
--   1. 补 platform_updated_at —— 上游最近一次状态更新时间（权威的「窗口游标」）。
--   2. 补 biz_category / biz_channel —— 订单业务类型（问 2：不能只显示 CPS 供应链）。
--      biz_category = 一级分类（电商/本地生活/点餐/影票/充值/出行）
--      biz_channel  = 二级平台（京东/拼多多/美团/饿了么…）
--   3. 历史回填：pfType 已留档的行可从快照反推分类。
--
-- ⚠️ 不动 paid_at/settled_at 语义：
--    paid_at = 下单时间（ordertime）、settled_at = 完成时间（finishtime），
--    二者都是**业务事实**，本来就该是下单/完成时刻，不改。

ALTER TABLE "order"
  ADD COLUMN IF NOT EXISTS platform_updated_at timestamptz NULL;

ALTER TABLE "order"
  ADD COLUMN IF NOT EXISTS biz_category varchar(32) NULL;

ALTER TABLE "order"
  ADD COLUMN IF NOT EXISTS biz_channel varchar(32) NULL;

COMMENT ON COLUMN "order".platform_updated_at IS
  '上游平台最近一次状态更新时间（pforder 的 updated_at / v1 联盟的修改时间）。同步窗口游标用这个，不是 paid_at。';
COMMENT ON COLUMN "order".biz_category IS
  '订单业务一级分类：self(到店团购)/ecommerce(电商返佣)/local(本地生活)/dining(点餐)/movie(影票)/recharge(充值)/other';
COMMENT ON COLUMN "order".biz_channel IS
  '订单业务二级渠道：京东/拼多多/淘宝/美团/饿了么/滴滴/唯品会…（provider 的中文名）';

-- 建索引：同步按 platform_updated_at 找增量
CREATE INDEX IF NOT EXISTS idx_order_platform_updated
  ON "order" (site_id, platform_updated_at DESC)
  WHERE platform_updated_at IS NOT NULL;

-- 订单中心列表按分类筛
CREATE INDEX IF NOT EXISTS idx_order_biz
  ON "order" (site_id, biz_category)
  WHERE biz_category IS NOT NULL;

-- ---------------- 历史回填 ----------------
-- ① 自营（provider=self）→ 到店团购
UPDATE "order" SET biz_category = 'self'
WHERE provider = 'self' AND (biz_category IS NULL OR biz_category = '');

-- ② 自营电商（provider=self 且 platform 区分）暂不细分，保持 self
-- ③ CPS 桶 → 按 provider 映射一级分类
UPDATE "order" o SET biz_category = v.cat
FROM (VALUES
  ('jd', 'ecommerce'), ('pdd', 'ecommerce'), ('tb', 'ecommerce'), ('vip', 'ecommerce'),
  ('meituan', 'local'), ('eleme', 'dining'), ('didi', 'local'),
  ('local', 'local'), ('liucard', 'recharge'), ('fzy', 'ecommerce'),
  ('ks', 'ecommerce'), ('other', 'other'),
  ('dc', 'dining'), ('movie', 'movie'), ('recharge', 'recharge')
) AS v(p, cat)
WHERE o.provider = v.p AND (o.biz_category IS NULL OR o.biz_category = '');

-- ④ 尚未同步的三类（历史不存在）也先落分类规则，供后续代码对齐
-- ⑤ 用 pfType 兜底：pf_type 与 provider 同源，快照留档的行可交叉校验
UPDATE "order" o SET biz_channel = v.ch
FROM (VALUES
  ('jd', '京东'), ('pdd', '拼多多'), ('tb', '淘宝'), ('vip', '唯品会'),
  ('meituan', '美团'), ('eleme', '饿了么'), ('didi', '滴滴'),
  ('local', '本地生活'), ('liucard', '流量卡'), ('fzy', '飞猪'),
  ('ks', '快手'), ('other', '其他'),
  ('dc', '点餐'), ('movie', '电影票'), ('recharge', '充值'),
  ('self', '自营')
) AS v(p, ch)
WHERE o.provider = v.p AND (o.biz_channel IS NULL OR o.biz_channel = '');

-- ⑤ 历史单水位回填（2026-10-04 实测：修复前入库的单全为 NULL）
--    v1 联盟接口（tb/pdd 等）没有独立 updated_at 字段，只能用业务时间兜底当游标。
--    优先 settled_at（状态推进到完成的时刻）> paid_at（下单）> created_at（入库时刻）。
--    ⚠️ 这只是「近似游标」：宁可窗口略宽多扫，也不能留 NULL —— 水位为 NULL 会让
--    syncWatermark 判定「无水位」而回退固定窗口，重新引入漏单。
UPDATE "order"
   SET platform_updated_at = COALESCE(settled_at, paid_at, created_at)
 WHERE platform_updated_at IS NULL;
