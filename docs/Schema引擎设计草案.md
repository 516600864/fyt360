# Schema 引擎设计草案（评审稿 v1）

> 版本：2026-09-23 · 依据：需求文档 §2.3-3 / §6.1 + 决策#26 + 2026-09-22 D先生拍板记录
> 状态：**本轮已落地并上线**（mini + H5 首页双端消费），DIY 装修屏（33:908）与 AI 装修（40:1）为后续消费方。

## 1. 一句话结论

页面 = JSON Schema（page-v1 合同），`packages/renderer` 统一消费渲染；DIY 装修与 cloudbase-agent 都只产 Schema 不碰代码；mini 与 H5 **同稿同渲染器**（决策#26：小程序首页 3:218 = 唯一真相源）。

## 2. 架构与数据流

```
┌─────────────┐   产出/编辑    ┌──────────────┐
│ 后台 DIY 装修 │ ────────────▶ │ page_schema  │
│ (33:908)     │               │ (draft/published/offline, source=manual/ai)
├─────────────┤               └──────┬───────┘
│ AI 装修代理   │ ────────────────────┘   0417 LLM 产出同合同 Schema
│ (cloudbase-agent/40:1)
                              │ publish
                              ▼
                    GET /api/site/config
                    → home:{schema,version}      (mini 消费)
                    → h5_home:{schema,version}   (h5 消费，同稿副本)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
      apps/mini  pages/index            apps/h5  pages/index
      <SchemaPage :schema="cfg.home?.schema ?? defaultHome">
              │（sync-copy 构建前同步，见 §6）
              ▼
      packages/renderer（单源）
      SchemaPage → floors v-for → 楼层组件分发（显式 v-if，非动态组件）
```

要点：
- **端内回退**：无 published schema 时用内置 `default-home.json`（与 migration 003 seed 同源），断网/新站也能渲染。
- **楼层未知类型兜底**：渲染器渲染 `[type]` 占位框，不白屏——23 组件库随 DIY 里程碑补齐。
- **Action 协议**（§6.1 约定①）：`jump(page/h5/weapp) / plugin-launch / activity / popup / none`；本轮宿主实现 `jump(page)`（mini=navigateTo / h5=hash 跳转），其余 toast「功能建设中」。
- **数据源三模式**（约定②）：`manual`（props 内联）/ `category` / `platform_tab`；本轮 goods-feed 用 platform_tab。

## 3. 合同 v1（`packages/renderer/schema/page-v1.schema.json`，draft-07）

```jsonc
{
  "version": 1,
  "page": "home",             // home | home_h5 | ...
  "floors": [
    {
      "type": "goods-feed",    // 楼层类型 = 组件名（f- 前缀映射）
      "floor_id": "floor-xxx", // 埋点（约定④，与 component_id 一起上报）
      "component_id": "c-xxx",
      "props": { ... },        // 组件 props，纯数据
      "data_source": { "mode": "platform_tab", "params": { "tabs": ["jd","tb","pdd","vip","self"] } },
      "action": { "type": "jump", "target": "page", "value": "/pages/..." }
    }
  ]
}
```

硬约束：Schema 只含数据与动作声明，**不含样式代码**；颜色经 theme（§5）注入。

## 4. 组件映射（23 组件库进度）

本轮实现 6 个（首页所需）：

| 组件 | 楼层 | 数据 |
|---|---|---|
| f-swiper | banner 轮播 | manual（pics[]） |
| f-search-bar | 搜索框+签到有礼 | manual |
| f-nav | 金刚区 10 图标 | manual |
| f-coupon-strip | ¥20 券横条 | manual |
| f-brand-chips | 品牌补贴日 | manual |
| f-goods-feed | 平台 tab+双列商品流+返X角标 | platform_tab → GET /api/goods/{platform}/list |

其余 17 个随 DIY 屏里程碑按稿补（组件清单以画布 45 屏为准）。

## 5. 主题方案（约定③）

- 渲染器**零 SCSS 依赖**，组件只用 `var(--fyt-*)`；默认值在 `renderer/src/styles/theme.css`（玫红/鎏金/奶油白/深玫/描边/阴影/圆角/间距）。
- 宿主传 `theme`（site.theme）→ SchemaPage 根节点 `:style` 内联覆盖同名变量（键缺 `--fyt-` 前缀自动补）。
- 与 mini 既有 SCSS token 双轨共存：mini 页面级样式可用 `$fyt-*`（vite additionalData 注入），渲染器内部不用。

## 6. 构建桥接：sync-copy（为什么不直接跨包 import）

uni 构建链对 src 外模块的 rollup chunkFileNames 会生成 `../../` 非法路径，且插件无视 rollupOptions 覆盖（2026-09-23 实测）。桥接方案：

- `packages/renderer/sync.mjs`：构建前把 `src/` + `schema/` 拷到 `apps/{mini,h5}/src/renderer/`（组件内相对引用同步后依然成立）。
- h5 的 `scripts/build.mjs` 已自动先跑 sync；mini 构建需手动先跑（或后续挂 npm script）。
- **修订过 sync.mjs 两个 bug**（2026-09-23）：`repoRoot` 原少跳一级（同步落进 `packages/apps/` 幽灵目录）；schema 目录原拷到 `src/schema` 与 import `@/renderer/schema/` 错位 → 均已修正并验证。
- 未来 pnpm workspace 化后可删除（见脚本头注释）。

## 7. H5 端迁移要点（本轮同步完成）

- 工程：uni-app vue3 + hash 路由 + `base=/h5/`（manifest h5.router），产物 `dist/build/h5`；入口 `index.html` script 为 `/src/main.js`（官方模板约定，写 `/main.js` 会 rollup 解析失败）。
- bootAuth 从旧 H5 空壳**逐行平移**：snsapi_base 静默 → hlogin；被拒降级 snsapi_userinfo（每会话一次）；`fyt_oauth_skip` 防死循环；非微信环境跳过。单例 promise（`ensureBoot()`），页面 await 后再拉配置。
- token：`window.localStorage` 原生 API，key 维持 `fyt_token_site-a`（老用户无感续登）。
- convertJump 平移：tb → 根路径 `/tkl.html`（决策#14/#26，hosting-deploy 追加根路径上传）；jd/vip/pdd → `location.href = d.url`。
- uni h5 默认 `publicDir='__static__'`（插件强制），public/ 不随构建拷贝 → build.mjs 兜底拷 tkl.html。

## 8. AI 装修预留（40:1，后续里程碑）

- LLM 只产 **page-v1 合同 JSON**（system prompt 附合同 + 组件 props 文档），写 `page_schema`（source='ai', status='draft'）→ 运营预览 → publish。
- `llm_log` 表已建（001），记录 prompt/响应/耗时/token。
- 安全边界：AI 产出的 props 值渲染时全部走文本插值（Vue 默认转义），无 v-html 注入面。

## 8A. AI 装修分层设计（增补 2026-09-23 · D先生 拍板：本轮只落地 L1）

背景（2026-09-22 讨论）：波普风是默认皮肤，后台 AI 装修能否让小程序呈现**不同风格** → 结论分两层，**本轮只实现 L1，L2 列二期**。

| 维度 | L1 换肤（本轮） | L2 换风格（二期） |
|---|---|---|
| 改什么 | 颜色 / 圆角 / 描边粗细 / 阴影 / 背景（token 值） | 组件形态与皮肤（渐变气泡 → 极简卡片等） |
| 载体 | `site.theme`（theme token JSON）+ 渲染器 `theme` prop 内联覆盖 `--fyt-*`（§5 机制） | Schema 楼层新增可选 `variant` 字段 + 楼层组件内置多套皮肤 |
| AI 产出 | theme token JSON（不碰楼层结构与布局） | theme JSON + 各楼层 variant 选择（仍不产代码） |
| 前置条件 | 渲染器已就绪（零 SCSS、全 `var(--fyt-*)`） | 23 组件库补齐 + 每组件 2~4 套 variant 皮肤（工作量大） |
| 状态 | ✅ 渲染侧已支持；⏳ 缺下面三件 | ⏳ 未启动 |

### L1 落地三件套（近期待办）

1. **theme 合同**：`packages/renderer/schema/theme-v1.schema.json`（draft-07）——键 = `--fyt-*` 去前缀（`color_primary` / `color_accent` / `radius_card` / `outline_width` …），值仅颜色与数值；非法键 LLM 产出后校验丢弃。
2. **server 下发**：`site.theme`（JSONB，默认 NULL = 波普默认肤）→ `/api/site/config` 响应附 `theme` 字段 → SchemaPage `:theme` 透传，链路与 §5 完全复用。
3. **后台入口**：42 AI 动态装修屏加「换肤」模式——自然语言风格描述 → LLM 产 theme JSON（system prompt 附合同）→ 预览（SchemaPage 实时换肤）→ 保存。

### L2 方向备忘

波普风硬编码在各楼层组件内部（渐变/描边/气泡装饰），纯 theme 无法改变组件形态。方案 = **组件 variant 机制**：楼层组件支持 `variant` prop（如 `pop` / `soft` / `dark` / `minimal`），组件内按 variant 切换皮肤样式；page-v1 对未知字段宽容（渲染器忽略），不破坏现有合同。随 17 组件补齐里程碑（§9 待办）一起做，单独排期。

## 8B. 站点壳配置（tabbar-v1，2026-09-27 决策 #28）

> 边界：page-v1 管**单页楼层**；底部菜单是**站点级全局壳**，独立合同 `tabbar-v1`，不进 page-v1、不占楼层数、不参与 AI 生成。存储于 site 级配置（site.config.tabbar），随 `/api/site/config` 与 home/h5_home 一并下发。

### 8B.1 合同结构（draft-07）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "tabbar-v1",
  "type": "object",
  "required": ["items"],
  "properties": {
    "style": { "type": "string", "enum": ["classic", "glass"], "default": "classic", "description": "classic=白底经典导航条（默认兜底）；glass=毛玻璃胶囊 4+1（决策 #30，iOS backdrop-filter，Android 降级奶油白 85% 半透明）" },
    "fab": {
      "type": ["object", "null"],
      "description": "右侧悬浮钮（+1 槽位，custom-tab-bar 内绝对定位，不占壳页槽位、不参与 setSelected）；null=隐藏",
      "required": ["icon", "target"],
      "properties": {
        "icon":   { "type": "string", "description": "悬浮钮图标 URL" },
        "target": { "oneOf": [
              { "type": "object", "required": ["type", "page"], "properties": {
                  "type": { "const": "builtin" },
                  "page": { "enum": ["home", "rights", "orders", "mine", "services", "search"] } } },
              { "type": "object", "required": ["type", "schemaId"], "properties": {
                  "type": { "const": "schema" },
                  "schemaId": { "type": "string" } } }
            ] }
      }
    },
    "items": {
      "type": "array",
      "minItems": 2,
      "maxItems": 5,
      "items": {
        "type": "object",
        "required": ["key", "text", "icon", "iconActive", "target"],
        "properties": {
          "key":        { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,19}$" },
          "text":       { "type": "string", "maxLength": 8 },
          "icon":       { "type": "string", "description": "默认态图标 URL（81×81px 建议，PNG 透明底）" },
          "iconActive": { "type": "string", "description": "选中态图标 URL" },
          "target": {
            "oneOf": [
              { "type": "object", "required": ["type", "page"], "properties": {
                  "type": { "const": "builtin" },
                  "page": { "enum": ["home", "rights", "orders", "mine", "services"] } } },
              { "type": "object", "required": ["type", "schemaId"], "properties": {
                  "type": { "const": "schema" },
                  "schemaId": { "type": "string", "description": "已发布 page_schema.id" } } }
            ]
          }
        }
      }
    }
  }
}
```

### 8B.2 壳页架构（微信硬约束的落地形态）

- **5 壳页槽位**：pages.json 预声明 `tab-1…tab-5` 五个 tabBar 页（微信上限 5、下限 2），custom-tab-bar 渲染 items 中的前 n 项；被裁剪的槽位不渲染入口。
- **槽位装内容**：壳页基类（TabShellPage）onLoad 读配置第 i 项 target——`builtin` 挂内置页组件（首页 SchemaPage / 权益 / 订单 / 我的 / 生活服务），`schema` 挂 SchemaPage 渲染对应 page_schema；内容组件化复用，壳页自身零业务。
- **选中态同步**：壳页基类 onShow 统一调 `getTabBar().setSelected(i)`（custom-tab-bar 全局单例，漏调即错位，写死在基类防呆）。
- **毛玻璃风格（决策 #30，2026-09-29）**：`style:"glass"` 时渲染玻璃胶囊（268×72 r36，`backdrop-filter: blur(24px)` + rgba(255,255,255,.66) + 2px 深描边）+ 右侧独立 FAB 圆钮（66px，渲染 `fab` 配置）；Android webview 不支持 backdrop-filter 时降级 `rgba(255,246,233,.85)`；**壳页内容底部预留 ~120rpx padding 供内容穿透（真毛玻璃）**；FAB 点击走 target 跳转，不计入 items、不触发 setSelected。
- **动态生效边界**：名称/图标/数量/槽位内容=运行时生效；**新增壳页槽位类型（>5）或新内置页枚举=需发版**。
- **H5 端**：无 tabBar 硬约束，同份 tabbar-v1 由站点壳组件自由渲染，行为对齐。
- **审核注意**：图标资源随小程序版本审核；首次提审时 pages.json 需含默认静态配置兜底（config 拉取失败回退默认 4 Tab）。

### 8B.3 后台编辑器（画布屏 49，节点 115:178）

Tab 列表卡（增删 ≤5 + 拖拽排序 + 名称输入 + 双态图标上传 + 指向下拉：内置页/已发布 Schema 页）+ **风格选择（classic/glass）+ 悬浮钮 FAB 卡（显隐/图标/指向）** + 手机实时预览（消费草稿态 tabbar-v1，含 tabBar 组件实例）+ 存草稿/发布。实现随 M4 壳页化同批落地。

## 9. 遗留与验收清单

已上线验证（2026-09-23）：
- ✅ /api/site/config 下发 home(4 floors) + h5_home(6 floors)
- ✅ https://mk.fyt360.cn/h5/ 200（hash 路由 + /h5/ 资源 base）
- ✅ /tkl.html 根路径 200
- ✅ mini 构建 + 转链矩阵（core/link.js chunk 含 vipWxUrl 动态/固定映射）
- ✅ 渲染器 6 组件进双端产物

待办（非本轮）：
- ⏳ 微信真机回归：mini 4 tab + 双端转链矩阵 + H5 微信内静默授权（需真机微信 UA）
- ⏳ H5 首页截图 vs h5-43 快照并排核对（agent-browser daemon 本轮不稳定，留真机/后续）
- ⏳ DIY 装修屏（33:908）→ Schema 编辑器；17 个组件补齐
- ⏳ mini 构建脚本挂 sync 前置（npm script 化）
