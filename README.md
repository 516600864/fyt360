# FYT360 · 吃喝玩乐购 一站全变现

> 开源一站式全域流量变现 SaaS。多租户多站点（`site_id` 为业务隔离键），uni-app 三端（小程序 / H5 / 后台）+ PostgreSQL + 腾讯云 CloudBase。

## 快速开始

```bash
# 1. 装依赖
npm install

# 2. 配环境变量（复制模板后填自己的值）
cp .env.example .env

# 3. 一键部署（迁移 → seed → 构建三端 → 静态托管 → 云托管容器 → 定时器）
node deploy/scripts/deploy.mjs
```

`deploy.mjs` 六个阶段全部幂等，重复执行安全：

| 阶段 | 内容 | 脚本 |
|---|---|---|
| 1/6 | 环境校验 | — |
| 2/6 | schema迁移 | `migrate.mjs` |
| 3/6 | 初始数据 | `seed.mjs` |
| 4/6 | 构建 + 静态托管 + 云托管容器 | `hosting-deploy.mjs` / `container-deploy.mjs` |
| 5/6 | **定时任务自动部署** | `function-deploy.mjs --job=all` |
| 6/6 | 交付输出 | — |

## 定时任务：全自动，零手工配置

**不需要在 CloudBase 控制台点任何东西。** 定时任务走云函数（SCF timer）实现，部署脚本用 `.env` 里的 `TCB_SECRET_ID/KEY` 通过 OpenAPI 幂等创建函数与触发器，并把 HMAC token 注入函数环境变量。

```
SCF timer（每 5 分钟）
  → ordersweep-timer（云函数）
    → HTTPS POST https://<域名>/api/jobs/ordersweep/cron?token=<HMAC>
      → 云托管容器：关单 + 退券 + 回补库存
```

已注册的任务：

| 任务 | 函数名 | 周期 | 端点 |
|---|---|---|---|
| 订单同步 | `ordersync-timer` | 每 30 分钟 | `/api/jobs/ordersync/cron` |
| 签到提醒 | `checkin-remind-timer` | 每日 09:00 | `/api/jobs/checkin-remind/cron` |
| 未支付单关单 | `ordersweep-timer` | 每 5 分钟 | `/api/jobs/ordersweep/cron` |

**新增一个定时任务**（三步，无需碰控制台）：

1. `deploy/scripts/function-deploy.mjs` 的 `JOBS` 注册表加一行：

   ```js
   'my-job': {
     funcName: 'my-job-timer',
     funcDir: 'my-job-timer',            // 目录名必须=函数名（SCF packer 约定）
     triggerName: 'my-job-hourly',
     cron: '0 0 * * * * *',              // 7 字段：秒 分 时 日 月 周 年（北京时间）
     url: 'https://<域名>/api/jobs/my-job/cron',
     hmac: 'my-job',                     // 与 server/src/routes/jobs.ts 的 cronToken(name) 同名
     envPrefix: 'JOB',
     desc: '...',
     envExtra: {},
   },
   ```

2. 复制 `deploy/functions/checkin-remind-timer/index.js` → `deploy/functions/my-job-timer/index.js`（通用单 POST 桥，零依赖）
3. `node deploy/scripts/function-deploy.mjs --job=my-job --invoke`

服务端对应加一个 `POST /api/jobs/my-job/cron` 端点，用 `cronToken('my-job')` 校验即可。

单独重部 / 改周期：

```bash
node deploy/scripts/function-deploy.mjs --job=ordersweep          # 单个
node deploy/scripts/function-deploy.mjs --job=all --invoke       # 全量 + 立即各调一次
node deploy/scripts/print-cron-token.mjs                          # 打印各任务回调 URL（排查用）
```

> 为什么不用云托管原生定时触发器：CloudBase 云托管 API 只开放 `TimerScale`（定时扩缩容），没有「定时发 HTTP 请求」的触发器类型。云函数 timer 全程可 API 配置，才是开源可复用的正确姿势。

## 目录结构

```
apps/
  mini/      uni-app 小程序（C 端，25 屏）
  h5/        uni-app H5（首页 + 淘口令中转）
  admin/     Vue3 + Element Plus 后台（19 屏）
server/      Express + TypeScript 服务端（云托管容器）
packages/
  renderer/  Schema 装修渲染器（与 admin 预览双实现须同步）
deploy/
  migrations/    SQL 迁移（幂等，现至 031）
  functions/     SCF 定时器桥函数
  scripts/       部署 / 迁移 / 验证脚本
  seed/          初始数据
docs/            设计文档
```

## 验证脚本

`deploy/scripts/verify-*.mjs` 均为打线上真实接口的 E2E，改完必跑：

| 脚本 | 覆盖 |
|---|---|
| `verify-coupon-loop.mjs` | 优惠券全闭环 32 项 |
| `verify-order-lifecycle.mjs` | 订单状态机 + 券释放 36 项 |
| `verify-members.mjs` | 会员管理 19 项 |
| `verify-theme-coverage.mjs` | 全站换肤 10 项 |
| `verify-cron-autotrigger.mjs` | 定时器真实触发（造超时单后纯等SCF 自己跑） |

## 部署验收铁律

**三端三层，逐项实锤**：源码 → 构建产物 → 线上接口。禁止口头交付。

```bash
# 1. 源码
git diff --stat
# 2. 构建产物
ls -la apps/admin/dist/assets/ apps/h5/dist/build/h5/
# 3. 线上接口
curl -s https://<域名>/healthz
```
<img width="2880" height="5026" alt="admin-52-站点凭据开通向导" src="https://github.com/user-attachments/assets/c10ff55c-4205-4c04-88c1-748d1dd258fe" />
<img width="2880" height="1547" alt="20e505e4-5f66-4e22-b34c-2ee917160b7a" src="https://github.com/user-attachments/assets/0d3f222f-fd00-4e07-ae23-d97500fa2029" />
<img width="33%" height="7454" alt="942433334ca2684741dcd0cdcbf4da79" src="https://github.com/user-attachments/assets/af90d995-0696-4493-8a78-11584049891d" />
<img width="33%" height="7454" alt="143796a9f55255fc6f596b9b0ca9124b" src="https://github.com/user-attachments/assets/7d701b32-6cbd-4219-a322-0ebbba357cb9" />
<img width="33%" height="7454" alt="5b65a2b722e602695b3d57f507217290" src="https://github.com/user-attachments/assets/b756eccf-3f21-46d0-933d-10b293ae34cd" />


## 开发铁律：上游调用与图标

**第三方 API 调用**

- 所有外部 `fetch` **必须带 `AbortSignal` 超时**。项目里已有 `hjkCall()`（12s 超时 + 重试 + 限频），但曾有 4 处绕过它裸调fasttype，上游冷启动 10.5s 把 C 端遮罩拖成假死。
  自查：`grep -rn "api-gw.haojingke.com" server/src` 应只出现在 `lib/haojingke.ts` 内。
- **全量静态目录类上游**（如 fasttype 81 条权益档位）统一走 `fetchFasttype(apikey, uid, force?)`：
  8s 超时 + 5min 进程内 TTL 缓存 + 在途请求去重。分钟级不变的数据不要每次重拉。
- **前端 loading 遮罩必须有硬超时上限**（`Promise.race`）。任一数据域挂死 = 整页假死。
  `utils/request.js` 已设默认 20s 超时并把平台 timeout 报错转成可读文案。
- **上游返回必须校验「完整度」，不能只判类型**。实测蚂蚁 fasttype 会**瞬时返回残缺目录**
  （同一 apikey 连续请求出现 47 条 vs 完整 81 条，肯德基等整组消失）。只判 `Array.isArray`
  就写缓存，会把残缺响应固化 5 分钟，叠加 `/service-search` 的 60s 结果级缓存后放大到数分钟——
  症状是「搜某品牌查不到权益，但直连上游完全正常」，极难定位。
  现已加两道闸：`fetchFasttype` 低于 `FASTTYPE_MIN_ITEMS`（20）判残缺不写缓存；
  `searchRightsTrack` 返回 `degraded` 标记，权益轨降级时 `/service-search` 不写结果缓存。
- **`SELECT col::text` 后 `ORDER BY col`（无别名）会按字典序排**。PG 会把无别名的 `ORDER BY`
  解析到 SELECT 里的 text 输出列，`'1000' < '600'` → 权重最高的排在末尾。
  修法：排序用**原始数值列**（`ORDER BY t.weight` 或带表别名 `ORDER BY h.weight`），
  数值转字符串只放在 SELECT 投影里。这是网关「参数须全字符串」铁律的隐蔽副作用。
- **多层缓存会放大残缺数据**。进程内缓存（5min）+ 端点结果级缓存（60s）+ 容器多副本各自冷启动，
  任一层拿到残缺响应都会放大成数分钟的用户可见故障。降级路径必须显式标记并跳过所有写缓存。

**图标**

- 上游返回的图片 URL **先实测状态码再决定用不用**。已知问题域：
  某第三方权益图床（图片 URL 含中文未编码，实测 403）、`img14.360buyimg.com`（不在小程序 downloadFile 白名单）。
- **商标/品牌类图标一律用「首字 + emoji 背景装饰」**：首字为识别主体（玫红 900 字重），分类 emoji 降为右下角低透明度装饰。
  零网络请求、零白名单风险、不会白板。参考实现 `search-result.vue` 的 `firstChar()` + `.bc-icon-letter`。
- 自有商品图（`self_goods.main_imgs`）走自家CDN，可正常用 `<image>`。

## License

[Apache-2.0](./LICENSE) —— 含显式专利授权，商用请保留版权与 NOTICE 声明。
