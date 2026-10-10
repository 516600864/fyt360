<template>
  <view class="sr-page" :style="pageTheme">
    <!-- 全局过渡（三源并行较慢：品牌直达/呼起库/团购/CPS，福袋兽Loading 兜住等待感） -->
    <view v-if="loading" class="loading-mask">
      <view class="loading-card">
        <text class="loading-beast">🦊</text>
        <text class="loading-coin">💰</text>
        <text class="loading-text">福袋兽搬金币中…</text>
        <text class="loading-ver">{{ buildVer }}</text>
        <!-- 实时耗时计（D先生 2026-10-03）：此前遮罩只显示版本号，无法区分「网络慢」与
             「渲染卡死」。现在直接读秒出耗时，下次真机截图即可定位卡了多久、卡在哪个域。 -->
        <text class="loading-cost">{{ costLabel }}</text>
        <text class="loading-cost">{{ pendLabel }}</text>
      </view>
    </view>
    <!-- 搜索条（画布 07B：白胶囊 + 鎏金搜索钮） -->
    <view class="sr-bar">
      <view class="sr-box">
        <text class="sr-glass">🔍</text>
        <input v-model="kw" class="sr-input" :maxlength="30" placeholder="搜索商品" placeholder-class="sr-ph" confirm-type="search" @confirm="onSearchConfirm" />
      </view>
      <view class="sr-btn" @tap="onSearchConfirm"><text class="sr-btn-t">搜索</text></view>
    </view>

    <!-- 结果域 tabs -->
    <view class="sr-tabs">
      <text v-for="t in tabs" :key="t.key" class="sr-tab" :class="{ on: tab === t.key }" @tap="tab = t.key">{{ t.name }}</text>
    </view>

    <!-- 一键搜券（→ 07 CPS 平台专属页：jd/tb/pdd/vip 复制链接找券） -->
    <view class="paste-bar" @tap="goCpsSearch">
      <text class="pb-emoji">🧷</text>
      <text class="pb-t">粘贴链接或淘口令，一键找券</text>
      <text class="pb-arrow">›</text>
    </view>

    <!-- 搜索失败态（聚合域 8s 超时/异常）——给可点的重试入口，不再让用户对着空屏干等（D先生 2026-10-03） -->
    <view v-if="aggFailed" class="err-card">
      <text class="err-emoji">😵</text>
      <text class="err-t">搜索没跑通，检查网络后重试</text>
      <view class="err-btn" @tap="research()"><text class="err-btn-t">重新搜索</text></view>
    </view>

    <!-- 服务直达（到店服务 + 权益兑换两分块；D先生 定稿 2026-10-03） -->
    <view v-if="showSec('brand') && (services.length || rights.length)" class="sec">      <view class="sec-head">
        <text class="sec-title">服务直达</text>
        <text class="sec-sub">{{ services.length + rights.length }} 个结果 · 官方认证</text>
      </view>

      <!-- 子块 1：精准服务（跳插件/半屏/联盟链接；分类命中折叠 6 条 + 展开全部）
     命名由「到店服务」改「精准服务」（D先生 2026-10-03：本域含半屏/联盟跳转，非全是到店） -->
      <view v-if="services.length" class="sub-block">
        <view class="sub-head">
          <text class="sub-title">精准服务</text>
          <text class="sub-count">{{ services.length }} 个</text>
        </view>

        <view v-for="s in directServices" :key="'d' + s.brand_code" class="brand-card" @tap="launchService(s)">
          <view class="bc-icon"><text class="bc-emoji">{{ catEmoji(s.cat_code) }}</text></view>
          <view class="bc-body">
            <view class="bc-name-row">
              <text class="bc-name">{{ s.name }}</text>
              <text class="bc-type">{{ s.cat_name }}</text>
            </view>
            <text class="bc-desc">{{ s.mode === 'plugin' ? '官方品牌 · 点击直接呼起点餐' : '官方服务 · 点击直接呼起' }}</text>
          </view>
          <text class="bc-arrow">›</text>
        </view>

        <!-- 分类命中组：头部「共 N 个服务」，默认 6 条 + 展开全部 32 个（D先生 定稿） -->
        <view v-for="c in catServices" :key="'c' + c.code" class="cat-group">
          <view class="cat-head">
            <text class="cat-emoji">{{ catEmoji(c.code) }}</text>
            <text class="cat-name">{{ c.name }}</text>
            <text class="cat-total">共 {{ c.total }} 个服务</text>
          </view>
          <view v-for="s in c.list" :key="'s' + s.brand_code" class="brand-card" @tap="launchService(s)">
            <view class="bc-icon"><text class="bc-emoji">{{ catEmoji(s.cat_code) }}</text></view>
            <view class="bc-body">
              <view class="bc-name-row">
                <text class="bc-name">{{ s.name }}</text>
                <text v-if="s.mode === 'halfscreen'" class="bc-type">半屏</text>
                <text v-else-if="s.mode === 'plugin'" class="bc-type">插件</text>
              </view>
              <text class="bc-desc">官方服务 · 点击直接呼起</text>
            </view>
            <text class="bc-arrow">›</text>
          </view>
          <view v-if="c.total > 6" class="cat-toggle" @tap="toggleCat(c.code)">
            <text class="ct-text">{{ c.expanded ? '收起' : `展开全部 ${c.total} 个` }}</text>
            <text class="ct-arrow" :class="{ up: c.expanded }">⌄</text>
          </view>
        </view>
      </view>

      <!-- 子块 2：权益兑换（蚂蚁星球积分；元宝与我方无关，D先生 纠正 2026-10-03） -->
      <view v-if="rights.length" class="sub-block">
        <view class="sub-head">
          <text class="sub-title">权益兑换</text>
          <text class="sub-count">{{ rights.length }} 个 · 积分兑换</text>
        </view>
        <view v-for="(r, i) in rights" :key="'r' + r.cid + i" class="brand-card" @tap="launchRights(r)">
          <!-- 权益图标 = 品牌首字（D先生 2026-10-03 定，并定为此后长期口径）
               不用上游 img：实测某权益图床返回 403（URL 含中文未编码），
               且该域名不在小程序 downloadFile 白名单，用<image> 必然加载失败。首字稳定零请求。
               emoji 仅作背景装饰（分类氛围），首字为唯一识别主体。 -->
          <view class="bc-icon bc-icon-letter">
            <text class="bc-letter">{{ firstChar(r.brand_name || r.name) }}</text>
            <text class="bc-letter-bg">{{ typeEmoji(r.cat_name) }}</text>
          </view>
          <view class="bc-body">
            <view class="bc-name-row">
              <text class="bc-name">{{ r.brand_name || r.name }}</text>
              <text class="bc-type">{{ r.cat_name }}</text>
            </view>
            <text class="bc-desc">{{ rightsDesc(r) }}</text>
          </view>
          <text class="bc-arrow">›</text>
        </view>
      </view>
    </view>

    <!-- 到店团购（self_goods 站内库；group tab 合并后唯一团购区） -->
    <view v-if="showSec('self')" class="sec">
      <view class="sec-head">
        <text class="sec-title">到店团购</text>
        <text class="sec-sub">{{ selfItems.length }}个结果 · 到店核销</text>
      </view>
      <view v-if="!selfItems.length && !loading" class="empty-card"><text class="empty-t">暂无相关到店团购商品</text></view>
      <view v-else class="grid">
        <view v-for="g in visibleSelfItems" :key="'s' + g.id" class="g-card" @tap="tapSelf(g)">
          <view class="g-pic-wrap">
            <!-- lazy-load + 失败占位（D先生 2026-10-03 修「搜京东/肯德基卡死」）：
                 本页是全项目唯一渲染京东图却不加 lazy-load 的页面（search.vue / f-goods-feed.vue 都有）。
                 京东图走 img14.360buyimg.com，未在小程序 downloadFile 白名单 → 10 张图同帧解码+失败重绘
                 会把渲染主线程饿死，用户所见即「卡死」（JS 层实测全绿：聚合 0.3s、CPS 1.2s，均不构成阻塞）。 -->
            <image v-if="!g.imgErr" class="g-pic" :src="g.pic" mode="aspectFill" lazy-load @error="onImgErr(g)" />
            <view v-else class="g-pic g-pic-fallback"><text class="g-pic-fb-t">{{ firstChar(g.title) }}</text></view>
            <view class="g-badge"><text>到店团购</text></view>
          </view>
          <view class="g-body">
            <text class="g-title">{{ g.title }}</text>
            <view class="g-price-row">
              <text class="g-price">¥{{ fmt(g.finalPrice ?? g.price) }}</text>
              <text v-if="g.sales" class="g-sales">已售 {{ fmtSales(g.sales) }}件</text>
            </view>
          </view>
        </view>
      </view>
    </view>

    <!-- 全网好物（CPS 比价：京东/拼多多/淘宝/唯品会四平台 tab，切换调蚂蚁对应平台搜索接口） -->
    <view v-if="showSec('cps')" class="sec">
      <view class="sec-head">
        <text class="sec-title">全网好物</text>
        <text class="sec-sub">{{ cpsItems.length }}个结果 · 高佣精选</text>
      </view>
      <view class="cps-tabs">
        <text v-for="t in cpsTabs" :key="t.key" class="cps-tab" :class="{ on: cpsTab === t.key }" @tap="switchCps(t.key)">{{ t.name }}</text>
      </view>
      <view v-if="!cpsItems.length && !loading" class="empty-card"><text class="empty-t">暂无相关商品，换个词试试</text></view>
      <view v-else class="grid">
        <view v-for="g in visibleCpsItems" :key="'c' + g.platform + g.id" class="g-card" @tap="tapCps(g)">
          <image v-if="!g.imgErr" class="g-pic" :src="g.pic" mode="aspectFill" lazy-load @error="onImgErr(g)" />
          <view v-else class="g-pic g-pic-fallback"><text class="g-pic-fb-t">{{ firstChar(g.title) }}</text></view>
          <view class="g-body">
            <text class="g-title">{{ g.title }}</text>
            <view class="g-price-row">
              <text class="g-price">¥{{ fmt(g.finalPrice ?? g.price) }}</text>
              <text v-if="g.coupon > 0" class="g-coupon">¥{{ fmtInt(g.coupon) }} 券</text>
            </view>
            <view class="g-sub-row">
              <text v-if="g.price > (g.finalPrice ?? 0)" class="g-market">¥{{ fmt(g.price) }}</text>
              <text v-if="g.sales" class="g-sales">已售 {{ fmtSales(g.sales) }}</text>
            </view>
          </view>
        </view>
        <view v-if="cpsItems.length > cpsLimit" class="more-btn" @tap="cpsLimit = cpsItems.length">
          <text class="more-btn-t">展开剩余 {{ cpsItems.length - cpsLimit }} 个商品</text>
        </view>
      </view>
    </view>

    <!-- 相关搜索（真实词表：GET /api/site/hot-words，032 迁移 2026-10-03）
         原为端上硬编码 5 词，其中「每日坚果」「空气炸锅」站内无此商品 → 点了必零结果（AI 加戏）；
         现改为运营在后台维护的 search_hotword，词源全部来自真实数据面。 -->
    <view class="sec">
      <text class="sec-title">相关搜索</text>
      <view v-if="!relatedWords.length && !loading" class="empty-card"><text class="empty-t">暂无推荐词</text></view>
      <view v-else class="tags">
        <text v-for="w in relatedWords" :key="w" class="tag" @tap="research(w)">{{ w }}</text>
      </view>
    </view>
  </view>
</template>

<script>
/**
 * 07B 全站搜索页（画布 mini-07b）：搜索条与首页 search-bar 的默认落点，先全站再专属平台。
 * 聚合域：服务直达（/api/site/service-search 一次给全四轨：精准服务/权益兑换/到店团购/全网好物）/
 * 全网好物（/api/goods/:platform/list?keyword= CPS 比价，静默后补不参与遮罩）/
 * 相关搜索（/api/site/hot-words 真实词表，032 迁移）；
 * 「一键搜券」→ 07 CPS 平台专属页（jd/tb/pdd/vip 复制链接找券）。
 * tabs 过滤可见域：全部=全部区块；到店团购=单区（2026-09-29 决策 #29 合并原 self/group 同名冲突，删「团购精选」空态区）；服务直达=单域。
 *
 * 2026-10-03 变更（D先生 两项要求）：
 *   ① 「相关搜索」接真实词表：删掉硬编码 5 词（其中「每日坚果」「空气炸锅」站内无此商品 → 必零结果，
 *      属 AI 加戏），改为运营在后台维护的 search_hotword，词源全部来自真实数据面。
 *   ② 「隆重推荐」位整体移除：静态假卡（腾讯 VIP ¥199 / 边看剧边吃火锅），
 *      假价格假优惠且腾讯 VIP 属 CPS 品类不应做种草。相关模板/样式/goCategory 一并清掉。
 */
import { request } from '@/utils/request';
import { onGoodsTap } from '@/core/link';

const TYPE_EMOJI = { 视频会员: '🎬', 音频娱乐: '🎧', 音频会员: '🎧', 读书学习: '📚', 餐饮美食: '🍔', 生活服务: '🛠', 外卖出行: '🛵', 网话费: '📱', 话费充值: '📱', 其他: '🎁', 其它会员: '🎁' };
/** 分类 code → emoji（brand_category 10 分类；无图标的分类给行业默认图，D先生 定稿 2026-10-03） */
const CAT_EMOJI = {
  dining: '🍔', life: '🛠', taxi: '🚕', hotel: '🏨',
  meituan: '🛒', eleme: '🥡', jd: '🛍', tb: '🛒', vip: '💄', pdd: '🧧',
};
/** 分类命中默认折叠条数（D先生 定稿 2026-10-03：默认 6 + 展开全部） */
const CAT_PREVIEW = 6;
/** 首屏商品卡渲染上限（D先生 2026-10-03 修「搜京东卡死」）：
 *  京东图域 img14.360buyimg.com 不在小程序 downloadFile 白名单，实测必 403；
 *  首屏一次性挂 10 张 <image> 会同帧解码 + 失败重绘，低端机渲染主线程饿死 = 用户所见「卡死」。
 *  与 JS 耗时无关（聚合 0.3s / CPS 1.2s 实测全绿），是纯渲染层问题。 */
const CPS_LIMIT_S = 6;
const SELF_LIMIT_S = 4;
/** 团购首屏上限随 CPS「展开」联动，避免 CPS 展开后团购又被裁剪 */
const selfLimit = (n) => (n > CPS_LIMIT_S ? 12 : SELF_LIMIT_S);

export default {
  data() {
    return {
      kw: '',
      tab: 'all',
      tabs: [
        { key: 'all', name: '全部' },
        { key: 'group', name: '到店团购' },
        { key: 'life', name: '服务直达' },
      ],
      loading: false,
      costMs: 0, // 遮罩已展示时长（真实读秒，非假动画）
      aggregating: false, // 聚合搜索在飞（与 loading 同步，语义更明确）
      aggFailed: false,   // 聚合搜索失败 → 显示可重试空态
      buildVer: 'BUILD 20260930.1135', // 遮罩可见版本身份牌：出遮罩即知跑的是哪版包（构建时由 patch-buildver.mjs 注入真实时间戳）
      services: [],   // 服务直达·到店服务（brand_action_cfg 轨道：plugin/halfscreen/act/launch）
      rights: [],     // 服务直达·权益兑换（fasttype 轨道，蚂蚁侧积分口径）
      categories: [], // 分类命中摘要（头部「共 N 个服务」）
      expandedCats: [], // 已展开全量的分类 code（D先生 定稿：默认 6 条 + 展开全部）
      selfItems: [],
      cpsItems: [],
      cpsLimit: CPS_LIMIT_S,
      cpsTab: 'jd',
      cpsTabs: [
        { key: 'jd', name: '京东' },
        { key: 'pdd', name: '拼多多' },
        { key: 'tb', name: '淘宝' },
        { key: 'vip', name: '唯品会' },
      ],
      // 真实热词（032）：来自 /api/site/hot-words（search_hotword 表，运营后台可维护）。
      // 旧这里是写死的 5 个词，其中「每日坚果」「空气炸锅」站内无此商品 → 必零结果。
      hotWords: [],
      // ⚠️ 不在这里挂 CAT_EMOJI / TYPE_EMOJI：模板已统一走 methods 的 catEmoji()/typeEmoji()。
      // 2026-10-03 真机踩坑：`TYPE_EMOJI` 是 `<script>` 顶层 const，若模板直读
      // `TYPE_EMOJI[r.cat_name]` 会拿到 undefined → 抛「Cannot read properties of
      // undefined (reading '其它会员')」→ 整个渲染函数中断 → 遮罩永驻 = 用户所见「卡死」。
      // 数据其实早已返回（截图里遮罩才 0.2s），崩的是渲染而非网络。
      // 常量保持模块级单一来源，只经 methods 暴露，杜绝「漏挂 data」这类整页崩。
    };
  },
  computed: {
    /** 相关搜索 = 当前搜索词（若非空）+ 真实热词表（DB 词表，运营后台可维护）
     *  旧实现是端上硬编码 ['每日坚果','空气炸锅','肯德基','麦当劳','视频会员']，
     *  前两个站内无此商品、点了必零结果（AI 加戏），后三个是品牌表快照不会随配置更新。
     *  现改为 GET /api/site/hot-words（032 迁移），且剔除与当前搜索词相同的项（点了等于原地不动）。 */
    relatedWords() {
      const k = this.kw.trim();
      const out = [];
      if (k) out.push(k);
      for (const w of this.hotWords) {
        if (out.length >= 8) break;
        if (w && w !== k) out.push(w);
      }
      return out;
    },
    /** 分类命中的服务（折叠/展开控制）；未展开的分类只取前 CAT_PREVIEW 条 */
    catServices() {
      const byCat = new Map();
      for (const s of this.services) {
        if (!s.via_category || !s.cat_code) continue;
        const arr = byCat.get(s.cat_code) ?? [];
        arr.push(s);
        byCat.set(s.cat_code, arr);
      }
      const out = [];
      for (const [code, list] of byCat) {
        const open = this.expandedCats.includes(code);
        out.push({
          code,
          name: list[0]?.cat_name ?? code,
          total: list.length,
          expanded: open,
          list: open ? list : list.slice(0, CAT_PREVIEW),
        });
      }
      return out;
    },
    /** 不属于任何分类命中的字面命中（轨道 A）——始终全量展示 */
    directServices() {
      return this.services.filter((s) => !s.via_category);
    },
    /** 首屏只渲染前 CPS_LIMIT_S 首图卡（D先生 2026-10-03 修「搜京东卡死」）。
     *  10 张京东图同帧解码 + 失败重绘会在低端机饿死渲染主线程（实测图域不在小程序白名单，必 403）。
     *  首屏 6 张与「分类折叠 6 条」同一口径，多余的由「展开更多」按需追加。 */
    visibleCpsItems() {
      return this.cpsItems.slice(0, this.cpsLimit);
    },
    visibleSelfItems() {
      return this.selfItems.slice(0, selfLimit(this.cpsLimit));
    },
    /** 遮罩读秒：真实已耗时，让「卡死」可量化（D先生 2026-10-03） */
    costLabel() {
      const s = Math.floor(this.costMs / 100) / 10;
      return `已等待 ${s.toFixed(1)}s`;
    },
    /** 各域完成状态：一眼看出是哪一域在拖（D先生 2026-10-03） */
    pendLabel() {
      const agg = this.aggFailed ? '聚合✗' : this.aggregating ? '聚合…' : '聚合✓';
      const cps = this.cpsItems.length ? '好物✓' : '好物…';
      return `${agg} · ${cps} · ${this.selfItems.length ? '团购✓' : '团购…'}`;
    },
  },
  onLoad(q) {
    // 兜底净化：任何入口若把 Event 对象串进来（[object Object]），直接剥除，不上屏不进搜索
    let k = String(q?.kw ?? '').trim();
    if (k.includes('[object Object]')) k = k.split('[object Object]').join('').trim();
    this.kw = k;
    // 07 平台专属页跳转带 platform → 落到全网好物对应平台 tab
    const p = String(q?.platform ?? 'jd');
    if (['jd', 'pdd', 'tb', 'vip'].includes(p)) this.cpsTab = p;
    this.loadHotWords();
    this.loadAll();
  },
  /** 离开页面必须清计时器：否则 onLoad → 立刻返回 → 再进会叠加多个 100ms 定时器（D先生 2026-10-03） */
  onUnload() {
    if (this._costTimer) { clearInterval(this._costTimer); this._costTimer = null; }
  },
  methods: {
    /** 分类/类型 → emoji（D先生 2026-10-03）。
     *  ⚠️ 走 methods 而非模板直读模块级常量：uni 编译产物里 `<script>` 顶层 const 不进 this，
     *  模板 `TYPE_EMOJI[x]` 会读到 undefined 并抛「Cannot read properties of undefined」，
     *  整个渲染函数中断 → 遮罩永驻 = 用户所见「卡死」（2026-10-03 真机踩过）。
     *  这里再兜一层 `?.` + 默认值：即便字典缺失也只是 emoji 兜底，绝不让整页崩。 */
    catEmoji(code) {
      return CAT_EMOJI[code] || CAT_EMOJI[String(code)] || '🎁';
    },
    typeEmoji(name) {
      return TYPE_EMOJI[name] || '🎁';
    },
    fmt(n) {
      const v = Number(n ?? 0);
      return v % 1 === 0 ? String(v) : v.toFixed(2).replace(/0$/, '');
    },
    fmtInt(n) {
      return Number(n ?? 0).toLocaleString('zh-CN');
    },
    fmtSales(n) {
      const v = Number(n ?? 0);
      if (v >= 10000) return `${(v / 10000).toFixed(1)}万+`;
      return v.toLocaleString('zh-CN');
    },
    /** 品牌首字（权益图标；D先生 2026-10-03 定，替代上游 img） */
    firstChar(s) {
      const t = String(s ?? '').trim();
      return t ? t.slice(0, 1) : '·';
    },
    /** 权益文案：积分区间（蚂蚁星球侧积分，非本系统元宝——D先生 纠正 2026-10-03）
     *  ⚠️ 必须挂 methods 而非 computed：带参数的格式化函数若放computed，uni 会把它当求值属性，
     *  模板里 rightsDesc(r) 调用即报「not a function」（2026-10-03 真机踩过）。 */
    rightsDesc(r) {
      const lo = Number(r.points_min ?? 0);
      const hi = Number(r.points_max ?? 0);
      const pts = lo && hi && lo !== hi ? `${lo}~${hi}` : `${hi || lo}`;
      const save = Number(r.max_save ?? 0);
      return save > 0 ? `${pts} 积分 · 最高省 ¥${this.fmt(save)}` : `${pts} 积分`;
    },
    showSec(key) {
      if (this.tab === 'all') return true;
      if (this.tab === 'life') return key === 'brand'; // 服务直达 tab：只显服务直达区
      if (this.tab === 'group') return key === 'self'; // 到店团购 Tab：单区（原「团购精选」空态区已删）
      return this.tab === key;
    },
    research(word) {
      // 防御：uni 事件直绑会把 Event 对象作首参传入（@tap="research" 实录），非字符串一律弃用回退当前输入
      if (word != null && typeof word !== 'string') word = undefined;
      const w = String(word ?? this.kw ?? '').trim();
      if (!w) return;
      this.kw = w;
      this.aggFailed = false; // 重试先清失败态，否则旧空态会盖在新结果上
      this.loadAll();
    },
    /** 键盘确认搜索：uni confirm 事件会把 Event 对象作首参传入，这里显式吞掉防 [object Object] 污染搜索词 */
    onSearchConfirm() {
      this.research();
    },
    /** 切换全网好物平台 tab → 单独拉对应平台搜索（CPS 上游 2-4s，失败静默不遮主体） */
    async switchCps(k) {
      if (this.cpsTab === k) return;
      this.cpsTab = k;
      await this.loadCps();
    },
    goCpsSearch() {
      // 07B（全站）→ 07（CPS 平台专属）：先全站再专属平台
      uni.navigateTo({ url: '/pkg-goods/pages/goods/search' });
    },
    tapSelf(g) {
      uni.navigateTo({ url: `/pkg-goods/pages/goods/self-detail?id=${g.raw?.goods_id ?? g.id}` });
    },
    tapCps(g) {
      onGoodsTap({ ...g, platform: g.platform });
    },
    toggleCat(code) {
      if (this.expandedCats.includes(code)) {
        this.expandedCats = this.expandedCats.filter((c) => c !== code);
      } else {
        this.expandedCats = [...this.expandedCats, code];
      }
    },
    /** 服务直达·到店服务 → brand-launch?code=<brand_code>（按 code 精确，不再靠品牌名模糊猜轨道）
     *  mode=plugin/halfscreen/act/launch 三轨统一由服务端返回，端上只做分发 */
    launchService(s) {
      if (!s?.brand_code) {
        uni.showToast({ title: '该服务暂未配置呼起', icon: 'none' });
        return;
      }
      // #ifndef MP-WEIXIN
      uni.navigateTo({ url: '/pages/rights/category', fail: () => {} });
      return;
      // #endif
      // #ifdef MP-WEIXIN
      request(`/api/site/brand-launch?code=${encodeURIComponent(s.brand_code)}`)
        .then((d) => this.doLaunch(d, ''))
        .catch((e) => uni.showToast({ title: e.message ?? '呼起配置未录入', icon: 'none' }));
      // #endif
    },
    /** 服务直达·权益兑换 → brand-launch?code=life_05 半屏 + &cid=<档位>（f-redeem-entry 同款协议，已真机验证）
     *  蚂蚁侧积分兑换；元宝与我方无关（D先生 纠正 2026-10-03） */
    launchRights(r) {
      if (!r?.cid) {
        uni.showToast({ title: '该权益暂未配置兑换档位', icon: 'none' });
        return;
      }
      // #ifndef MP-WEIXIN
      uni.navigateTo({ url: '/pkg-rights/pages/rights/levels', fail: () => {} });
      return;
      // #endif
      // #ifdef MP-WEIXIN
      request('/api/site/brand-launch?code=life_05')
        .then((d) => this.doLaunch(d, String(r.cid)))
        .catch((e) => uni.showToast({ title: e.message ?? '呼起配置未录入', icon: 'none' }));
      // #endif
    },
    /** 呼起三轨分发（plugin 站内插件页 / halfscreen 半屏 / act+h5url 联盟链接交给 core/link）
     *  cid 非空时拼到 path 上= 权益兑换弹窗参数 */
    doLaunch(d, cid) {
      if (!d?.path && !d?.url) {
        uni.showToast({ title: '该服务暂未配置呼起', icon: 'none' });
        return;
      }
      // 联盟 H5 / 淘口令类（tb/pdd/jd/vip 转链结果）→ 走 core/link 统一转链协议
      if (d.mode === 'h5url') {
        onGoodsTap({ platform: 'tb', id: String(d.actid ?? ''), url: d.url, tkl: d.tkl, title: d.name ?? '' });
        return;
      }
      if (!d.path) {
        if (d.appid) {
          uni.navigateToMiniProgram({ appId: d.appid, path: '', fail: () => uni.showToast({ title: '小程序跳转失败', icon: 'none' }) });
        } else {
          uni.showToast({ title: '呼起配置未录入', icon: 'none' });
        }
        return;
      }
      // plugin 模式（蚂蚁点餐插件 mayi-ordering，声明在 pkg-mayi 分包）→ 中转页进插件页
      //（微信规则：分包外页面不能直接跳分包内插件页；pkg-goods 未声明该插件故同走中转）
      if (d.mode === 'plugin') {
        uni.navigateTo({
          url: '/pkg-mayi/pages/plugin-jump?path=' + encodeURIComponent(d.path),
          fail: () => uni.showToast({ title: '插件页打开失败', icon: 'none' }),
        });
        return;
      }
      const sep = d.path.includes('?') ? '&' : '?';
      const fullPath = cid ? `${d.path}${sep}cid=${cid}` : d.path;
      if (d.mode === 'halfscreen' && typeof wx !== 'undefined' && wx.openEmbeddedMiniProgram) {
        wx.openEmbeddedMiniProgram({ appId: d.appid, path: fullPath, envVersion: 'release', fail: () => uni.showToast({ title: '呼起失败，请更新小程序', icon: 'none' }) });
      } else if (d.appid) {
        uni.navigateToMiniProgram({ appId: d.appid, path: fullPath, fail: () => uni.showToast({ title: '小程序跳转失败', icon: 'none' }) });
      } else {
        uni.showToast({ title: '呼起配置未录入', icon: 'none' });
      }
    },
    /** 图片加载失败 → 就地换首字占位（D先生 2026-10-03）。
     *  京东/淘宝/拼多多图域均不在小程序 downloadFile 白名单，<image> 必然 403；
     *  与其留一堆碎图占位重绘（低端机主线程饿死 = 用户所见「卡死」），不如首字替代。
     *  口径与权益图标一致：首字是稳定零请求的识别主体。 */
    onImgErr(g) {
      if (g) g.imgErr = true;
    },
    /** 拉真实热词表（032 迁移）——「相关搜索」唯一词源。
     *  失败静默：词表拉不到不该让搜索页不可用，退化成「只显示当前搜索词」。 */
    async loadHotWords() {
      try {
        const d = await request('/api/site/hot-words?limit=10', { timeout: 5000 });
        this.hotWords = (d?.words ?? []).map((x) => String(x.word ?? '').trim()).filter(Boolean);
      } catch (e) {
        this.hotWords = [];
      }
    },
    /** 真实搜索词上报（032）：fire-and-forget，失败绝不打扰用户。
     *  有了它，后台热词管理页能展示「近 30 天搜索量」，有量后即可据此出真热搜替代人工配词。 */
    reportSearch(word, hitCount) {
      try {
        request('/api/site/search-log', {
          method: 'POST',
          data: { word: String(word ?? '').trim().slice(0, 64), source: 'search_result', hitCount: Number(hitCount) || 0 },
          timeout: 3000,
        }).catch(() => {});
      } catch (e) {
        // 静默
      }
    },
    async loadAll() {
      if (!this.kw.trim()) return;
      // ⚠️ 遮罩只等「聚合搜索」一域（D先生 2026-10-03 修「搜京东还是卡死」）：
      //   聚合端点已含 fasttype 超时+缓存，实测 0.3s 级，是页面主体。
      //   此前与 CPS 比价域同处一个 Promise.allSettled + withMask，CPS 上游（京东联盟）
      //   偶发慢/挂时会把遮罩一起拖到 15s 硬上限 → 用户所见「卡死」，
      //   且遮罩退场后 CPS 仍在飞，页面继续空着。改为：聚合先渲染出内容，CPS 静默后补。
      this.aggregating = true;
      this.loading = true;
      const t0 = Date.now();
      // 真实读秒（D先生 2026-10-03）：遮罩上直接显示已等待时长与各域完成状态。
      // 此前只能靠猜「是不是慢」，现在真机截图即可量化定位。
      this.costMs = 0;
      if (this._costTimer) clearInterval(this._costTimer);
      this._costTimer = setInterval(() => { this.costMs = Date.now() - t0; }, 100);
      try {
        const kw = encodeURIComponent(this.kw.trim());
        const d = await Promise.race([
          request(`/api/site/service-search?keyword=${kw}`, { timeout: 8000 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('搜索超时，请重试')), 8000)),
        ]);
        this.services = d?.services ?? [];
        this.rights = d?.rights ?? [];
        this.categories = d?.categories ?? [];
        this.selfItems = (d?.selfItems ?? []).map((g) => ({ ...g, raw: { goods_id: g.goods_id }, id: g.goods_id }));
        this.expandedCats = [];
        this.aggFailed = false;
        // 上报真实搜索词 + 命中数（032）：后台热词管理页据此展示搜索量。
        // 只在有关键词时上报；失败静默不打扰用户。
        const t = d?.total ?? {};
        this.reportSearch(this.kw, (t.services ?? 0) + (t.rights ?? 0) + (t.self ?? 0));
      } catch (e) {
        this.services = [];
        this.rights = [];
        this.categories = [];
        this.selfItems = [];
        this.aggFailed = true;
        console.warn('[search-result] 聚合搜索失败', e?.message ?? e);
        uni.showToast({ title: e?.message ?? '搜索失败，请重试', icon: 'none' });
      } finally {
        const remain = 500 - (Date.now() - t0);
        if (remain > 0) await new Promise((r) => setTimeout(r, remain));
        this.costMs = Date.now() - t0;
        if (this._costTimer) { clearInterval(this._costTimer); this._costTimer = null; }
        this.loading = false;
        this.aggregating = false;
      }
      // CPS 比价域独立后补，不参与遮罩、不阻塞已渲染的聚合结果
      this.cpsLimit = CPS_LIMIT_S; // 换词后收起展开态
      this.loadCps();
    },
    /** 全网好物比价：独立拉取，失败静默（不影响主体内容） */
    async loadCps() {
      const kw = encodeURIComponent(this.kw.trim());
      if (!kw) return;
      const tag = kw; // 竞态护栏：慢响应回来时若已切了关键词，丢弃
      try {
        const d = await request(`/api/goods/${this.cpsTab}/list?page=1&size=10&keyword=${kw}`, { timeout: 8000 });
        if (tag !== encodeURIComponent(this.kw.trim())) return;
        this.cpsItems = (d?.items ?? []).map((g) => ({ ...g, platform: this.cpsTab }));
      } catch (e) {
        if (tag === encodeURIComponent(this.kw.trim())) this.cpsItems = [];
      }
    },
  },
};
</script>

<style lang="scss" scoped>
@import '@/styles/tokens.scss';

.sr-page { min-height: 100vh; background: $fyt-surface; padding-bottom: 60rpx; }

.sr-bar { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 32rpx; }
.sr-box {
  flex: 1; display: flex; align-items: center; gap: 12rpx;
  background: #fff; border-radius: 999rpx; height: 72rpx; padding: 0 10rpx 0 24rpx;
  border: 2rpx solid #f0b9cd;
}
.sr-glass { font-size: 26rpx; }
.sr-input { flex: 1; font-size: 26rpx; color: #333; }
.sr-ph { color: #c9a7b3; }
.sr-btn { background: var(--fyt-secondary, #ffaa1d); border-radius: 999rpx; padding: 14rpx 34rpx; flex-shrink: 0; }
.sr-btn-t { font-size: 26rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }

.sr-tabs { display: flex; gap: 52rpx; padding: 4rpx 40rpx 12rpx; }
.sr-tab { font-size: 30rpx; color: var(--fyt-primary-dark, #a31245); font-weight: 700; padding-bottom: 8rpx; position: relative; }
.sr-tab.on { font-weight: 900; }
.sr-tab.on::after {
  content: ''; position: absolute; left: 50%; transform: translateX(-50%); bottom: 0;
  width: 40rpx; height: 6rpx; border-radius: 999rpx; background: var(--fyt-secondary, #ffaa1d);
}

.paste-bar {
  margin: 12rpx 32rpx 0; background: #fff; border: 2rpx solid #f0b9cd; border-radius: 999rpx;
  display: flex; align-items: center; gap: 14rpx; padding: 18rpx 26rpx;
}
.pb-emoji { font-size: 28rpx; }
.pb-t { flex: 1; font-size: 25rpx; color: var(--fyt-primary-dark, #a31245); font-weight: 700; }
.pb-arrow { font-size: 30rpx; color: var(--fyt-primary, #e8336d); font-weight: 900; }

.sec { margin: 32rpx 32rpx 0; display: flex; flex-direction: column; gap: 18rpx; }
.sec-head { display: flex; align-items: baseline; justify-content: space-between; }
.sec-title { font-size: 30rpx; font-weight: 900; color: #3d2530; }
.sec-sub { font-size: 22rpx; color: #b9a8b0; }

.brand-card {
  background: #fff; border: 3rpx solid var(--fyt-primary, #e8336d); border-radius: 24rpx; padding: 26rpx;
  display: flex; align-items: center; gap: 20rpx;
}
.bc-icon {
  width: 96rpx; height: 96rpx; border-radius: 22rpx; background: #ffe3ec;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.bc-emoji { font-size: 48rpx; }
.bc-body { flex: 1; display: flex; flex-direction: column; gap: 10rpx; }
.bc-name-row { display: flex; align-items: center; gap: 12rpx; }
.bc-name { font-size: 30rpx; font-weight: 900; color: #3d2530; }
.bc-type { font-size: 20rpx; font-weight: 700; color: var(--fyt-primary-dark, #a31245); background: #ffe3ec; border-radius: 8rpx; padding: 2rpx 12rpx; }
.bc-desc { font-size: 24rpx; color: #6b5a4e; }
.bc-chips { display: flex; gap: 12rpx; }
.bc-chip { font-size: 20rpx; color: #a3690f; background: var(--fyt-bg, #fff6e9); border-radius: 999rpx; padding: 4rpx 16rpx; font-weight: 600; }
.bc-arrow { font-size: 34rpx; color: var(--fyt-primary, #e8336d); font-weight: 900; }
.bc-img { width: 96rpx; height: 96rpx; border-radius: 22rpx; background: #fff; flex-shrink: 0; }
/* 权益图标：品牌首字（emoji 仅背景装饰，透明度压低不抢首字） */
.bc-icon-letter { position: relative; overflow: hidden; }
.bc-letter {
  position: relative; z-index: 2;
  font-size: 44rpx; font-weight: 900; color: var(--fyt-primary, #e8336d);
  line-height: 1;
}
.bc-letter-bg {
  position: absolute; right: -10rpx; bottom: -14rpx; z-index: 1;
  font-size: 54rpx; opacity: 0.22; line-height: 1;
}

/* 服务直达两分块（到店服务 / 权益兑换）—— D先生 定稿 2026-10-03 */
.sub-block { margin-top: 20rpx; }
.sub-head {
  display: flex; align-items: baseline; gap: 14rpx;
  padding: 0 8rpx 14rpx;
}
.sub-title {
  font-size: 26rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245);
  background: var(--fyt-bg, #fff6e9); border-radius: 999rpx; padding: 6rpx 20rpx;
}
.sub-count { font-size: 22rpx; color: #b9a8b0; }

/* 分类命中组：头部「共 N 个服务」+ 折叠 6 条 */
.cat-group {
  margin-top: 18rpx; padding: 18rpx;
  background: #fffdf8; border: 3rpx dashed #f0b9cd; border-radius: 24rpx;
}
.cat-head { display: flex; align-items: center; gap: 12rpx; padding-bottom: 14rpx; }
.cat-emoji { font-size: 34rpx; }
.cat-name { font-size: 27rpx; font-weight: 900; color: #3d2530; flex: 1; }
.cat-total {
  font-size: 20rpx; font-weight: 700; color: var(--fyt-primary-dark, #a31245);
  background: #ffe3ec; border-radius: 999rpx; padding: 4rpx 16rpx;
}
.cat-group .brand-card { margin-top: 12rpx; border-width: 2rpx; background: #fff; }
.cat-toggle {
  margin-top: 16rpx; height: 68rpx; border-radius: 999rpx;
  background: var(--fyt-bg, #fff6e9); border: 2rpx solid #f0b9cd;
  display: flex; align-items: center; justify-content: center; gap: 10rpx;
}
.ct-text { font-size: 24rpx; font-weight: 800; color: var(--fyt-primary-dark, #a31245); }
.ct-arrow { font-size: 26rpx; color: var(--fyt-primary-dark, #a31245); font-weight: 900; transition: transform .2s; }
.ct-arrow.up { transform: rotate(180deg); }

.cps-tabs { display: flex; gap: 32rpx; }
.cps-tab { font-size: 24rpx; color: #8a7a6b; font-weight: 700; padding: 8rpx 22rpx; background: #fff; border: 2rpx solid #e8d9c5; border-radius: 999rpx; }
.cps-tab.on { color: var(--fyt-primary-dark, #a31245); background: var(--fyt-secondary, #ffaa1d); border-color: var(--fyt-secondary, #ffaa1d); font-weight: 900; }

.empty-card {
  background: #fff; border: 2rpx dashed #e8b9cd; border-radius: 20rpx;
  padding: 40rpx; display: flex; justify-content: center;
}
.empty-t { font-size: 25rpx; color: #b9a8b0; font-weight: 600; }

/* 搜索失败态（可重试） */
.err-card {
  margin: 32rpx 32rpx 0; padding: 48rpx 32rpx;
  background: #fff; border: 3rpx dashed #e8b9cd; border-radius: 24rpx;
  display: flex; flex-direction: column; align-items: center; gap: 18rpx;
}
.err-emoji { font-size: 72rpx; }
.err-t { font-size: 25rpx; color: #8a7a6b; font-weight: 600; }
.err-btn {
  padding: 16rpx 56rpx; border-radius: 999rpx;
  background: var(--fyt-secondary, #ffaa1d); border: 2rpx solid var(--fyt-primary-dark, #a31245);
}
.err-btn-t { font-size: 26rpx; font-weight: 900; color: var(--fyt-primary-dark, #a31245); }

.grid { display: flex; flex-wrap: wrap; gap: 20rpx; }
.g-card {
  width: calc(50% - 10rpx); box-sizing: border-box;
  background: #fff; border: 3rpx solid var(--fyt-primary, #e8336d); border-radius: 20rpx; overflow: hidden;
  display: flex; flex-direction: column;
}
.g-pic-wrap { position: relative; }
.g-badge {
  position: absolute; top: 12rpx; left: 12rpx;
  background: var(--fyt-secondary, #ffaa1d); border-radius: 8rpx; padding: 2rpx 14rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.55);
}
.g-badge text { font-size: 20rpx; font-weight: 800; color: #fff; }
.g-pic { width: 100%; height: 300rpx; background: #f3ede4; display: block; }

/* 「展开更多」：首屏只渲染 6 张图卡（D先生 2026-10-03 修「搜京东卡死」），其余按需追加 */
.more-btn {
  grid-column: 1 / -1; margin-top: 8rpx; padding: 22rpx 0;
  background: #fff; border: 2rpx dashed #e8d9c5; border-radius: 20rpx;
  display: flex; align-items: center; justify-content: center;
}
.more-btn-t { font-size: 25rpx; font-weight: 700; color: var(--fyt-primary-dark, #a31245); }
.g-pic-fallback {
  display: flex; align-items: center; justify-content: center;
  background: #f7eef2;
}
.g-pic-fb-t {
  font-size: 76rpx; font-weight: 900; color: var(--fyt-primary, #e8336d);
  opacity: 0.55;
}
.g-body { padding: 16rpx 18rpx 20rpx; display: flex; flex-direction: column; gap: 10rpx; }
.g-title {
  font-size: 25rpx; color: #333; font-weight: 700; line-height: 1.45;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;
}
.g-price-row { display: flex; align-items: baseline; gap: 10rpx; }
.g-price { font-size: 32rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.g-coupon { font-size: 20rpx; font-weight: 800; color: #fff; background: var(--fyt-primary, #e8336d); border-radius: 8rpx; padding: 2rpx 12rpx; }
.g-sub-row { display: flex; align-items: baseline; gap: 12rpx; }
.g-market { font-size: 20rpx; color: #bbb; text-decoration: line-through; }
.g-sales { font-size: 20rpx; color: #999; margin-left: auto; }

.tags { display: flex; flex-wrap: wrap; gap: 16rpx; }
.tag {
  background: #fff; border: 2rpx solid #e8d9c5; border-radius: 999rpx;
  padding: 12rpx 30rpx; font-size: 24rpx; color: #6b5a4e; font-weight: 600;
}

/* 福袋兽过渡（与首页 Loading 同文案；半透明遮罩保留上下文） */
.loading-mask {
  position: fixed; inset: 0; z-index: 999;
  background: rgba(255, 246, 233, 0.92);
  display: flex; align-items: center; justify-content: center;
}
.loading-card { display: flex; flex-direction: column; align-items: center; gap: 20rpx; }
.loading-beast { font-size: 88rpx; animation: beast-bounce 0.9s ease-in-out infinite; }
.loading-coin { font-size: 52rpx; margin-top: -30rpx; animation: coin-sway 0.9s ease-in-out infinite; }
.loading-text { font-size: 30rpx; font-weight: 800; color: var(--fyt-primary, #e8336d); }
.loading-ver { font-size: 20rpx; color: #c9a7b3; margin-top: 8rpx; }
.loading-cost {
  font-size: 20rpx; color: #a31245; margin-top: 4rpx;
  font-variant-numeric: tabular-nums; /* 等宽数字，读秒不跳动 */
}
@keyframes beast-bounce {
  0%, 100% { transform: translateY(0) rotate(-6deg); }
  50% { transform: translateY(-24rpx) rotate(6deg); }
}
@keyframes coin-sway {
  0%, 100% { transform: translateX(-14rpx); }
  50% { transform: translateX(14rpx); }
}
</style>
