# sites/ 站点构建期配置（决策 #48）

## 租户自助下载（正式链路，零部署零 config）

小程序构建期差异只有三个值：`SITE_CODE`、`appid`、`projectname`——**全部在下载时由服务端实时注入**：

1. 租户在开通向导（屏 52）配置小程序凭据（appid + secret）→ `provider_config('wechat_mini')`
2. 调 `GET /api/admin/sites/:code/miniprogram`（平台超管或该站负责人）→ 实时生成专属 zip 下发
3. 微信开发者工具导入 zip 解包目录 → 预览/上传/提审/发布

模板包 = 部署时 `export-miniprogram-assets.mjs` 打的 `miniprogram-template.zip`（随镜像内置），平台小程序发新版 = 正常发一次 API 部署即可。包内零凭据（secret 全在服务端 DB），业务数据运行时从 `mk.fyt360.cn` 按 site 拉取——**泄包不泄密**。

未配置小程序凭据的站返回 409 `SITE_MINI_NOT_CONFIGURED`；跨站下载 403（assertSiteAccess）。

## 本地多站调试（开发用，与自助下载无关）

要在本机构建某个站的包调试时：

1. `sites/<code>/config.json`：`{ "code": "<code>", "name": "<站点名>", "appid": "<wx 开头>" }`
2. `FYT_SITE=<code> npm run build:mp-weixin --prefix apps/mini`（默认 site-a，行为不变）
3. 产物副本 `apps/mini/dist/sites/<code>/`，开发者工具直接导入

## 租户侧前置条件（提审前一次性，见下载页指引）

| 项 | 在哪配 | 说明 |
|---|---|---|
| request 合法域名 | mp.weixin.qq.com → 开发设置 | 加 `https://mk.fyt360.cn`，**忘配 = 登录/接口全挂** |
| 小程序类目 | mp.weixin.qq.com | 含 AI 对话功能的站需 AI 类目资质（每个 appid 单独审） |
| 上传权限 | 成员管理 | 上传者需该 appid 的开发者权限 |
