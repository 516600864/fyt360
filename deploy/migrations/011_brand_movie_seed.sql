-- 011: 影票插件轨（D先生 2026-09-27 确认第二批品牌三轨）
-- 折扣影票 mayi-movie 插件（provider wx459759608c80cf98），弃半屏 plugin-private 壳
-- 参数：movieuid={uid}（会员ID，端点动态替换）/ movieapikey={apikey}（蚂蚁 key，跟站点走）
--       index=我们小程序首页 / homepath=我们"我的"页（会员中心）
--       pay 缺省=插件内支付（返佣模式，企业认证小程序）；moviekefu 暂无客服页不传
-- 注意：本条为显式覆盖（轨道变更），非 009 的只填空壳语义
UPDATE brand_action_cfg
   SET action_type = 'plugin',
       miniapp_cfg = jsonb_build_object(
         'mode', 'plugin',
         'path', 'plugin://mayi-movie/index?movieuid={uid}&movieapikey={apikey}&index=/pages/index/index&homepath=/pages/mine/index'
       )
 WHERE brand_code = 'life_01'
   AND name = '折扣电影票';
