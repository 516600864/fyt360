-- 005_fix_site_appid.sql：回填 site-a 小程序 appid（2026-09-23）
-- 背景：appid 已写死 manifest.json（防 touristappid），但站点库字段一直为空；
--       站点管理屏（admin-31）以 site.appid 为「小程序数」真源，需同步。
-- 幂等：仅当为空时回填，不覆盖手工配置。
UPDATE site
   SET appid = 'wxfa90eb07dc63070e'
 WHERE code = 'site-a'
   AND (appid IS NULL OR appid = '');
