<template>
  <view class="chat-page">
    <!-- 消息流 / 空态 -->
    <scroll-view
      class="chat-body" scroll-y :scroll-top="scrollTop" scroll-with-animation
      :refresher-enabled="hasMoreHistory" refresher-default-style="none"
      :refresher-triggered="refreshing" @refresherrefresh="loadEarlier"
    >
      <!-- 真机第三轮实锤（2026-10-07 21:5x 截图）：scroll-view 自身的水平 padding 不参与
           子元素宽度解析——子元素按 750rpx 全宽解析再被 padding 推右 → 恒溢出 24rpx，
           宫格与商品卡同炸同量。定式：scroll-view 禁 padding，内层 .chat-inner 承担水平内边距 -->
      <view class="chat-inner">
      <!-- 空态（29B 能力全景）：机器人 + 徽章 + 2×3 矩阵 + 推荐问法 -->
      <view v-if="msgs.length === 0" class="empty">
        <view class="e-avatar"><text class="e-avatar-face">◔‿◔</text></view>
        <text class="e-hello">嘿！我是本站 AI 管家</text>
        <text class="e-sub">找券 · 点餐 · 权益 · 返利，一句话全办妥</text>
        <view class="e-badges">
          <view class="e-badge"><text class="e-badge-txt">{{ badges.services }} 项品牌服务</text></view>
          <view class="e-badge"><text class="e-badge-txt">{{ badges.rights }} 项会员权益</text></view>
          <view class="e-badge"><text class="e-badge-txt">{{ badges.platforms }} 大平台返利</text></view>
        </view>

        <text class="e-sec-title">我能帮你做什么</text>
        <view class="e-matrix">
          <view v-for="m in MATRIX" :key="m.title" class="e-cell">
            <!-- 视觉卡放内层：真机 WXSS 对「百分比宽+水平padding」按 content-box 计会溢出（2026-10-07 实测） -->
            <view class="e-card" :class="m.tone" @tap="send(m.q)">
              <text class="e-cell-title">{{ m.title }}</text>
              <text class="e-cell-sub">{{ m.sub }}</text>
              <view class="e-cell-dots">
                <text v-for="d in m.brands" :key="d" class="e-dot">{{ d }}</text>
              </view>
            </view>
          </view>
        </view>

        <text class="e-sec-title">大家可以这样问</text>
        <view class="e-chips">
          <view v-for="s in suggests" :key="s" class="e-chip" @tap="send(s)">
            <text class="e-chip-txt">{{ s }}</text>
          </view>
        </view>
      </view>

      <!-- 对话消息流 -->
      <view v-for="(m, i) in msgs" :key="i" class="row" :class="m.role === 'user' ? 'row-me' : 'row-ai'">
        <view v-if="m.role === 'assistant'" class="bot-avatar"><text class="bot-face">◔‿◔</text></view>
        <!-- 文本气泡 -->
        <view v-if="m.kind === 'text'" class="bubble" :class="m.role === 'user' ? 'bubble-me' : 'bubble-ai'">
          <text class="bubble-txt" :class="m.role === 'user' ? 'txt-on-primary' : ''">{{ m.content }}</text>
        </view>
        <!-- goods-card（29C 智能搜索·比价结果：与跨平台出票完全同款 xcard 行卡——
             D先生 2026-10-08 实锤「搜索流态=转链后同款样式」，设计稿 1:1） -->
        <view v-else-if="m.kind === 'goods_card'" class="xwrap">
          <view class="xhead">
            <view class="xhead-tag"><text class="xhead-tag-txt">智能搜索</text></view>
            <text class="xhead-b">比价结果</text>
            <text class="xhead-s">· 跨渠道比价 · 返利已算进到手价</text>
          </view>
          <view v-for="g in m.items" :key="g.id" class="xcard">
            <image v-if="g.pic" class="xpic" :src="g.pic" mode="aspectFill" />
            <view v-else class="xpic xpic-empty"><text class="xpic-txt">{{ firstChar(g.title) }}</text></view>
            <view class="xtag" :class="'xtag-' + g.platform"><text class="xtag-txt">{{ platformName(g.platform) }}</text></view>
            <view class="xmain">
              <text class="xtitle">{{ g.title }}</text>
              <view class="xprices">
                <text v-if="g.finalPrice" class="xfinal">到手 ¥{{ g.finalPrice }}</text>
                <text v-if="g.rebate != null" class="xrebate">返 ¥{{ g.rebate }}</text>
              </view>
            </view>
            <view class="xgo" @tap="goCross(g)"><text class="xgo-txt">去{{ platformName(g.platform) }}</text></view>
          </view>
        </view>
        <!-- service-card（29 美团红包卡） -->
        <view v-else-if="m.kind === 'service_card'" class="scard">
          <view class="scard-logo"><text class="scard-logo-txt">{{ firstChar(m.service.name) }}</text></view>
          <view class="scard-main">
            <text class="scard-title">{{ m.service.name }}</text>
            <text class="scard-sub">{{ m.service.cat_name }} · 一键直达</text>
          </view>
          <view class="scard-btn" @tap="goCardItem(m.service)"><text class="scard-btn-txt">前往</text></view>
        </view>
        <!-- parse-card（29C 大登机牌：52 图位 + 识别列 + 返¥角标 + 转链条 + 口令行） -->
        <view v-else-if="m.kind === 'parse_card'" class="pcard">
          <view class="pcard-top">
            <image v-if="m.goods && m.goods.pic" class="pcard-pic" :src="m.goods.pic" mode="aspectFill" />
            <view v-else class="pcard-pic pcard-pic-empty"><text class="pcard-pic-txt">{{ firstChar(m.goods?.title || platformName(m.link.platform)) }}</text></view>
            <view class="pcard-info">
              <view class="pcard-meta-row">
                <view class="pcard-tag"><text class="pcard-tag-txt">识别</text></view>
                <text class="pcard-meta">{{ pcardMeta(m) }}</text>
              </view>
              <text v-if="m.goods" class="pcard-title">{{ m.goods.title }}</text>
              <view v-if="m.goods && m.goods.finalPrice" class="pcard-price-row">
                <text class="pcard-price-label">到手</text>
                <text class="pcard-price">¥{{ m.goods.finalPrice }}</text>
              </view>
            </view>
            <view v-if="m.link.rebate != null" class="pcard-stamp"><text class="pcard-stamp-txt">返¥{{ m.link.rebate }}</text></view>
          </view>
          <view class="pcard-strip">
            <text class="pcard-strip-l">AI 已转链 · 返利通道已挂本站</text>
            <text class="pcard-strip-r">{{ platformEn(m.link.platform) }} → 返利舱</text>
          </view>
          <view class="pcard-body">
            <view class="pcard-link">
              <text class="pcard-url" selectable>{{ m.link.tkl || m.link.url }}</text>
              <text class="pcard-hint">{{ pcardHint(m) }}</text>
            </view>
            <view class="pcard-copy" @tap="copyLink(m.link)"><text class="pcard-copy-txt">复制口令</text></view>
          </view>
        </view>
        <!-- cross-list（29C 同款跨平台出票：40 图位 + 平台标 + 到手价 + 返¥ + 去XX） -->
        <view v-else-if="m.kind === 'cross_list'" class="xwrap">
          <view class="xhead">
            <text class="xhead-b">同款其他平台也出票</text>
            <text class="xhead-s">京东 / 拼多多 / 唯品会 · 直跳官方小程序</text>
          </view>
          <view v-for="(x, i) in m.items" :key="i" class="xcard">
            <image v-if="x.pic" class="xpic" :src="x.pic" mode="aspectFill" />
            <view v-else class="xpic xpic-empty"><text class="xpic-txt">{{ firstChar(x.title) }}</text></view>
            <view class="xtag" :class="'xtag-' + x.platform"><text class="xtag-txt">{{ platformName(x.platform) }}</text></view>
            <view class="xmain">
              <text class="xtitle">{{ x.title }}</text>
              <view class="xprices">
                <text v-if="x.finalPrice" class="xfinal">到手 ¥{{ x.finalPrice }}</text>
                <text v-if="x.rebate != null" class="xrebate">返 ¥{{ x.rebate }}</text>
              </view>
            </view>
            <view class="xgo" @tap="goCross(x)"><text class="xgo-txt">去{{ platformName(x.platform) }}</text></view>
          </view>
        </view>
        <!-- service-list（多命中：分类展开 / 权益档位列表，每项带 track 分发） -->
        <view v-else-if="m.kind === 'service_list'" class="slist">
          <view v-for="(s, i) in m.items" :key="i" class="slist-row" @tap="goCardItem(s)">
            <view class="scard-logo"><text class="scard-logo-txt">{{ firstChar(s.name) }}</text></view>
            <view class="slist-main">
              <text class="slist-name">{{ s.name }}</text>
              <text class="slist-sub">{{ s.cat_name }} · {{ trackLabel(s.track) }}</text>
            </view>
            <view class="slist-go"><text class="slist-go-txt">前往</text></view>
          </view>
        </view>
      </view>

      <view class="foot-safe" />
      </view>
    </scroll-view>

    <!-- 输入条（29 底部：圆角输入 + 玫红圆发送钮） -->
    <view class="input-bar">
      <view class="clear-entry" @tap="clearHistory"><text class="clear-txt">清空</text></view>
      <input v-model="draft" class="input" placeholder="问点啥，或直接贴链接 / 口令" confirm-type="send" @confirm="send(draft)" />
      <view class="send-btn" :class="{ sending }" @tap="send(draft)"><text class="send-txt">➤</text></view>
    </view>
    <view class="ai-claim"><text class="ai-claim-txt">内容由 AI 生成，仅供参考</text></view>
  </view>
</template>

<script>
/**
 * mini-29 AI 助手对话页（决策 #46/#47，2026-10-07 定稿）
 * 三态：空态（29B 能力全景）/ 对话（29 出票亭）/ 转链（29C 登机牌）。
 * 管线在服务端（routes/chat.ts L0~L3）；本页消费 SSE 事件流 intent/text_delta/card/done/error。
 * 打字机 = 本地逐字追加（非滚动特效，D先生 铁律）；小程序端 uni.request enableChunked 接 SSE。
 * 返利数字 = 服务端按「上游佣金 × 用户等级自购比例」算好的 user_rebate，无则不渲染该行（绝不编数）。
 */
import { API_BASE, request, getToken } from '../../utils/request.js';
import { onGoodsTap, goUnion } from '../../core/link';

export default {
  data() {
    return {
      draft: '',
      sending: false,
      sessionId: '',
      msgs: [],
      chips: [],
      suggests: [],
      badges: { services: '—', rights: '—', platforms: 4 },
      hasMoreHistory: false,
      historyCursor: 0,
      refreshing: false,
      scrollTop: 0,
      MATRIX: [
        { title: '搜券比价', sub: '四大平台全网帮你找低价', tone: 't-pink', brands: ['淘', '京', '拼', '唯'], q: '帮我找瑞幸 9.9 的券' },
        { title: '转链返利', sub: '贴个口令链接就变返利价', tone: 't-gold', brands: ['链', '返'], q: '贴口令链接给我，出票变返利价~' },
        { title: '品牌点餐', sub: '麦肯瑞茶 13+ 品牌 5 折起点', tone: 't-plain', brands: ['麦', '肯', '瑞', '茶'], q: '帮我点一份肯德基' },
        { title: '电影票', sub: '热映大片折扣出票', tone: 't-softpink', brands: ['▶'], q: '帮我买电影票' },
        { title: '会员权益', sub: '83 项 VIP 低价充，腾讯优 B 全有', tone: 't-outline', brands: ['腾', '爱', 'B'], q: '充视频 VIP' },
        { title: '打车出行', sub: '滴滴 高德 花小猪券包日领', tone: 't-outline-gold', brands: ['滴', '高', '哈'], q: '领一张打车券' },
      ],
    };
  },
  onShow() {
    if (!getToken()) {
      uni.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => uni.navigateBack({ fail: () => {} }), 800);
      return;
    }
    if (!this.booted) {
      this.booted = true;
      this.sessionId = `s-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
      this.loadBoot();
      this.loadHistory();
    }
  },
  methods: {
    async loadBoot() {
      try {
        const d = await request('/api/chat/boot');
        this.chips = d.chips ?? [];
        this.suggests = d.suggests ?? [];
        this.badges = d.badges ?? this.badges;
        if (d.welcome) this.welcome = d.welcome;
      } catch { /* boot 失败不阻塞，用默认值 */ }
    },
    async loadHistory() {
      try {
        const d = await request('/api/chat/history');
        const items = d.items ?? [];
        this.hasMoreHistory = d.hasMore ?? false;
        this.historyCursor = items.length ? Number(items[0].id) : 0;
        this.msgs = items.reverse().map((it) => this.fromHistory(it));
        this.scrollBottom();
      } catch { /* 历史失败从空态开始 */ }
    },
    /** 上拉（顶部下拉刷新触发）拉更早历史 */
    async loadEarlier() {
      if (!this.hasMoreHistory) { this.refreshing = false; return; }
      try {
        const d = await request(`/api/chat/history?before=${this.historyCursor}`);
        const items = (d.items ?? []).reverse().map((it) => this.fromHistory(it));
        this.historyCursor = (d.items ?? []).length ? Number(d.items[0].id) : 0;
        this.hasMoreHistory = d.hasMore ?? false;
        this.msgs = [...items, ...this.msgs];
      } catch { /* ignore */ }
      this.refreshing = false;
    },
    fromHistory(it) {
      const meta = it.meta ?? {};
      // goods_card：新历史 meta.items 全量回放（真标题/图/价，29C 登机牌样式）；
      //   旧历史只有 refs id 列表 → 诚实降级文本（不再重建「搜…命中3件」假标题空图卡）
      if (it.kind === 'goods_card') {
        if (Array.isArray(meta.items) && meta.items.length) return { role: 'assistant', kind: 'goods_card', items: meta.items };
        return { role: 'assistant', kind: 'text', content: `${it.content}（卡片已过期，重新问一次看最新价）` };
      }
      // service_card/list：meta.items 全量回放（2026-10-08 第三次翻车修复——旧 meta 只有
      //   {name,tracks}，重进降级成「找到 N 项服务」光秃文本）；旧历史诚实降级不再造假
      if (it.kind === 'service_card') {
        const svc = Array.isArray(meta.items) && meta.items.length ? meta.items[0] : (meta.service ?? null);
        return svc ? { role: 'assistant', kind: 'service_card', service: svc } : { role: 'assistant', kind: 'text', content: `${it.content}（卡片已过期，重新问一次）` };
      }
      if (it.kind === 'service_list') {
        if (Array.isArray(meta.items) && meta.items.length) return { role: 'assistant', kind: 'service_list', items: meta.items };
        return { role: 'assistant', kind: 'text', content: `${it.content}（卡片已过期，重新问一次）` };
      }
      // cross_list：meta.cross 全量回放同款跨平台卡
      if (it.kind === 'cross_list') {
        if (Array.isArray(meta.cross) && meta.cross.length) return { role: 'assistant', kind: 'cross_list', items: meta.cross };
        return { role: 'assistant', kind: 'text', content: it.content };
      }
      // parse_card：meta.link 全量回放登机牌（link 内嵌 platform/返利/口令）；旧历史无 link → 文本
      if (it.kind === 'parse_card') {
        if (meta.link) return { role: 'assistant', kind: 'parse_card', link: meta.link, goods: meta.goods ?? null };
        return { role: 'assistant', kind: 'text', content: it.content };
      }
      return { role: it.role, kind: 'text', content: it.content };
    },
    send(text) {
      const msg = String(text ?? '').trim();
      if (!msg || this.sending) return;
      this.draft = '';
      this.msgs.push({ role: 'user', kind: 'text', content: msg });
      this.scrollBottom();
      this.sending = true;
      this.createSse({ message: msg, session_id: this.sessionId });
    },
    /** L1：chips 点击 0 token 直达 */
    sendChip(c) {
      if (this.sending) return;
      this.msgs.push({ role: 'user', kind: 'text', content: c.name });
      this.scrollBottom();
      this.sending = true;
      this.createSse({ chip: c, session_id: this.sessionId });
    },
    createSse(body) {
      const task = uni.request({
        url: `${API_BASE}/api/chat/sse`,
        method: 'POST',
        data: body,
        header: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
        enableChunked: true, // mp-weixin SSE 关键开关
        timeout: 60000,
        success: () => {},
        fail: () => {
          this.sending = false;
          this.pushAssistantText('网络开小差了，稍后再试~');
        },
      });
      let buf = '';
      task.onChunkReceived((r) => {
        buf += this.decode(r.data);
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          this.handleSseBlock(block);
        }
      });
      this.currentTask = task;
    },
    /**
     * SSE 分片解码：流式 UTF-8。
     * ⛔ 不能用 String.fromCharCode 逐字节转——中文多字节序列会被按 Latin-1 拆碎（2026-10-07 真机乱码根因）；
     * 且多字节字符可能被切在两个 chunk 边界，不完整序列须留到下一片拼齐。
     */
    decode(data) {
      if (typeof data === 'string') return data;
      const ab = data instanceof ArrayBuffer ? data : data.buffer;
      if (!ab) return '';
      if (!this._pend) this._pend = []; // 非响应式字节缓冲
      const pend = this._pend;
      const arr = new Uint8Array(ab);
      for (let k = 0; k < arr.length; k++) pend.push(arr[k]);
      let out = '';
      let i = 0;
      const n = pend.length;
      while (i < n) {
        const b = pend[i];
        let len = 0;
        if (b < 0x80) len = 1;
        else if (b >= 0xc2 && b < 0xe0) len = 2;
        else if (b >= 0xe0 && b < 0xf0) len = 3;
        else if (b >= 0xf0 && b < 0xf5) len = 4;
        else { i += 1; continue; } // 非法首字节，跳过
        if (i + len > n) break;    // 序列不完整 → 留给下一片
        let cp = len === 1 ? b : b & (0xff >> (len + 1));
        let bad = false;
        for (let j = 1; j < len; j++) {
          const cb = pend[i + j];
          if ((cb & 0xc0) !== 0x80) { bad = true; break; }
          cp = (cp << 6) | (cb & 0x3f);
        }
        if (bad) { i += 1; continue; }
        out += String.fromCodePoint(cp);
        i += len;
      }
      if (i > 0) pend.splice(0, i);
      return out;
    },
    handleSseBlock(block) {
      let ev = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) return;
      let j;
      try { j = JSON.parse(data); } catch { return; }
      if (ev === 'intent') { /* 意图只做埋点展示，卡片随后到 */ }
      else if (ev === 'text_delta') this.pushAssistantText(j.t ?? '');
      else if (ev === 'card') this.pushCard(j);
      else if (ev === 'done') { this.sending = false; this._pend = []; this.sessionId = j.session_id ?? this.sessionId; }
      else if (ev === 'error') { this.sending = false; this._pend = []; this.pushAssistantText(j.message ?? '出错了，稍后再试'); }
    },
    pushAssistantText(full) {
      // 找正在生成的末条 assistant text 续写；没有则新开 + 打字机
      let last = this.msgs[this.msgs.length - 1];
      if (!last || last.role !== 'assistant' || last.kind !== 'text' || !last.typing) {
        last = { role: 'assistant', kind: 'text', content: '', typing: true };
        this.msgs.push(last);
      }
      const target = last;
      const source = full;
      const step = () => {
        if (target.content.length >= source.length) {
          target.typing = false;
          this.scrollBottom();
          return;
        }
        target.content = source.slice(0, target.content.length + 2); // 逐字追加（非滚动特效）
        this.scrollBottom();
        setTimeout(step, 30);
      };
      step();
    },
    pushCard(j) {
      if (j.kind === 'goods_card') this.msgs.push({ role: 'assistant', kind: 'goods_card', items: j.items ?? [] });
      else if (j.kind === 'service_card') this.msgs.push({ role: 'assistant', kind: 'service_card', service: j.service });
      else if (j.kind === 'service_list') this.msgs.push({ role: 'assistant', kind: 'service_list', items: j.items ?? [] });
      else if (j.kind === 'parse_card') this.msgs.push({ role: 'assistant', kind: 'parse_card', link: j.link, goods: j.goods ?? null });
      else if (j.kind === 'cross_list') this.msgs.push({ role: 'assistant', kind: 'cross_list', items: j.items ?? [] });
      this.scrollBottom();
    },
    /** 29C 大登机牌：识别行 meta 文案（平台 · 原价 · 券） */
    pcardMeta(m) {
      const parts = [this.platformName(m.link.platform) + '商品'];
      if (m.goods?.price) parts.push('原价 ¥' + m.goods.price);
      if (m.goods?.coupon) parts.push('券已叠加');
      return parts.join(' · ');
    },
    pcardHint(m) {
      return m.link.rebate != null
        ? '下单确认后 ¥' + m.link.rebate + ' 返利自动入账'
        : '下单确认后返利自动入账';
    },
    platformEn(p) {
      return ({ jd: 'JD', tb: 'TAOBAO', pdd: 'PDD', vip: 'VIP' })[p] || String(p).toUpperCase();
    },
    /** 跨平台卡点击：按需转链 + 跳官方小程序（复用 core/link goUnion 四平台矩阵，含复制兜底） */
    goCross(x) {
      goUnion({ platform: x.platform, id: x.id, title: x.title, price: x.finalPrice, raw: { goods_sign: x.sign ?? '' } });
    },
    /** 卡片项分发（单卡/列表项同走此口）：rights → life_05 半屏 + cid 档位；其余 → goService 三轨 */
    goCardItem(s) {
      if (s?.track === 'rights') {
        if (!s?.cid) { uni.showToast({ title: '该权益暂未配置兑换档位', icon: 'none' }); return; }
        // #ifndef MP-WEIXIN
        uni.navigateTo({ url: '/pages/rights/levels', fail: () => {} });
        return;
        // #endif
        // #ifdef MP-WEIXIN
        request('/api/site/brand-launch?code=life_05')
          .then((d) => this.doLaunch(d, String(s.cid)))
          .catch((e) => uni.showToast({ title: e.message ?? '呼起配置未录入', icon: 'none' }));
        // #endif
        return;
      }
      this.goService(s);
    },
    trackLabel(t) {
      return ({ rights: '积分兑换', plugin: '站内直达', halfscreen: '半屏呼起', act: '领券直达', launch: '一键呼起', self: '到店团购' })[t] ?? '直达';
    },
    /** 转链卡跳转矩阵已统一收编 core/link.goUnion（29C 起跨平台卡/搜索卡/口令跳转同走该矩阵） */
    goCross(x) {
      if (!x?.platform) { uni.showToast({ title: '这条卡片缺少平台信息，重新问一次', icon: 'none' }); return; }
      goUnion({ platform: x.platform, id: x.id, title: x.title, price: x.finalPrice, raw: { goods_sign: x.sign ?? '' } });
    },
    goService(s) {
      // 与 search-result.launchService 同协议（07B 铁律：按 brand_code 精确，服务端定轨道，端上只分发）
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
    /** 呼起三轨分发（与 search-result.doLaunch 同构：plugin 站内 / halfscreen 半屏 / h5url 联盟转链） */
    doLaunch(d, cid) {
      if (!d?.path && !d?.url) {
        uni.showToast({ title: '该服务暂未配置呼起', icon: 'none' });
        return;
      }
      if (d.mode === 'h5url') {
        // 联盟 H5 / 淘口令类 → 走 core/link 统一转链协议
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
      if (d.mode === 'plugin') {
        uni.navigateTo({ url: d.path, fail: () => uni.showToast({ title: '插件页打开失败', icon: 'none' }) });
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
    copyLink(link) {
      this.copyText(link.tkl || link.url || '');
    },
    copyText(t) {
      if (!t) { uni.showToast({ title: '链接为空', icon: 'none' }); return; }
      uni.setClipboardData({
        data: t,
        success: () => uni.showToast({ title: '已复制，打开对应 App 下单', icon: 'none' }),
      });
    },
    async clearHistory() {
      if (!this.msgs.length) return;
      const cf = await new Promise((r) => uni.showModal({ title: '清空会话', content: '确定清空全部对话记录？', success: (res) => r(res.confirm) }));
      if (!cf) return;
      try {
        await request('/api/chat/history', { method: 'DELETE' });
        this.msgs = [];
        this.hasMoreHistory = false;
        uni.showToast({ title: '已清空', icon: 'none' });
      } catch (e) {
        uni.showToast({ title: String(e.message ?? '清空失败'), icon: 'none' });
      }
    },
    firstChar(s) {
      return String(s ?? '').trim().charAt(0) || '品';
    },
    platformName(p) {
      return ({ jd: '京东', tb: '淘宝', pdd: '拼多多', vip: '唯品会' })[p] ?? p;
    },
    scrollBottom() {
      setTimeout(() => { this.scrollTop = this.scrollTop > 0 ? this.scrollTop - 1 : 1; }, 50);
      // scroll-view 置底：用超大量触发（uni 常规做法）
      setTimeout(() => { this.scrollTop = 99999 + Math.random(); }, 120);
    },
  },
};
</script>

<style scoped>
.chat-page { display: flex; flex-direction: column; height: 100vh; background: var(--fyt-bg, #fff6e9); }

.chat-body { flex: 1; min-height: 0; }
/* 水平内边距放内层普通 view（scroll-view padding 不可靠，见模板注释） */
.chat-inner { padding: 0 24rpx; }

/* ── 空态（29B） ── */
.empty { display: flex; flex-direction: column; align-items: center; padding: 40rpx 0 30rpx; }
.e-avatar { width: 168rpx; height: 168rpx; border-radius: 50%; background: var(--fyt-surface, #fff);
  border: 6rpx solid var(--fyt-primary-dark, #a31245); box-shadow: var(--fyt-shadow-pop);
  display: flex; align-items: center; justify-content: center; margin-bottom: 24rpx; }
.e-avatar-face { font-size: 72rpx; }
.e-hello { font-size: 40rpx; font-weight: 900; color: var(--fyt-text, #2b2b33); }
.e-sub { font-size: 26rpx; color: var(--fyt-text-2, #8c8577); margin-top: 8rpx; }
.e-badges { display: flex; gap: 16rpx; margin-top: 24rpx; flex-wrap: wrap; justify-content: center; }
.e-badge { background: var(--fyt-surface, #fff); border: 3rpx solid var(--fyt-primary, #e8336d);
  border-radius: var(--fyt-radius-full, 999rpx); padding: 8rpx 22rpx; box-shadow: var(--fyt-shadow-pop); }
.e-badge-txt { color: var(--fyt-primary, #e8336d); font-size: 22rpx; font-weight: 800; }
.e-sec-title { align-self: flex-start; font-size: 30rpx; font-weight: 900; color: var(--fyt-text, #2b2b33);
  margin: 36rpx 0 18rpx; }
.e-matrix { display: flex; flex-wrap: wrap; width: 100%; }
/* 宫格终极定式（mini-06 同款）：外层格子零水平盒模型属性（无 padding/border/margin），
   视觉卡的水平间距全放内层 .e-card 的 margin——content-box 语义下任何解析都不可能溢出 */
.e-cell { flex: 1 1 300rpx; min-width: 0; display: flex; flex-direction: column; padding: 0 0 20rpx; }
.e-card { flex: 1; margin: 0 10rpx; border-radius: var(--fyt-radius-lg, 24rpx); padding: 24rpx;
  border: var(--fyt-border-thick, 3rpx) solid var(--fyt-primary-dark, #a31245);
  box-shadow: var(--fyt-shadow-pop); display: flex; flex-direction: column; gap: 8rpx; }
.t-pink { background: var(--fyt-primary, #e8336d); }
.t-pink .e-cell-title, .t-pink .e-cell-sub { color: var(--fyt-on-primary, #fff); }
.t-gold { background: var(--fyt-secondary, #ffaa1d); }
.t-gold .e-cell-title { color: var(--fyt-primary-dark, #a31245); }
.t-gold .e-cell-sub { color: rgba(163, 18, 69, 0.8); }
.t-plain { background: var(--fyt-surface, #fff); }
.t-softpink { background: #ffd9e6; }
.t-plain .e-cell-title, .t-softpink .e-cell-title { color: var(--fyt-text, #2b2b33); }
.t-plain .e-cell-sub, .t-softpink .e-cell-sub { color: var(--fyt-text-2, #8c8577); }
.t-outline { background: var(--fyt-surface, #fff); border-style: dashed; }
.t-outline-gold { background: var(--fyt-surface, #fff); border-color: var(--fyt-secondary, #ffaa1d); }
.t-outline .e-cell-title, .t-outline-gold .e-cell-title { color: var(--fyt-text, #2b2b33); }
.t-outline .e-cell-sub, .t-outline-gold .e-cell-sub { color: var(--fyt-text-2, #8c8577); }
.e-cell-title { font-size: 30rpx; font-weight: 900; }
.e-cell-sub { font-size: 22rpx; }
.e-cell-dots { display: flex; gap: 10rpx; margin-top: 6rpx; }
.e-dot { width: 52rpx; height: 52rpx; border-radius: 50%; background: var(--fyt-surface, #fff);
  border: 3rpx solid var(--fyt-primary-dark, #a31245); color: var(--fyt-primary, #e8336d);
  font-size: 22rpx; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.e-chips { display: flex; flex-wrap: wrap; gap: 16rpx; width: 100%; }
.e-chip { background: var(--fyt-surface, #fff); border: 3rpx solid var(--fyt-primary, #e8336d);
  border-radius: var(--fyt-radius-full, 999rpx); padding: 12rpx 28rpx; box-shadow: var(--fyt-shadow-pop); }
.e-chip-txt { color: var(--fyt-primary, #e8336d); font-size: 26rpx; font-weight: 700; }

/* ── 消息行 ── */
.row { display: flex; margin-top: 28rpx; align-items: flex-start; }
.row-me { justify-content: flex-end; }
.row-ai { justify-content: flex-start; }
.bot-avatar { width: 72rpx; height: 72rpx; border-radius: 50%; background: var(--fyt-surface, #fff);
  border: 3rpx solid var(--fyt-primary-dark, #a31245); box-shadow: var(--fyt-shadow-pop);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 16rpx; }
.bot-face { font-size: 30rpx; }
.bubble { max-width: 78%; border-radius: 24rpx; padding: 20rpx 26rpx;
  border: var(--fyt-border-thick, 3rpx) solid var(--fyt-primary-dark, #a31245); }
.bubble-me { background: var(--fyt-primary, #e8336d); border-top-right-radius: 6rpx; box-shadow: var(--fyt-shadow-pop); }
.bubble-ai { background: var(--fyt-surface, #fff); border-top-left-radius: 6rpx; box-shadow: var(--fyt-shadow-pop); }
.bubble-txt { font-size: 28rpx; line-height: 1.6; word-break: break-all; }
.txt-on-primary { color: var(--fyt-on-primary, #fff); }

/* goods-card 样式已并入 xwrap/xcard（29C：搜索流=跨平台出票同款行卡，2026-10-08 D先生 实锤定稿） */

/* ── service-card（29 红包卡） ── */
.scard { flex: 1; min-width: 0; background: var(--fyt-surface, #fff); border: var(--fyt-border-thick, 3rpx) solid var(--fyt-primary-dark, #a31245);
  border-radius: var(--fyt-radius-lg, 24rpx); box-shadow: var(--fyt-shadow-pop);
  display: flex; align-items: center; gap: 18rpx; padding: 24rpx; }
.scard-logo { width: 84rpx; height: 84rpx; border-radius: 50%; background: var(--fyt-secondary, #ffaa1d);
  border: 3rpx solid var(--fyt-primary-dark, #a31245); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.scard-logo-txt { color: var(--fyt-primary-dark, #a31245); font-size: 36rpx; font-weight: 900; }
.scard-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4rpx; }
.scard-title { font-size: 30rpx; font-weight: 900; color: var(--fyt-text, #2b2b33); }
.scard-sub { font-size: 22rpx; color: var(--fyt-text-2, #8c8577); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scard-btn { background: var(--fyt-secondary, #ffaa1d); border: 3rpx solid var(--fyt-primary-dark, #a31245);
  border-radius: var(--fyt-radius-full, 999rpx); padding: 12rpx 26rpx; flex-shrink: 0; box-shadow: var(--fyt-shadow-btn); }
.scard-btn-txt { color: var(--fyt-primary-dark, #a31245); font-size: 26rpx; font-weight: 800; }

/* ── parse-card（29C 大登机牌） ── */
.pcard { flex: 1; min-width: 0; background: var(--fyt-surface, #fff); border: var(--fyt-border-thick, 3rpx) solid var(--fyt-primary-dark, #a31245);
  border-radius: var(--fyt-radius-lg, 24rpx); box-shadow: var(--fyt-shadow-pop); overflow: hidden; }
/* 头部：52 图位 + 识别列 + 返¥角标（浅粉底） */
.pcard-top { display: flex; align-items: flex-start; gap: 18rpx; padding: 24rpx; background: #ffd9e6; }
.pcard-pic { width: 104rpx; height: 104rpx; border-radius: 16rpx; background: #fff;
  border: 3rpx solid var(--fyt-primary, #e8336d); flex-shrink: 0; }
.pcard-pic-empty { display: flex; align-items: center; justify-content: center; }
.pcard-pic-txt { color: var(--fyt-primary, #e8336d); font-size: 40rpx; font-weight: 900; }
.pcard-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8rpx; }
.pcard-meta-row { display: flex; align-items: center; gap: 12rpx; min-width: 0; }
.pcard-tag { background: var(--fyt-primary, #e8336d); border-radius: var(--fyt-radius-sm, 8rpx); padding: 4rpx 14rpx; flex-shrink: 0; }
.pcard-tag-txt { color: var(--fyt-on-primary, #fff); font-size: 20rpx; font-weight: 800; }
.pcard-meta { font-size: 22rpx; color: var(--fyt-text-2, #8c8577); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcard-title { font-size: 30rpx; font-weight: 900; color: var(--fyt-text, #2b2b33);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcard-price-row { display: flex; align-items: baseline; gap: 8rpx; }
.pcard-price-label { font-size: 22rpx; color: var(--fyt-primary, #e8336d); font-weight: 700; }
.pcard-price { font-size: 40rpx; color: var(--fyt-primary, #e8336d); font-weight: 900; }
.pcard-stamp { border: 3rpx solid var(--fyt-primary, #e8336d); border-radius: var(--fyt-radius-sm, 8rpx);
  padding: 6rpx 12rpx; transform: rotate(8deg); background: rgba(255, 255, 255, 0.85); flex-shrink: 0; }
.pcard-stamp-txt { color: var(--fyt-primary, #e8336d); font-size: 22rpx; font-weight: 900; }
/* 转链状态条 */
.pcard-strip { display: flex; align-items: center; justify-content: space-between; gap: 12rpx;
  padding: 12rpx 24rpx; background: #fff0f5; border-left: 8rpx solid var(--fyt-primary, #e8336d); }
.pcard-strip-l { font-size: 22rpx; font-weight: 800; color: var(--fyt-primary, #e8336d); }
.pcard-strip-r { font-size: 20rpx; color: var(--fyt-text-2, #8c8577); letter-spacing: 1rpx; flex-shrink: 0; }
/* 口令行 */
.pcard-body { display: flex; align-items: center; gap: 16rpx; padding: 22rpx 24rpx; }
.pcard-link { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6rpx; }
.pcard-url { font-size: 28rpx; font-weight: 800; color: var(--fyt-text, #2b2b33); word-break: break-all; }
.pcard-hint { font-size: 20rpx; color: var(--fyt-text-2, #8c8577); }
.pcard-copy { background: var(--fyt-secondary, #ffaa1d); border: 3rpx solid var(--fyt-primary-dark, #a31245);
  border-radius: var(--fyt-radius-md, 14rpx); padding: 16rpx 22rpx; flex-shrink: 0; box-shadow: var(--fyt-shadow-btn); }
.pcard-copy-txt { color: var(--fyt-primary-dark, #a31245); font-size: 26rpx; font-weight: 900; }

/* ── cross-list（29C 同款跨平台出票） ── */
.xwrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 16rpx; }
.xhead { display: flex; align-items: baseline; gap: 12rpx; flex-wrap: wrap; padding: 4rpx 4rpx 0; }
.xhead-tag { align-self: center; background: var(--fyt-primary, #e8336d); border: 3rpx solid var(--fyt-primary-dark, #a31245);
  border-radius: var(--fyt-radius-sm, 8rpx); padding: 4rpx 14rpx; box-shadow: var(--fyt-shadow-btn); }
.xhead-tag-txt { color: var(--fyt-on-primary, #fff); font-size: 22rpx; font-weight: 900; }
.xhead-b { font-size: 26rpx; font-weight: 900; color: var(--fyt-text, #2b2b33); }
.xhead-s { font-size: 20rpx; color: var(--fyt-text-2, #8c8577); }
.xcard { display: flex; align-items: center; gap: 14rpx; background: var(--fyt-surface, #fff);
  border: var(--fyt-border-thick, 3rpx) solid var(--fyt-primary-dark, #a31245);
  border-radius: var(--fyt-radius-lg, 24rpx); box-shadow: var(--fyt-shadow-pop); padding: 20rpx; }
.xpic { width: 80rpx; height: 80rpx; border-radius: 12rpx; background: var(--fyt-bg, #fff6e9);
  border: 2rpx solid var(--fyt-border-default, #f2ddc0); flex-shrink: 0; }
.xpic-empty { display: flex; align-items: center; justify-content: center; }
.xpic-txt { color: var(--fyt-primary, #e8336d); font-size: 32rpx; font-weight: 900; }
.xtag { border-radius: var(--fyt-radius-sm, 8rpx); padding: 6rpx 14rpx; flex-shrink: 0; }
.xtag-txt { font-size: 20rpx; font-weight: 800; }
.xtag-jd { background: #2b2b33; }
.xtag-jd .xtag-txt { color: #fff; }
.xtag-pdd { background: var(--fyt-primary, #e8336d); }
.xtag-pdd .xtag-txt { color: var(--fyt-on-primary, #fff); }
.xtag-vip { background: var(--fyt-surface, #fff); border: 2rpx solid var(--fyt-primary, #e8336d); }
.xtag-vip .xtag-txt { color: var(--fyt-primary, #e8336d); }
.xmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6rpx; }
.xtitle { font-size: 26rpx; font-weight: 800; color: var(--fyt-text, #2b2b33);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.xprices { display: flex; align-items: baseline; gap: 12rpx; }
.xfinal { font-size: 30rpx; font-weight: 900; color: var(--fyt-primary, #e8336d); }
.xrebate { font-size: 20rpx; font-weight: 700; color: var(--fyt-primary, #e8336d);
  background: #ffd9e6; border-radius: var(--fyt-radius-sm, 8rpx); padding: 2rpx 10rpx; }
.xgo { background: var(--fyt-secondary, #ffaa1d); border: 3rpx solid var(--fyt-primary-dark, #a31245);
  border-radius: var(--fyt-radius-full, 999rpx); padding: 12rpx 20rpx; flex-shrink: 0; box-shadow: var(--fyt-shadow-btn); }
.xgo-txt { color: var(--fyt-primary-dark, #a31245); font-size: 24rpx; font-weight: 900; }

/* ── service-list（多命中列表） ── */
.slist { flex: 1; min-width: 0; background: var(--fyt-surface, #fff); border: var(--fyt-border-thick, 3rpx) solid var(--fyt-primary-dark, #a31245);
  border-radius: var(--fyt-radius-lg, 24rpx); box-shadow: var(--fyt-shadow-pop); overflow: hidden; }
.slist-row { display: flex; align-items: center; gap: 16rpx; padding: 18rpx 22rpx; }
.slist-row + .slist-row { border-top: 2rpx dashed var(--fyt-border-default, #f2ddc0); }
.slist-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4rpx; }
.slist-name { font-size: 27rpx; font-weight: 800; color: var(--fyt-text, #2b2b33); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slist-sub { font-size: 20rpx; color: var(--fyt-text-2, #8c8577); }
.slist-go { background: var(--fyt-secondary, #ffaa1d); border: 3rpx solid var(--fyt-primary-dark, #a31245);
  border-radius: var(--fyt-radius-full, 999rpx); padding: 8rpx 22rpx; flex-shrink: 0; box-shadow: var(--fyt-shadow-btn); }
.slist-go-txt { color: var(--fyt-primary-dark, #a31245); font-size: 24rpx; font-weight: 800; }

.foot-safe { height: 40rpx; }

/* ── 输入条 ── */
.input-bar { display: flex; align-items: center; gap: 16rpx; padding: 16rpx 24rpx;
  background: var(--fyt-surface, #fff); border-top: 2rpx solid var(--fyt-border-default, #f2ddc0); }
.clear-entry { flex-shrink: 0; padding: 8rpx 4rpx; }
.clear-txt { font-size: 22rpx; color: var(--fyt-text-3, #b9b0a0); }
.input { flex: 1; background: var(--fyt-bg, #fff6e9); border: 2rpx solid var(--fyt-border-default, #f2ddc0);
  border-radius: var(--fyt-radius-full, 999rpx); padding: 16rpx 28rpx; font-size: 26rpx; color: var(--fyt-text, #2b2b33); }
.send-btn { width: 88rpx; height: 88rpx; border-radius: 50%; background: var(--fyt-primary, #e8336d);
  border: var(--fyt-border-thick, 3rpx) solid var(--fyt-primary-dark, #a31245); box-shadow: var(--fyt-shadow-btn);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.send-btn.sending { opacity: 0.5; }
.send-txt { color: var(--fyt-on-primary, #fff); font-size: 36rpx; }
.ai-claim { text-align: center; padding: 8rpx 0 calc(16rpx + env(safe-area-inset-bottom)); background: var(--fyt-surface, #fff); }
.ai-claim-txt { font-size: 20rpx; color: var(--fyt-text-3, #b9b0a0); }
</style>
