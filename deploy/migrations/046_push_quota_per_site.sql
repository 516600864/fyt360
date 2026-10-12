-- 046: user_push_quota 主键站点化（2026-10-12 D先生 钦定）
-- 问题：主键 (user_id) 全局唯一，无 site 维度；而订阅链路全按站走（候选 SQL q.site_id、
--       subscribe 传 siteId）→ 多站授权时 ON CONFLICT (user_id) 只加 quota 不改 site_id，
--       额度全记在首个站名下，另一站提醒任务查不到 = 额度串站（结构隐患，单站数据期实锤）。
-- 修法：PK 改 (user_id, site_id)；现有数据每 user 仅一行（旧 PK 保证），直接重建无冲突。
-- 幂等：判旧约束定义存在才动；连跑两次 OK。
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'user_push_quota'::regclass
       AND conname = 'user_push_quota_pkey'
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (user_id)'
  ) THEN
    ALTER TABLE user_push_quota DROP CONSTRAINT user_push_quota_pkey;
    ALTER TABLE user_push_quota
      ADD CONSTRAINT user_push_quota_pkey PRIMARY KEY (user_id, site_id);
  END IF;
END $$;
