-- 034：订单 provider 与蚂蚁星球 pf_type 对齐（D先生 2026-10-04 决策）
--
-- 背景：pforder 是「平台活动」聚合接口，每条带 pf_type（真正的平台归属），
--       之前全塞进单一 'pf' 桶。改为按 pf_type 落语义化 provider，与 v1 联盟接口
--       的 jd/pdd/tb/vip 同桶去重（同一平台两个视角 = 同一笔钱，不能算两遍）。
--
-- 本迁移只处理**历史存量** 'pf' 桶的单：按其 goods_snapshot->>'pfType' 改写 provider
-- 与 order_sn 前缀（幂等键必须一起改，否则 upsert 会插重复单）。
--
-- ⚠️ **只改有 pfType 留档的行**。旧版代码没把 pfType 写进 goods_snapshot，
--    这类行 pfType 为 NULL —— 绝不能瞎猜成 'other'（实测该单 pf_type 实为 30=饿了么，
--    猜 other 会把收益归错桶）。留待下次同步按新逻辑 upsert 时自然覆盖
--    （provider 变了 → order_sn 前缀变了 → 新插一条，旧 pf 单留在库里当历史留档；
--    若需清理，后续按 goods_snapshot->>'providerOrderSn' 反查确认后单独处理）。
--
-- 幂等：靠「provider='pf' 且 goods_snapshot 里有 pfType」双重条件收敛，重复执行 0 行。

UPDATE "order"
   SET provider = CASE (goods_snapshot->>'pfType')::int
         WHEN 1  THEN 'jd'  WHEN 2  THEN 'pdd'     WHEN 3  THEN 'tb'
         WHEN 6  THEN 'vip' WHEN 7  THEN 'meituan' WHEN 13 THEN 'meituan'
         WHEN 14 THEN 'other' WHEN 15 THEN 'ks'    WHEN 16 THEN 'meituan'
         WHEN 30 THEN 'eleme' WHEN 31 THEN 'didi'   WHEN 32 THEN 'local'
         WHEN 34 THEN 'liucard' WHEN 40 THEN 'fzy'
         ELSE 'other' END,
       order_sn = CASE (goods_snapshot->>'pfType')::int
         WHEN 1  THEN 'jd'  WHEN 2  THEN 'pdd'     WHEN 3  THEN 'tb'
         WHEN 6  THEN 'vip' WHEN 7  THEN 'meituan' WHEN 13 THEN 'meituan'
         WHEN 14 THEN 'other' WHEN 15 THEN 'ks'    WHEN 16 THEN 'meituan'
         WHEN 30 THEN 'eleme' WHEN 31 THEN 'didi'   WHEN 32 THEN 'local'
         WHEN 34 THEN 'liucard' WHEN 40 THEN 'fzy'
         ELSE 'other' END
       || substring(order_sn from length('pf:') + 1),
       updated_at = now()
 WHERE provider = 'pf'
   AND order_sn LIKE 'pf:%'
   AND goods_snapshot ? 'pfType'
   AND COALESCE((goods_snapshot->>'pfType')::int, 0) > 0;
