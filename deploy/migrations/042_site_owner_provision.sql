-- 042：站点负责人 + 待开通状态 + 删除 site 表冗余支付列（决策 #43，D先生 2026-10-05）
--
-- 需求背景（屏 31 收敛成「建壳 + 授权」/ 屏 52 凭据开通向导）：
--   平台只建壳，绝不碰凭据。凭据是钱袋子，必须由客户自己登录本站配置。
--   站点负责人 = admin_user_site.is_owner，一站唯一，是该站凭据的唯一配置人。
--
-- ═══ ① admin_user_site.is_owner ═══
--   ⛔ 真相源只在 admin_user_site.is_owner，**不建 site.owner_admin_id**
--      （两处都存必然漂移；这是本迁移存在的唯一理由）。
--   一站唯一负责人：部分唯一索引，同一 site_id 只能有一行 is_owner=true。
--   停用成员不能当负责人 —— 由服务端在移交时校验 status='active'。
--
-- ═══ ② site.status 加 'pending'（待开通）╔══
--   停用复用 status 而非删除站点（历史订单/审计要留痕）。
--   pending = 已建壳未配蚂蚁星球凭据或连通测试未过，后台侧栏白名单拦截（决策 #43）。
--   ⚠️ 原 CHECK 是 (active, disabled)，必须先 DROP 再 ADD。
--
-- ═══ ③ provider_config 连通测试留痕 ═══
--   「已开通」判定必须有**测试通过**这一环，光有 key 不足以判定开通。
--   test_status: untested | passed | failed；结果落这两列，不塞 config jsonb
--   （jsonb 里查不出索引，且 jsonb 改完必须回读断言，徒增排查成本）。
--
-- ═══ ④ 删除 site 表三列冗余支付字段 ═══
--   真相源是 site_payment（021 建表，mch_id/mch_key/serial_no/cert）。
--   这三列全项目**零写入路径**、实测全 NULL，是 001 建表时的重复设计。
--   ⛔ shop_addr **不删**：它不是支付字段，是门店地址（决策 #25⑥），
--      有真实消费方 site.ts /kf 接口的线下兜底文案。

-- ① admin_user_site.is_owner
ALTER TABLE admin_user_site ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN admin_user_site.is_owner IS
  '是否该站负责人。一站唯一（见 uniq_site_owner 索引），是该站凭据的唯一配置人（决策#43）。真相源仅此一处，⛔不另建 site.owner_admin_id。';

-- 一站唯一负责人：部分唯一索引（该站至多一个 is_owner=true）
CREATE UNIQUE INDEX IF NOT EXISTS uniq_site_owner
  ON admin_user_site (site_id) WHERE is_owner;

-- 回填：已授权成员中最早创建的一条设为负责人（幂等：已有负责人则不动）
WITH pick AS (
  SELECT DISTINCT ON (us.site_id) us.site_id, us.admin_id
    FROM admin_user_site us
    JOIN admin_user a ON a.admin_id = us.admin_id
   WHERE NOT EXISTS (SELECT 1 FROM admin_user_site x WHERE x.site_id = us.site_id AND x.is_owner)
   ORDER BY us.site_id, us.id
)
UPDATE admin_user_site us
   SET is_owner = TRUE
  FROM pick
 WHERE us.site_id = pick.site_id AND us.admin_id = pick.admin_id AND NOT us.is_owner;

-- ② site.status 加 pending
ALTER TABLE site DROP CONSTRAINT IF EXISTS site_status_check;
ALTER TABLE site ADD  CONSTRAINT site_status_check CHECK (status IN ('active','disabled','pending'));

COMMENT ON COLUMN site.status IS
  'pending=待开通（已建壳未配蚂蚁星球凭据或连通测试未过，后台白名单拦截，决策#43）| active=运行中 | disabled=已停用（复用状态而非删除，保留订单与审计留痕）。';

-- ③ provider_config 连通测试留痕
ALTER TABLE provider_config
  ADD COLUMN IF NOT EXISTS test_status  VARCHAR(16) NOT NULL DEFAULT 'untested',
  ADD COLUMN IF NOT EXISTS test_message TEXT         NULL,
  ADD COLUMN IF NOT EXISTS tested_at   TIMESTAMPTZ   NULL;

ALTER TABLE provider_config DROP CONSTRAINT IF EXISTS provider_config_test_status_check;
ALTER TABLE provider_config ADD CONSTRAINT provider_config_test_status_check
  CHECK (test_status IN ('untested','passed','failed'));

COMMENT ON COLUMN provider_config.test_status IS
  '连通性测试结果：untested=从未测 | passed=拉取成功（仅 mayixingqiu 会写）| failed=上游报错。站点「已开通」判定要求 mayixingqiu 这一行 test_status=passed。';
COMMENT ON COLUMN provider_config.test_message IS '最近一次测试的上游错误信息（脱敏后，供管理台排查，不含凭据原文）。';
COMMENT ON COLUMN provider_config.tested_at IS '最近一次连通性测试时间。';

-- 回填存量活跃站点的连通状态。
-- ⛔ 不能一律置 'untested'：存量站点在本次迁移前**已经在真实运行**（有订单/看板数据），
--    一律置 untested 会让「已开通」判定把它们全锁死，把生产站打成「待开通」——
--    这是迁移制造的事故，不是保护。实测踩过：site-a 被 403 拦掉。
-- 口径：迁移前 status='active' 的站 = 事实上已通过连通（否则它跑不起来），
--      回填 passed 并在 test_message 里注明豁免来源，保持可追溯；
--      新建站配了 key 但没测 → 仍是 untested，**不算开通**（两条语义互不干扰）。
UPDATE provider_config pc
   SET test_status = 'passed',
       test_message = '迁移 042 存量豁免：该站点在迁移前已处于 active 运行状态（未追溯重测）',
       tested_at = COALESCE(pc.tested_at, now())
  FROM site s
 WHERE s.site_id = pc.site_id
   AND pc.provider = 'mayixingqiu'
   AND pc.test_status = 'untested'
   AND s.status = 'active';

-- ④ 删除 site 表三列冗余支付字段（真相源在 site_payment；⚠️ 保留 shop_addr）
--
-- ⛔⛔ 幂等守卫：三列在首次执行后已被 DROP，重放本文件时下面这段若还直接引用
--    `s.pay_mch_id` 会报 `42703 column does not exist` —— **迁移脚本必须能重复跑**
--    （deploy.mjs 六阶段全幂等，migrate.mjs 每次部署都重放全部 SQL）。
--    故整段包在 information_schema 判定里：列已不存在则整段跳过。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'site' AND column_name = 'pay_mch_id'
  ) THEN
    -- ⛔ 四列须同时非空才搬：site_payment 的 mch_key/serial_no/cert 都是 NOT NULL，
    --   只搬 mch_id 会因缺列直接失败，把迁移整条卡死（宁可漏搬也不能搬崩）。
    EXECUTE $q$
      INSERT INTO site_payment (site_id, mch_id, mch_key, serial_no, cert, commission_rate, status)
      SELECT s.site_id, s.pay_mch_id, s.pay_api_v3_key, s.pay_serial_no, '', 0.2000, 'disabled'
        FROM site s
       WHERE s.pay_mch_id IS NOT NULL AND s.pay_mch_id <> ''
         AND s.pay_api_v3_key IS NOT NULL AND s.pay_api_v3_key <> ''
         AND s.pay_serial_no IS NOT NULL AND s.pay_serial_no <> ''
         AND NOT EXISTS (SELECT 1 FROM site_payment p WHERE p.site_id = s.site_id)
    $q$;

    EXECUTE 'ALTER TABLE site DROP COLUMN IF EXISTS pay_mch_id';
    EXECUTE 'ALTER TABLE site DROP COLUMN IF EXISTS pay_api_v3_key';
    EXECUTE 'ALTER TABLE site DROP COLUMN IF EXISTS pay_serial_no';
  END IF;
END $$;