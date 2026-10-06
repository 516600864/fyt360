-- 040：企业微信客服接入配置（site 级）
--
-- 需求（D先生 2026-10-05）：
--   小程序端 + H5 端接入企业微信客服，企业ID（corpId）与客服链接在后台「系统设置」维护，
--   并在该屏做文字接入说明（去哪里取 corpId / 客服链接、小程序后台怎么绑定、常见坑）。
--
-- 存储口径：
--   ⛔ **跟 site_id 走**（对齐决策 #27 站点隔离）：多租户下不同站点可能接入不同企业的客服，
--      放平台级会导致 A 站用户被 B 站的客服接待。
--   ⛔ **不塞 provider_config**：那张表是「上游供给方凭据」（蚂蚁星球/微信开放平台），
--      企微客服是**我方自有的服务通道**，语义不同类；混在一起会让「供应商凭据」矩阵
--      出现一个不是供应商的条目，破坏决策 #25① 的口径清晰性。
--   ⛔ 客服链接含 token（形如 https://work.weixin.qq.com/kfid/kfc_xxx?xxx），
--      属半敏感凭据：仅 C 端公开只读接口下发，管理台不回显完整串以外的任何敏感信息。
--
-- 字段语义：
--   kf_corp_id —— 企业ID（企业微信「我的企业」→ 企业信息 → 企业ID，ww 开头）
--                 仅小程序端 wx.openCustomerServiceChat 需要；H5 端不需要。
--   kf_url     —— 客服链接（企业微信「应用管理 → 应用 → 微信客服」→ 客服账号详情）
--                 小程序作为 extInfo.url 传入；H5 直接跳转；两端都作降级兜底。
--   kf_status  —— active/disabled。disabled 时 C 端接口返回 404，端上按「未开通」处理，
--                 保留配置而不删（避免误关后要重录 corpId）。

ALTER TABLE site
  ADD COLUMN IF NOT EXISTS kf_corp_id varchar(64)  NULL,
  ADD COLUMN IF NOT EXISTS kf_url      text         NULL,
  ADD COLUMN IF NOT EXISTS kf_status   varchar(16)  NOT NULL DEFAULT 'disabled';

COMMENT ON COLUMN site.kf_corp_id IS
  '企业微信企业ID（ww 开头）。仅小程序端 wx.openCustomerServiceChat 需要，H5 端不用。';
COMMENT ON COLUMN site.kf_url IS
  '企业微信客服链接（work.weixin.qq.com/kfid/...，含 token）。小程序作 extInfo.url 传入，H5 直接跳转；两端共用为降级兜底。';
COMMENT ON COLUMN site.kf_status IS
  'active=已开通（端上正常呼起客服）| disabled=未开通（端上隐藏入口或提示）。仅 kf_corp_id 与 kf_url 均非空时才允许置 active。';
