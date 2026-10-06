-- 018: 移除 13 个无对应蚂蚁活动的空壳品牌行（点击即 404，D先生 2026-09-27 拍板移除）
-- 对应活动在蚂蚁 actlist 193 项中不存在（免单/抽奖/大促类短期营销名），如后续蚂蚁上架可重新 INSERT
DELETE FROM brand_action_cfg WHERE brand_code IN (
  'eleme_18',   -- 惊喜福利
  'eleme_19',   -- 闪购一免单
  'eleme_20',   -- 囤券券
  'meituan_11', -- 万物免单
  'meituan_14', -- 抽免单
  'meituan_19', -- 爆品一口价
  'meituan_20', -- 关爱父母
  'meituan_30', -- 饿了么爆款特价
  'pdd_09',     -- 官方大促
  'pdd_10',     -- 超级满减
  'pdd_12',     -- 三单挑战
  'taxi_03',    -- 滴滴顺风车
  'vip_08'      -- 唯品快抢
);
