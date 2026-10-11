-- 045: 结算配置站点级化（docs/结算配置站点级化设计评审.md，方案 A）
-- ① member_level 加 site_id（全站一份 → 每站一份档位行），member 重绑到本站行
-- ② platform_config 加 site_id 维度（NULL=平台键），三键按站 seed
-- 幂等：连跑两次 OK

-- ── ① member_level 按站化 ─────────────────────────────────────────
ALTER TABLE member_level ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES site(site_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_level_code_key') THEN
    ALTER TABLE member_level DROP CONSTRAINT member_level_code_key;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'member_level_site_code_uk') THEN
    ALTER TABLE member_level ADD CONSTRAINT member_level_site_code_uk UNIQUE (site_id, code);
  END IF;
END $$;

-- 存量行（原来全站一份）归到 site-a 作种子
UPDATE member_level
   SET site_id = (SELECT site_id FROM site WHERE code = 'site-a' LIMIT 1)
 WHERE site_id IS NULL;

-- 复制种子到其余 active 站点（幂等：ON CONFLICT 跳过）
INSERT INTO member_level (site_id, code, name, sort, ingot_price, self_rate, direct_rate, team_rate, team2_rate, icon, "desc", status)
SELECT s.site_id, m.code, m.name, m.sort, m.ingot_price, m.self_rate, m.direct_rate, m.team_rate, m.team2_rate, m.icon, m."desc", m.status
  FROM site s
  CROSS JOIN member_level m
 WHERE m.site_id = (SELECT site_id FROM site WHERE code = 'site-a' LIMIT 1)
   AND s.status = 'active'
   AND s.site_id <> (SELECT site_id FROM site WHERE code = 'site-a' LIMIT 1)
ON CONFLICT (site_id, code) DO NOTHING;

-- member 重绑：指向本人所属站点的同 code 档位行
UPDATE member mm
   SET level_id = nl.level_id
  FROM "user" u,
       member_level ol,
       member_level nl
 WHERE mm.user_id = u.user_id
   AND ol.level_id = mm.level_id
   AND nl.site_id = u.site_id
   AND nl.code = ol.code;

ALTER TABLE member_level ALTER COLUMN site_id SET NOT NULL;

-- ── ② platform_config 加站点维度 ─────────────────────────────────
-- 平台键保留 site_id IS NULL；原单列 PK 必须删（否则站点行插不进），
-- 但复合 PK(key, site_id) 不容 NULL → 用表达式唯一索引（COALESCE 把 NULL 归零哨兵）
ALTER TABLE platform_config ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES site(site_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_config_pkey') THEN
    ALTER TABLE platform_config DROP CONSTRAINT platform_config_pkey;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS platform_config_key_site_uk
  ON platform_config (key, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 三键复制到每站（以平台行为模板；平台行保留作 fallback）
INSERT INTO platform_config (key, site_id, value, updated_by)
SELECT k.k, s.site_id, p.value, NULL
  FROM site s
  CROSS JOIN (VALUES ('ingot_rule'), ('withdraw_rule'), ('dist_alloc')) AS k(k)
  LEFT JOIN platform_config p ON p.key = k.k AND p.site_id IS NULL
 WHERE s.status = 'active'
ON CONFLICT (key, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;
