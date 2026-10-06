<template>
  <!-- admin-30 DIY 页面装修编辑器：左组件库 / 中 Schema 画布 / 右属性面板（只产 Schema，发布即下发双端） -->
  <div class="diy">
    <!-- 顶部操作条 -->
    <div class="opbar">
      <div class="op-left">
        <el-select v-model="page" class="page-select" size="large" @change="onSwitchPage">
          <el-option v-for="p in pageOptions" :key="p.page" :value="p.page" :label="p.label" />
        </el-select>
        <button class="ai-btn" @click="emit('regen-ai')">☁ cloudbase-agent AI 重页</button>
        <button v-if="page.startsWith('page-')" class="op-btn danger" @click="deletePage">删除页面</button>
      </div>
      <div class="op-right">
        <button class="op-btn" :disabled="ptr <= 0" @click="undo"><el-icon><RefreshLeft /></el-icon>撤销</button>
        <button class="op-btn" :disabled="ptr >= snapshots.length - 1" @click="redo"><el-icon><RefreshRight /></el-icon>重做</button>
        <button class="op-btn" @click="previewOpen = true"><el-icon><View /></el-icon>预览</button>
        <button class="op-btn ghost" :disabled="saving" @click="saveDraft">保存草稿</button>
        <button class="op-btn primary" :disabled="saving" @click="publish">发 布</button>
      </div>
    </div>
    <div class="state-line">
      <span>{{ pageLabel }}</span>
      <el-tag :type="status === 'published' ? 'success' : status === 'draft' ? 'warning' : 'info'" size="small">{{ statusText }}</el-tag>
      <span class="ver">v{{ version }}</span>
      <template v-if="base === 'published'">
        <span v-if="draftVersion" class="draft-hint">
          · 存在未发布草稿 v{{ draftVersion }}（{{ shortDay(draftUpdatedAt) }}）
          <el-link type="warning" :underline="false" @click="switchBase('draft')">切换到草稿</el-link>
        </span>
        <span v-else class="draft-hint ok">· 编辑基线=当前发布版</span>
      </template>
      <template v-else>
        <span class="draft-hint warn">
          · 草稿模式（AI 生成/手动草稿）
          <el-link type="primary" :underline="false" @click="switchBase('published')">回到发布版</el-link>
        </span>
      </template>
      <span v-if="dirty" class="dirty">· 未保存改动</span>
    </div>

    <div class="cols">
      <!-- 左：组件库 -->
      <section class="panel palette">
        <h3 class="panel-title">组件库</h3>
        <div v-for="g in paletteGroups" :key="g.name" class="pal-group">
          <h4 class="pal-group-name">{{ g.name }}</h4>
          <button
            v-for="it in g.items" :key="it.type"
            class="pal-item" :class="{ off: !it.on }"
            :title="it.on ? '点击添加到页面' : '组件随里程碑补齐'"
            @click="it.on && addFloor(it.type, it.label)"
          >
            <span class="pal-dots">⣿</span><span class="pal-label">{{ it.label }}</span>
            <span v-if="!it.on" class="pal-lock">未上线</span>
          </button>
        </div>
        <p class="pal-tip">点击组件添加到页面底部；Schema 驱动，保存发布后小程序 / H5 同稿生效。</p>
      </section>

      <!-- 中：画布 -->
      <section class="canvas-wrap">
        <div class="canvas-head">画布预览 · Schema 驱动 · 保存即下发小程序 <span class="zoom">100%</span></div>
        <div class="canvas-scroll">
          <div class="phone">
            <div class="phone-head">
              <div class="ph-logo">FYT360</div>
              <div class="ph-sub">吃喝玩乐购 · 一站式全变现</div>
            </div>
            <div class="phone-body">
              <template v-for="(f, i) in floors" :key="f.floor_id ?? i">
                <div class="floor" :class="{ sel: i === selIdx }" @click="selIdx = i">
                  <div class="floor-tag">{{ floorLabel(f.type) }}</div>
                  <div class="floor-tools" @click.stop>
                    <button :disabled="i === 0" @click="moveFloor(i, -1)">↑</button>
                    <button :disabled="i === floors.length - 1" @click="moveFloor(i, 1)">↓</button>
                    <button title="复制楼层" @click="copyFloor(i)">⧉</button>
                    <button class="danger" @click="delFloor(i)">✕</button>
                  </div>
                  <!-- 楼层预览（近似还原渲染器观感） -->
                  <FloorPreview :floor="f" />
                </div>
              </template>
              <div v-if="!floors.length" class="canvas-empty">
                <el-empty description="页面为空：从左侧组件库点击添加" :image-size="80" />
              </div>
            </div>
            <div class="phone-tabbar"><span class="on">🏠 首页</span><span>📋 订单</span><span>👤 我的</span></div>
          </div>
        </div>
      </section>

      <!-- 右：属性设置 -->
      <section class="panel props">
        <h3 class="panel-title">属性设置 · {{ sel ? floorLabel(sel.type) : '未选中' }}</h3>
        <template v-if="sel">
          <div class="prop-hint">{{ sel.floor_id }}</div>
          <!-- search-bar -->
          <template v-if="sel.type === 'search-bar'">
            <label class="f-label">组件标题</label>
            <el-input v-model="sel.props.logo_text" size="large" placeholder="券" />
            <label class="f-label">搜索提示词</label>
            <el-input v-model="sel.props.placeholder" size="large" />
            <label class="f-label">右侧动作文案</label>
            <el-input v-model="sel.props.action_text" size="large" />
          </template>
          <!-- swiper -->
          <template v-else-if="sel.type === 'swiper'">
            <div class="item-head" style="margin-top:2px;"><span>播放设置</span></div>
            <label class="f-label">自动轮播</label>
            <el-switch v-model="sel.props.autoplay" />
            <label class="f-label">切换间隔（毫秒）</label>
            <el-input-number v-model="sel.props.interval" :min="2000" :max="10000" :step="500" size="large" />
            <div v-for="(it, bi) in sel.props.items" :key="bi" class="item-card">
              <div class="item-head">
                <span>轮播 {{ bi + 1 }}</span>
                <button class="mini-del" title="编辑点击动作" @click="swiperEditIdx = swiperEditIdx === bi ? -1 : bi; ensureItemAction(it)">⚡</button>
                <button class="mini-del" @click="sel.props.items.splice(bi, 1); if (swiperEditIdx === bi) swiperEditIdx = -1">删除</button>
              </div>
              <label class="f-label">图片（≤3MB，设置后配色/表情不展示）</label>
              <div class="img-up-row">
                <img v-if="it.img" :src="it.img" class="img-up-preview" />
                <el-upload v-else :show-file-list="false" accept="image/png,image/jpeg,image/webp,image/gif" :http-request="(o) => onUploadImg(it, o)">
                  <button class="mini-up">⬆ 上传图片</button>
                </el-upload>
                <button v-if="it.img" class="mini-del" @click="it.img = ''">清除</button>
              </div>
              <label class="f-label">主标题</label>
              <el-input v-model="it.title" size="large" />
              <label class="f-label">强调词</label>
              <el-input v-model="it.emphasize" size="large" />
              <label class="f-label">标签（逗号分隔）</label>
              <el-input :model-value="(it.tags ?? []).join('，')" size="large" @update:model-value="it.tags = $event.split(/[,，]/).map(s => s.trim()).filter(Boolean)" />
              <label class="f-label">尾部文案</label>
              <el-input v-model="it.tail" size="large" />
              <label class="f-label">表情</label>
              <el-input v-model="it.emoji" size="large" placeholder="🍔☕🍿🍩" />
              <label class="f-label">配色</label>
              <el-select v-model="it.bg" size="large">
                <el-option label="玫红→鎏金" value="linear-gradient(100deg, #e8336d 0%, #ff5d43 55%, #ffaa1d 100%)" />
                <el-option label="深玫→鎏金" value="linear-gradient(100deg, #a31245 0%, #e8336d 60%, #ffaa1d 100%)" />
                <el-option label="鎏金纯色" value="linear-gradient(100deg, #ffaa1d 0%, #ff8a1d 100%)" />
              </el-select>
            </div>
            <button class="add-item" @click="sel.props.items.push({ title: '新轮播', emphasize: '文案', tags: ['标签'], tail: '立即查看', emoji: '✨', img: '', action: { type: 'none' }, bg: 'linear-gradient(100deg, #e8336d 0%, #ff5d43 55%, #ffaa1d 100%)' })">+ 添加轮播</button>
          </template>
          <!-- nav -->
          <template v-else-if="sel.type === 'nav'">
            <label class="f-label">每行图标数</label>
            <el-input-number v-model="sel.props.columns" :min="3" :max="5" size="large" />
            <div v-for="(it, ni) in sel.props.items" :key="ni" class="nav-row" :class="{ editing: navEditIdx === ni }">
              <el-input v-model="it.icon" class="nav-icon" size="large" placeholder="图标" />
              <el-input v-model="it.label" size="large" placeholder="名称" />
              <button class="mini-del" title="编辑点击动作" @click="navEditIdx = navEditIdx === ni ? -1 : ni; ensureItemAction(it)">⚡</button>
              <button class="mini-del" @click="sel.props.items.splice(ni, 1); if (navEditIdx === ni) navEditIdx = -1">✕</button>
            </div>
            <button class="add-item" @click="sel.props.items.push({ label: '新入口', icon: '✨', action: { type: 'none' } })">+ 添加入口</button>
          </template>
          <!-- coupon-strip：可从营销券库选券内联（coupon_id 落地 → C 端点击真领券） -->
          <template v-else-if="sel.type === 'coupon-strip'">
            <label class="f-label">券面额</label>
            <el-input v-model="sel.props.amount" size="large" />
            <label class="f-label">上备注</label>
            <el-input v-model="sel.props.note_top" size="large" />
            <label class="f-label">下备注</label>
            <el-input v-model="sel.props.note_bottom" size="large" />
            <label class="f-label">按钮文案</label>
            <el-input v-model="sel.props.action_text" size="large" />
            <button class="add-item" @click="openCouponPicker">从营销券库选券</button>
            <div class="field-note" v-if="Number(sel.props.coupon_id) > 0">
              已关联券 ID {{ sel.props.coupon_id }}：C 端点击 = 真实领取（POST /api/me/member/coupons/:id/receive），领取后进我的券包，下单时在确认订单页抵扣。
              <a href="javascript:void(0)" style="color:#E8336D;font-weight:700" @click="sel.props.coupon_id = 0; commit()">解除关联</a>
            </div>
            <div class="field-note" v-else>
              未关联具体券：点击后按下方「点击动作」执行（仅展示文案，不会真的发券）。
            </div>
          </template>
          <!-- brand-chips -->
          <template v-else-if="sel.type === 'brand-chips'">
            <label class="f-label">组件标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">角标</label>
            <el-input v-model="sel.props.badge" size="large" />
            <label class="f-label">品牌（选择或逗号编辑）</label>
            <el-input v-model="chipsText" type="textarea" :rows="3" size="large" />
            <button class="add-item" @click="openBrandPicker">从品牌库选择（159 品牌）</button>
          </template>
          <!-- goods-feed：数据源二选一（选品仅团购商品库，CPS 实时透传无选品） -->
          <template v-else-if="sel.type === 'goods-feed'">
            <label class="f-label">组件标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">更多文案</label>
            <el-input v-model="sel.props.more_text" size="large" />
            <label class="f-label">每页条数</label>
            <el-input-number v-model="sel.props.page_size" :min="4" :max="20" size="large" />
            <label class="f-label">数据源</label>
            <el-select v-model="feedMode" size="large">
              <el-option label="CPS 平台（实时透传）" value="platform_tab" />
              <el-option label="到店团购商品库（选品）" value="self" />
            </el-select>
            <template v-if="feedMode === 'platform_tab'">
              <label class="f-label">平台 Tab（CPS 无选品，实时拉取）</label>
              <el-checkbox-group v-model="feedTabs">
                <el-checkbox value="jd">京东</el-checkbox>
                <el-checkbox value="tb">淘宝</el-checkbox>
                <el-checkbox value="pdd">拼多多</el-checkbox>
                <el-checkbox value="vip">唯品会</el-checkbox>
              </el-checkbox-group>
            </template>
            <template v-else>
              <label class="f-label">布局样式</label>
              <el-radio-group v-model="sel.props.layout">
                <el-radio-button value="grid">两列</el-radio-button>
                <el-radio-button value="big">大图</el-radio-button>
              </el-radio-group>
              <label class="f-label">到店团购挂标</label>
              <el-switch v-model="sel.props.badge" active-text="展示到店团购标识" />
              <label class="f-label">已选商品（{{ (sel.data_source?.params?.goods_ids ?? []).length }}）</label>
              <div class="picked-list">
                <span v-for="g in pickedGoods" :key="g.id" class="picked-chip" :title="g.title">
                  {{ g.title.slice(0, 10) }}<i @click="removePicked(g.id)">✕</i>
                </span>
                <span v-if="!(sel.data_source?.params?.goods_ids ?? []).length" class="picked-empty">尚未选品</span>
              </div>
              <button class="add-item" @click="openSelfPicker">+ 从到店团购商品库选品</button>
            </template>
          </template>
          <!-- ingot-entry -->
          <template v-else-if="sel.type === 'ingot-entry'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">副标题</label>
            <el-input v-model="sel.props.subtitle" size="large" />
            <label class="f-label">按钮文案</label>
            <el-input v-model="sel.props.action_text" size="large" />
          </template>
          <!-- movie-box -->
          <template v-else-if="sel.type === 'movie-box'">
            <label class="f-label">展示模式</label>
            <el-radio-group v-model="sel.props.mode" size="large">
              <el-radio-button value="hot">热门电影</el-radio-button>
              <el-radio-button value="upcoming">即将上映</el-radio-button>
            </el-radio-group>
            <label class="f-label">标题覆盖（留空用插件默认）</label>
            <el-input v-model="sel.props.title" size="large" placeholder="如：超级热门的电影" />
            <label class="f-label">更多文案覆盖（留空用插件默认）</label>
            <el-input v-model="sel.props.more" size="large" placeholder="查看更多" />
            <label class="f-label">呼起品牌码</label>
            <el-input v-model="sel.props.brand_code" size="large" placeholder="life_01（折扣电影票）" />
            <div class="field-note">插件组件仅小程序端渲染，H5 端显示占位卡</div>
          </template>
          <!-- redeem-entry -->
          <template v-else-if="sel.type === 'redeem-entry'">
            <label class="f-label">直达权益（蚂蚁积分兑换，实时列表）</label>
            <el-select
              :model-value="sel.props.cid || undefined"
              filterable
              size="large"
              placeholder="搜索并选择权益（如：腾讯视频）"
              :loading="redeemPicker.loading"
              @visible-change="(v) => v && !redeemPicker.items.length && loadRedeemTypes()"
              @update:model-value="pickRedeem"
            >
              <el-option v-for="r in redeemPicker.items" :key="r.cid" :value="r.cid" :label="`${r.name}（${r.min_points}~${r.max_points}元宝）`" />
            </el-select>
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">副标题</label>
            <el-input v-model="sel.props.subtitle" size="large" />
            <label class="f-label">按钮文案</label>
            <el-input v-model="sel.props.btn_text" size="large" />
            <label class="f-label">图标 emoji</label>
            <el-input v-model="sel.props.emoji" size="large" />
            <label class="f-label">呼起品牌码</label>
            <el-input v-model="sel.props.brand_code" size="large" placeholder="life_05（生活权益/积分兑换）" />
            <div class="field-note">点击直达蚂蚁星球该权益的兑换弹窗（半屏），仅小程序端呼起</div>
          </template>
          <!-- notice -->
          <template v-else-if="sel.type === 'notice'">
            <label class="f-label">公告（每行一条，≤20字）</label>
            <el-input :model-value="(sel.props.texts ?? []).join('\n')" type="textarea" :rows="3" size="large" @update:model-value="sel.props.texts = $event.split('\n').map(s => s.trim()).filter(Boolean)" />
          </template>
          <!-- divider -->
          <template v-else-if="sel.type === 'divider'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">副标题</label>
            <el-input v-model="sel.props.subtitle" size="large" />
          </template>
          <!-- rich-text -->
          <template v-else-if="sel.type === 'rich-text'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">角标</label>
            <el-input v-model="sel.props.badge" size="large" />
            <label class="f-label">段落（每行一段）</label>
            <el-input :model-value="(sel.props.paras ?? []).join('\n')" type="textarea" :rows="4" size="large" @update:model-value="sel.props.paras = $event.split('\n').map(s => s.trim()).filter(Boolean)" />
            <label class="f-label">更多文案</label>
            <el-input v-model="sel.props.more_text" size="large" />
          </template>
          <!-- blank -->
          <template v-else-if="sel.type === 'blank'">
            <label class="f-label">间距高度（rpx）</label>
            <el-input-number v-model="sel.props.height" :min="8" :max="200" :step="8" size="large" />
          </template>
          <!-- floor 通用容器：内容 + 整卡跳转 -->
          <template v-else-if="sel.type === 'floor'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">副标题</label>
            <el-input v-model="sel.props.subtitle" size="large" />
            <label class="f-label">正文</label>
            <el-input v-model="sel.props.text" type="textarea" :rows="3" size="large" />
            <label class="f-label">背景</label>
            <el-select v-model="sel.props.bg" size="large">
              <el-option label="默认（奶油白）" value="" />
              <el-option label="玫红→鎏金渐变" value="linear-gradient(100deg, #e8336d 0%, #ff5d43 55%, #ffaa1d 100%)" />
              <el-option label="深玫纯色" value="#a31245" />
              <el-option label="鎏金纯色" value="#ffaa1d" />
            </el-select>
          </template>
          <!-- category-nav 分类导航：内容 + 逐项跳转 -->
          <template v-else-if="sel.type === 'category-nav'">
            <div v-for="(it, ci) in sel.props.items" :key="ci" class="nav-row" :class="{ editing: itemAct === it.action }">
              <el-input v-model="it.label" size="large" placeholder="分类名" />
              <el-switch v-model="it.hot" active-text="热" />
              <button class="mini-del" title="编辑点击动作" @click="toggleItemAct(it)">⚡</button>
              <button class="mini-del" @click="sel.props.items.splice(ci, 1)">✕</button>
            </div>
            <button class="add-item" @click="sel.props.items.push({ label: '新分类', hot: false, action: { type: 'none' } })">+ 添加分类</button>
          </template>
          <!-- seckill 限时秒杀：配置数据驱动 -->
          <template v-else-if="sel.type === 'seckill'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">更多文案（留空不显示）</label>
            <el-input v-model="sel.props.more_text" size="large" />
            <label class="f-label">截止时间（留空不显示倒计时）</label>
            <el-date-picker v-model="sel.props.deadline" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="选择秒杀截止时间" style="width: 100%" />
            <div v-for="(it, si) in sel.props.items" :key="si" class="item-card">
              <div class="item-head">
                <span>秒杀 {{ si + 1 }}</span>
                <button class="mini-del" title="编辑点击动作" @click="toggleItemAct(it)">⚡</button>
                <button class="mini-del" @click="sel.props.items.splice(si, 1)">删除</button>
              </div>
              <label class="f-label">商品图</label>
              <div class="img-up-row">
                <img v-if="it.pic" :src="it.pic" class="img-up-preview" />
                <el-upload v-else :show-file-list="false" accept="image/png,image/jpeg,image/webp" :http-request="(o) => uploadTo(it, 'pic', o)">
                  <button class="mini-up">⬆ 上传图片</button>
                </el-upload>
                <button v-if="it.pic" class="mini-del" @click="it.pic = ''">清除</button>
              </div>
              <label class="f-label">商品名</label>
              <el-input v-model="it.title" size="large" />
              <label class="f-label">秒杀价（元）</label>
              <el-input-number v-model="it.price" :min="0" :precision="2" size="large" />
              <label class="f-label">划线价（元，可选）</label>
              <el-input-number v-model="it.origin_price" :min="0" :precision="2" size="large" />
            </div>
            <button class="add-item" @click="sel.props.items.push({ title: '秒杀商品', pic: '', price: 9.9, origin_price: 19.9, action: { type: 'none' } })">+ 添加秒杀商品</button>
          </template>
          <!-- group-buy-floor 拼团楼层 -->
          <template v-else-if="sel.type === 'group-buy-floor'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">副标题</label>
            <el-input v-model="sel.props.subtitle" size="large" />
            <div v-for="(it, gi) in sel.props.items" :key="gi" class="item-card">
              <div class="item-head">
                <span>拼团 {{ gi + 1 }}</span>
                <button class="mini-del" title="编辑点击动作" @click="toggleItemAct(it)">⚡</button>
                <button class="mini-del" @click="sel.props.items.splice(gi, 1)">删除</button>
              </div>
              <label class="f-label">商品图</label>
              <div class="img-up-row">
                <img v-if="it.pic" :src="it.pic" class="img-up-preview" />
                <el-upload v-else :show-file-list="false" accept="image/png,image/jpeg,image/webp" :http-request="(o) => uploadTo(it, 'pic', o)">
                  <button class="mini-up">⬆ 上传图片</button>
                </el-upload>
                <button v-if="it.pic" class="mini-del" @click="it.pic = ''">清除</button>
              </div>
              <label class="f-label">商品名</label>
              <el-input v-model="it.title" size="large" />
              <label class="f-label">拼团价（元）</label>
              <el-input-number v-model="it.group_price" :min="0" :precision="2" size="large" />
              <label class="f-label">划线价（元，可选）</label>
              <el-input-number v-model="it.price" :min="0" :precision="2" size="large" />
              <label class="f-label">已拼文案</label>
              <el-input v-model="it.joined" size="large" placeholder="已拼 128 件 / 全新上线" />
            </div>
            <button class="add-item" @click="sel.props.items.push({ title: '拼团商品', pic: '', price: 39.9, group_price: 29.9, joined: '全新上线', action: { type: 'none' } })">+ 添加拼团商品</button>
          </template>
          <!-- coupon-wall 券墙中心 -->
          <template v-else-if="sel.type === 'coupon-wall'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">副标题</label>
            <el-input v-model="sel.props.subtitle" size="large" />
            <div v-for="(c, wi) in sel.props.coupons" :key="wi" class="item-card">
              <div class="item-head">
                <span>券 {{ wi + 1 }}</span>
                <button class="mini-del" title="编辑点击动作" @click="toggleItemAct(c)">⚡</button>
                <button class="mini-del" @click="sel.props.coupons.splice(wi, 1)">删除</button>
              </div>
              <label class="f-label">券名</label>
              <el-input v-model="c.name" size="large" />
              <label class="f-label">面额（元 / 折）</label>
              <el-input-number v-model="c.amount" :min="0" :precision="1" size="large" />
              <label class="f-label">使用条件</label>
              <el-input v-model="c.condition" size="large" placeholder="满99可用 / 无门槛" />
              <label class="f-label">按钮文案</label>
              <el-input v-model="c.btn_text" size="large" placeholder="立即领取" />
            </div>
            <button class="add-item" @click="sel.props.coupons.push({ name: '全平台通用券', amount: 10, condition: '满99可用', btn_text: '立即领取', action: { type: 'none' } })">+ 添加券</button>
          </template>
          <!-- invite-floor 邀请有礼 -->
          <template v-else-if="sel.type === 'invite-floor'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">说明文案</label>
            <el-input v-model="sel.props.desc" type="textarea" :rows="2" size="large" />
            <label class="f-label">奖励文案</label>
            <el-input v-model="sel.props.reward_text" size="large" />
            <label class="f-label">按钮文案</label>
            <el-input v-model="sel.props.btn_text" size="large" />
          </template>
          <!-- float-btn 悬浮按钮 -->
          <template v-else-if="sel.type === 'float-btn'">
            <label class="f-label">文案</label>
            <el-input v-model="sel.props.text" size="large" />
            <label class="f-label">图标 emoji（可选）</label>
            <el-input v-model="sel.props.icon" size="large" placeholder="🔥" />
            <label class="f-label">距底部（rpx）</label>
            <el-input-number v-model="sel.props.bottom" :min="80" :max="600" :step="20" size="large" />
          </template>
          <!-- member-card 会员权益卡 -->
          <template v-else-if="sel.type === 'member-card'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">副标题</label>
            <el-input v-model="sel.props.subtitle" size="large" />
            <label class="f-label">等级标签（可选）</label>
            <el-input v-model="sel.props.level_text" size="large" placeholder="L2 · 已解锁" />
            <label class="f-label">按钮文案</label>
            <el-input v-model="sel.props.btn_text" size="large" />
            <label class="f-label">背景</label>
            <el-select v-model="sel.props.bg" size="large">
              <el-option label="默认（深玫渐变）" value="" />
              <el-option label="鎏金纯色" value="#ffaa1d" />
              <el-option label="深玫纯色" value="#a31245" />
            </el-select>
          </template>
          <!-- brand-matrix 品牌宫格 -->
          <template v-else-if="sel.type === 'brand-matrix'">
            <label class="f-label">每行列数</label>
            <el-input-number v-model="sel.props.columns" :min="2" :max="5" size="large" />
            <div v-for="(it, mi) in sel.props.items" :key="mi" class="item-card">
              <div class="item-head">
                <span>品牌 {{ mi + 1 }}</span>
                <button class="mini-del" title="编辑点击动作" @click="toggleItemAct(it)">⚡</button>
                <button class="mini-del" @click="sel.props.items.splice(mi, 1)">删除</button>
              </div>
              <div class="nav-row">
                <el-input v-model="it.icon" class="nav-icon" size="large" placeholder="图标" />
                <el-input v-model="it.name" size="large" placeholder="品牌名" />
              </div>
              <label class="f-label">角标（可选）</label>
              <el-input v-model="it.tag" size="large" placeholder="9.9 / 补贴日" />
            </div>
            <button class="add-item" @click="sel.props.items.push({ name: '新品牌', icon: '🏷️', tag: '', action: { type: 'none' } })">+ 添加品牌</button>
          </template>
          <!-- activity-floor 活动楼层 -->
          <template v-else-if="sel.type === 'activity-floor'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">副标题</label>
            <el-input v-model="sel.props.subtitle" size="large" />
            <label class="f-label">背景图（设置后配色不展示）</label>
            <div class="img-up-row">
              <img v-if="sel.props.image" :src="sel.props.image" class="img-up-preview" />
              <el-upload v-else :show-file-list="false" accept="image/png,image/jpeg,image/webp" :http-request="(o) => uploadTo(sel.props, 'image', o)">
                <button class="mini-up">⬆ 上传图片</button>
              </el-upload>
              <button v-if="sel.props.image" class="mini-del" @click="sel.props.image = ''">清除</button>
            </div>
            <label class="f-label">背景配色（无图时展示）</label>
            <el-select v-model="sel.props.bg" size="large">
              <el-option label="玫红→鎏金渐变" value="linear-gradient(100deg, #e8336d 0%, #ff5d43 55%, #ffaa1d 100%)" />
              <el-option label="鎏金纯色" value="#ffaa1d" />
              <el-option label="深玫纯色" value="#a31245" />
            </el-select>
            <div v-for="(b, bi2) in sel.props.buttons" :key="bi2" class="item-card">
              <div class="item-head">
                <span>按钮 {{ bi2 + 1 }}</span>
                <button class="mini-del" title="编辑点击动作" @click="toggleItemAct(b)">⚡</button>
                <button class="mini-del" @click="sel.props.buttons.splice(bi2, 1)">删除</button>
              </div>
              <label class="f-label">按钮文案</label>
              <el-input v-model="b.text" size="large" />
              <label class="f-label">幽灵样式</label>
              <el-switch v-model="b.ghost" />
            </div>
            <button class="add-item" @click="sel.props.buttons.push({ text: '参与活动', ghost: false, action: { type: 'none' } })">+ 添加按钮</button>
          </template>
          <!-- image-hotzone 图片热区 -->
          <template v-else-if="sel.type === 'image-hotzone'">
            <label class="f-label">底图</label>
            <div class="img-up-row">
              <img v-if="sel.props.image" :src="sel.props.image" class="img-up-preview" />
              <el-upload v-else :show-file-list="false" accept="image/png,image/jpeg,image/webp" :http-request="(o) => uploadTo(sel.props, 'image', o)">
                <button class="mini-up">⬆ 上传图片</button>
              </el-upload>
              <button v-if="sel.props.image" class="mini-del" @click="sel.props.image = ''">清除</button>
            </div>
            <div v-for="(z, zi) in sel.props.zones" :key="zi" class="item-card">
              <div class="item-head">
                <span>热区 {{ zi + 1 }}（百分比定位）</span>
                <button class="mini-del" title="编辑点击动作" @click="toggleItemAct(z)">⚡</button>
                <button class="mini-del" @click="sel.props.zones.splice(zi, 1)">删除</button>
              </div>
              <div class="nav-row">
                <el-input-number v-model="z.x" :min="0" :max="100" size="large" placeholder="x%" controls-position="right" style="width: 80px" />
                <el-input-number v-model="z.y" :min="0" :max="100" size="large" placeholder="y%" controls-position="right" style="width: 80px" />
              </div>
              <div class="nav-row">
                <el-input-number v-model="z.w" :min="1" :max="100" size="large" placeholder="宽%" controls-position="right" style="width: 80px" />
                <el-input-number v-model="z.h" :min="1" :max="100" size="large" placeholder="高%" controls-position="right" style="width: 80px" />
              </div>
            </div>
            <button class="add-item" @click="sel.props.zones.push({ x: 0, y: 0, w: 40, h: 30, action: { type: 'none' } })">+ 添加热区</button>
          </template>
          <!-- video-floor 视频楼层 -->
          <template v-else-if="sel.type === 'video-floor'">
            <label class="f-label">标题（可选）</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">视频地址（mp4 URL）</label>
            <el-input v-model="sel.props.src" size="large" placeholder="https://…/video.mp4" />
            <label class="f-label">封面图</label>
            <div class="img-up-row">
              <img v-if="sel.props.poster" :src="sel.props.poster" class="img-up-preview" />
              <el-upload v-else :show-file-list="false" accept="image/png,image/jpeg,image/webp" :http-request="(o) => uploadTo(sel.props, 'poster', o)">
                <button class="mini-up">⬆ 上传封面</button>
              </el-upload>
              <button v-if="sel.props.poster" class="mini-del" @click="sel.props.poster = ''">清除</button>
            </div>
            <div class="field-note">视频文件请上传至静态托管后粘贴 URL（视频直链，端内 video 播放）</div>
          </template>
          <!-- countdown 倒计时 -->
          <template v-else-if="sel.type === 'countdown'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">备注（可选）</label>
            <el-input v-model="sel.props.note" size="large" />
            <label class="f-label">截止时间（留空不显示倒计时）</label>
            <el-date-picker v-model="sel.props.deadline" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="选择截止时间" style="width: 100%" />
            <label class="f-label">到期文案</label>
            <el-input v-model="sel.props.expired_text" size="large" />
          </template>
          <!-- popup-modal 进页弹窗 -->
          <template v-else-if="sel.type === 'popup-modal'">
            <label class="f-label">标题</label>
            <el-input v-model="sel.props.title" size="large" />
            <label class="f-label">内容文案</label>
            <el-input v-model="sel.props.content" type="textarea" :rows="3" size="large" />
            <label class="f-label">弹窗图（可选）</label>
            <div class="img-up-row">
              <img v-if="sel.props.image" :src="sel.props.image" class="img-up-preview" />
              <el-upload v-else :show-file-list="false" accept="image/png,image/jpeg,image/webp" :http-request="(o) => uploadTo(sel.props, 'image', o)">
                <button class="mini-up">⬆ 上传图片</button>
              </el-upload>
              <button v-if="sel.props.image" class="mini-del" @click="sel.props.image = ''">清除</button>
            </div>
            <label class="f-label">按钮文案</label>
            <el-input v-model="sel.props.btn_text" size="large" />
            <label class="f-label">进页自动弹</label>
            <el-switch v-model="sel.props.auto_show" />
            <div class="field-note">关闭后同一次会话内不再弹出</div>
          </template>
          <!-- 通用点击动作编辑（楼层级 action / nav item action） -->
          <template v-if="activeAction">
            <div class="act-block">
              <label class="f-label">⚡ 点击动作</label>
              <el-select v-model="activeAction.type" size="large">
                <el-option label="不可点" value="none" />
                <el-option label="站内跳转" value="jump" />
                <el-option label="品牌/插件" value="plugin-launch" />
                <el-option label="活动页" value="activity" />
                <el-option label="弹窗" value="popup" />
              </el-select>
              <template v-if="activeAction.type === 'jump'">
                <label class="f-label">目标类型</label>
                <el-select v-model="activeAction.target" size="large">
                  <el-option label="站内页面" value="page" />
                  <el-option label="H5 链接" value="h5" />
                  <el-option label="其他小程序" value="weapp" />
                </el-select>
                <label class="f-label">目标值（{{ activeAction.target === 'page' ? '选择站内页面' : activeAction.target === 'h5' ? 'H5 链接 https://…' : '目标小程序 appId' }}）</label>
                <el-select
                  v-if="activeAction.target === 'page'"
                  v-model="activeAction.value"
                  size="large"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择站内页面，或粘贴自定义路径"
                >
                  <el-option-group v-for="g in PAGE_REGISTRY" :key="g.group" :label="g.group">
                    <el-option v-for="pg in g.pages" :key="pg.path" :label="`${pg.label}（/${pg.path}）`" :value="'/' + pg.path" />
                  </el-option-group>
                </el-select>
                <el-input v-else v-model="activeAction.value" size="large" :placeholder="activeAction.target === 'h5' ? 'https://…' : 'wx 开头的 appId'" />
                <div v-if="activeAction.target === 'page' && isTabPath(activeAction.value)" class="field-note">Tab 壳页：端上用 switchTab 打开（不能携带参数）</div>
              </template>
              <template v-else-if="activeAction.type === 'plugin-launch'">
                <label class="f-label">呼起品牌（{{ brandOpts.length ? `品牌库 ${brandOpts.length} 个` : '打开时加载…' }}）</label>
                <el-select
                  v-model="activeAction.value"
                  size="large"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择品牌，或输入真实品牌码"
                  @focus="loadBrandOpts"
                  @change="probeBrand"
                >
                  <el-option-group v-for="g in brandGroups" :key="g.key" :label="g.name">
                    <el-option v-for="b in g.items" :key="b.brand_code" :label="`${b.name}（${b.brand_code}）`" :value="b.brand_code" :disabled="!b.enabled" />
                  </el-option-group>
                </el-select>
                <div v-if="brandProbe" :class="brandProbe.ok ? 'field-note' : 'probe-bad'">{{ brandProbe.msg }}</div>
              </template>
              <template v-else-if="activeAction.type === 'popup'">
                <label class="f-label">弹层类型</label>
                <el-select v-model="popupKind" size="large">
                  <el-option label="文案弹层（点击弹出提示文案）" value="text" />
                  <el-option label="聚宝盆签到（宿主签到弹层）" value="checkin" />
                </el-select>
                <template v-if="popupKind === 'text'">
                  <label class="f-label">弹层文案</label>
                  <el-input v-model="activeAction.value" size="large" placeholder="如：新人专享礼包已到账" />
                </template>
              </template>
              <template v-else-if="activeAction.type === 'activity'">
                <label class="f-label">装修页（{{ activityPages.length ? `已建 ${activityPages.length} 页` : '尚无活动页' }}）</label>
                <div class="act-row">
                  <el-select
                    v-model="activeAction.value"
                    size="large"
                    filterable
                    placeholder="选择要跳转的活动装修页"
                    @focus="loadActivityPages"
                  >
                    <el-option v-for="p in activityPages" :key="p.page" :label="`${p.title || p.page}（${p.page}）`" :value="p.page" />
                  </el-select>
                  <button class="op-btn act-new" :disabled="creatingPage" @click="createActivityPage">{{ creatingPage ? '创建中…' : '＋ 新建' }}</button>
                </div>
                <div class="field-note">活动页 = DIY 装修的 page-xxx 页面；新建后自动切到该页装修，发布后 C 端点击即达</div>
              </template>
            </div>
          </template>
        </template>
        <el-empty v-else description="点击画布中的楼层进行编辑" :image-size="70" />
      </section>
    </div>

    <!-- 团购选品抽屉（唯一有选品的模式；self_goods 空表 → 诚实空态） -->
    <el-drawer v-model="selfPicker.open" title="到店团购商品选品" size="460">
      <el-input v-model="selfPicker.kw" placeholder="搜索商品标题" clearable @input="loadSelfGoods" />
      <div class="picker-list">
        <label v-for="g in selfPicker.items" :key="g.goods_id" class="picker-row">
          <img v-if="g.img" :src="g.img" class="picker-img" />
          <span v-else class="picker-img picker-ph">🛍️</span>
          <span class="picker-t">
            <b>{{ g.title }}</b>
            <i>¥{{ g.price ?? '--' }} · 库存 {{ g.stock }} · 团购核销</i>
          </span>
          <el-checkbox :model-value="selfPicker.picked.includes(g.goods_id)" @change="togglePick(g.goods_id)" />
        </label>
        <div v-if="!selfPicker.items.length" class="muted pad">暂无上架的到店团购商品——请先在「商品与品牌」录入并上架</div>
      </div>
      <template #footer>
        <el-button @click="selfPicker.open = false">取消</el-button>
        <el-button type="primary" @click="applySelfPick">确定（已选 {{ selfPicker.picked.length }}）</el-button>
      </template>
    </el-drawer>

    <!-- 营销券选择抽屉（选券 → 券快照内联 props） -->
    <el-drawer v-model="couponPicker.open" title="从营销券库选券" size="420">
      <div class="picker-list">
        <label v-for="c in couponPicker.items" :key="c.id" class="picker-row" :class="{ off: c.phase !== '进行中' }">
          <span class="picker-t">
            <b>{{ c.name }}</b>
            <i>{{ c.type === 'cash_off' ? `减 ¥${c.amount}` : c.type === 'discount' ? `${c.amount} 折` : '兑换券' }} · {{ c.threshold > 0 ? `满 ¥${c.threshold} 可用` : '无门槛' }} · {{ c.phase }} · 已领 {{ c.issued }}/{{ c.total }}</i>
          </span>
          <el-button size="small" :disabled="c.phase !== '进行中'" @click="applyCoupon(c)">选用</el-button>
        </label>
        <div v-if="!couponPicker.items.length" class="muted pad">营销中心暂无券——请先到「营销中心」创建</div>
        <div class="muted pad" style="font-size: 12px">只有「进行中」的券可选用；选用后 C 端点击券条即为真实领取，领取后可在确认订单页抵扣</div>
      </div>
    </el-drawer>

    <!-- 品牌选择抽屉（159 品牌真数据 → chips 内联） -->
    <el-drawer v-model="brandPicker.open" title="从品牌库选择" size="420">
      <div class="picker-list">
        <label v-for="b in brandPicker.items" :key="b.brand_code" class="picker-row">
          <span class="picker-t"><b>{{ b.name }}</b><i>{{ b.category_name ?? b.category }}{{ b.enabled ? '' : ' · 已停用' }}</i></span>
          <el-checkbox :model-value="brandPickedCodes.includes(b.brand_code)" @change="toggleBrand(b)" />
        </label>
      </div>
      <template #footer>
        <el-button @click="brandPicker.open = false">取消</el-button>
        <el-button type="primary" @click="applyBrandPick">确定</el-button>
      </template>
    </el-drawer>

    <!-- 预览弹窗 -->
    <el-dialog v-model="previewOpen" title="Schema 预览（page-v1）" width="640">
      <pre class="schema-pre">{{ schemaJson }}</pre>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { RefreshLeft, RefreshRight, View } from '@element-plus/icons-vue';
import FloorPreview from '../../components/FloorPreview.js';
import { uploadImage } from '../../upload.js';

/** 加载基线：published=发布版（默认，所见=线上）/ draft=草稿（AI 生成后自动带入） */
const props = defineProps({ initialBase: { type: String, default: 'published' } });
const base = ref(props.initialBase === 'draft' ? 'draft' : 'published');
const draftVersion = ref(0);
const draftUpdatedAt = ref(null);
const shortDay = (t) => {
  if (!t) return '';
  const d = new Date(t);
  return `${d.getMonth() + 1}-${d.getDate()}`;
};
/** 切换编辑基线（发布版 ↔ 草稿）；有未保存改动需确认 */
async function switchBase(to) {
  if (to === base.value) return;
  if (dirty.value) {
    try { await ElMessageBox.confirm('当前有未保存的改动，切换基线后将丢失，确定切换？', '提示', { type: 'warning' }); }
    catch { return; }
  }
  base.value = to;
  load();
}

/* —— 组件库（on=true = 渲染器已实现 27 组件）—— */
const paletteGroups = [
  { name: '基础组件', items: [
    { label: '搜索栏', type: 'search-bar', on: true },
    { label: '轮播图', type: 'swiper', on: true },
    { label: '金刚区', type: 'nav', on: true },
    { label: '公告栏', type: 'notice', on: true },
    { label: '标题分隔', type: 'divider', on: true },
    { label: '间距', type: 'blank', on: true },
    { label: '通用容器', type: 'floor', on: true },
    { label: '分类导航', type: 'category-nav', on: true },
    { label: '图文说明', type: 'rich-text', on: true },
  ] },
  { name: '营销组件', items: [
    { label: '优惠券条', type: 'coupon-strip', on: true },
    { label: '限时秒杀', type: 'seckill', on: true },
    { label: '活动楼层', type: 'activity-floor', on: true },
    { label: '品牌宫格', type: 'brand-matrix', on: true },
    { label: '图片热区', type: 'image-hotzone', on: true },
    { label: '倒计时', type: 'countdown', on: true },
    { label: '进页弹窗', type: 'popup-modal', on: true },
    { label: '悬浮按钮', type: 'float-btn', on: true },
    { label: '视频楼层', type: 'video-floor', on: true },
    { label: '拼团楼层', type: 'group-buy-floor', on: true },
    { label: '券墙中心', type: 'coupon-wall', on: true },
  ] },
  { name: '业务组件', items: [
    { label: '品牌补贴', type: 'brand-chips', on: true },
    { label: '商品流', type: 'goods-feed', on: true },
    { label: '元宝入口', type: 'ingot-entry', on: true },
    { label: '影票热映', type: 'movie-box', on: true },
    { label: '权益直达', type: 'redeem-entry', on: true },
    { label: '会员权益卡', type: 'member-card', on: true },
    { label: '邀请有礼', type: 'invite-floor', on: true },
  ] },
];
const LABELS = { 'search-bar': '搜索栏', swiper: '轮播图', nav: '金刚区', 'coupon-strip': '优惠券条', 'brand-chips': '品牌补贴', 'goods-feed': '商品流', notice: '公告栏', divider: '标题分隔', 'rich-text': '图文说明', blank: '间距', 'ingot-entry': '元宝入口', 'movie-box': '影票热映', 'redeem-entry': '权益直达', floor: '通用容器', 'float-btn': '悬浮按钮', 'category-nav': '分类导航', 'member-card': '会员权益卡', 'brand-matrix': '品牌宫格', 'activity-floor': '活动楼层', 'image-hotzone': '图片热区', 'video-floor': '视频楼层', countdown: '倒计时', 'popup-modal': '进页弹窗', seckill: '限时秒杀', 'group-buy-floor': '拼团楼层', 'coupon-wall': '券墙中心', 'invite-floor': '邀请有礼' };
const floorLabel = (t) => LABELS[t] ?? t;

/* —— 默认模板（与 renderer default-home 同源精简）—— */
const DEFAULT_FLOORS = () => ([
  { type: 'search-bar', floor_id: 'f-search', component_id: 'c-search', props: { logo_text: '券', placeholder: '搜索券 · 京东 / 淘宝 / 拼多多', action_text: '签到有礼', action: { type: 'jump', target: 'page', value: '/pages/rights/index' } } },
  { type: 'swiper', floor_id: 'f-banner', component_id: 'c-banner', props: { autoplay: true, interval: 4000, items: [
    { title: '大牌点燃', emphasize: '5折起', tags: ['差旅必备', '爆款特惠'], tail: '天天开抢', emoji: '🍔☕🍿🍩', bg: 'linear-gradient(100deg, #e8336d 0%, #ff5d43 55%, #ffaa1d 100%)' },
    { title: '吃喝玩乐购', emphasize: '一站全变现', tags: ['自购省钱', '分享赚钱'], tail: '元宝当钱花', emoji: '🧡💰🎁', bg: 'linear-gradient(100deg, #a31245 0%, #e8336d 60%, #ffaa1d 100%)' },
  ] } },
  { type: 'nav', floor_id: 'f-nav', component_id: 'c-nav', props: { columns: 5, items: [
    { label: '大牌点餐', icon: '🍔', action: { type: 'plugin-launch', value: 'dining_01' } }, // 麦当劳
    { label: '咖啡茶饮', icon: '☕', action: { type: 'plugin-launch', value: 'dining_05' } }, // 瑞幸
    { label: '折扣电影', icon: '🎬', action: { type: 'plugin-launch', value: 'life_01' } }, // 折扣电影票
    { label: '外卖红包', icon: '🧧', action: { type: 'plugin-launch', value: 'meituan_01' } },
    { label: '打车出行', icon: '🚕', action: { type: 'plugin-launch', value: 'taxi_01' } }, // 网约车新客
    { label: '旅游住宿', icon: '🏨', action: { type: 'plugin-launch', value: 'hotel_02' } }, // 美团酒店
    { label: '会员充值', icon: '⚡', action: { type: 'plugin-launch', value: 'jd_10' } }, // 充值活动
    { label: '鲜花配送', icon: '💐', action: { type: 'plugin-launch', value: 'life_03' } },
    { label: '领券中心', icon: '券', hot: true, action: { type: 'jump', target: 'page', value: '/pages/rights/index' } },
  ] } },
  { type: 'coupon-strip', floor_id: 'f-coupon', component_id: 'c-coupon', props: { amount: '¥20', note_top: '满可用', note_bottom: '全平台通用', action_text: '立即领取', action: { type: 'jump', target: 'page', value: '/pages/rights/coupons' } } },
  { type: 'brand-chips', floor_id: 'f-brands', component_id: 'c-brands', props: { title: '品牌补贴日', badge: '低至5折', chips: ['麦当劳', '肯德基', '星巴克', '瑞幸', '必胜客', '塔斯汀', '奈雪的茶', '库迪咖啡'] } },
  { type: 'goods-feed', floor_id: 'f-feed', component_id: 'c-feed', data_source: { mode: 'platform_tab', params: { tabs: ['jd', 'tb', 'pdd', 'vip'] } }, props: { title: '精选好物', more_text: '更多 >', page_size: 10 } },
]);

let seq = Date.now() % 100000;
const newIds = (type) => ({ floor_id: `f-${type}-${seq}`, component_id: `c-${type}-${seq++}` });

/* —— 状态 —— */
const page = ref('home');
// 页面下拉动态化（B 方案多页面）：AI 新建页面自动出现在列表；内置页兜底
const pageOptions = ref([
  { page: 'home', label: '页面 · 小程序首页' },
  { page: 'home_h5', label: '页面 · H5 首页' },
]);
async function loadPageOptions() {
  try {
    const d = await api('/admin/schema/pages');
    const opts = d.map((p) => ({ page: p.page, label: `页面 · ${p.title || p.page}` }));
    if (opts.length) pageOptions.value = opts;
    if (!pageOptions.value.some((o) => o.page === page.value)) page.value = pageOptions.value[0].page;
  } catch { /* 列表失败用兜底两项 */ }
}
const floors = ref([]);
const selIdx = ref(-1);
const sel = computed(() => floors.value[selIdx.value] ?? null);
const version = ref(0);
const status = ref('none');
const dirty = ref(false);
const saving = ref(false);
const previewOpen = ref(false);
const pageLabel = computed(() => pageOptions.value.find((o) => o.page === page.value)?.label?.replace('页面 · ', '') ?? page.value);
const statusText = computed(() => ({ none: '未装修（默认模板）', draft: '草稿', published: '已发布' }[status.value] ?? status.value));

/* 撤销 / 重做 */
const snapshots = ref(['[]']);
const ptr = ref(0);
function commit() {
  dirty.value = true;
  snapshots.value = snapshots.value.slice(0, ptr.value + 1);
  snapshots.value.push(JSON.stringify(floors.value));
  if (snapshots.value.length > 50) snapshots.value.shift();
  ptr.value = snapshots.value.length - 1;
}
function restore() { floors.value = JSON.parse(snapshots.value[ptr.value]); }
function undo() { if (ptr.value > 0) { ptr.value--; restore(); } }
function redo() { if (ptr.value < snapshots.value.length - 1) { ptr.value++; restore(); } }

/* —— API —— */
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error(body.message ?? '请求失败');
  return body.data;
}

async function load() {
  try {
    const d = await api(`/admin/schema/current?page=${page.value}&base=${base.value}`);
    version.value = d.version;
    status.value = d.status;
    floors.value = d.floors ? JSON.parse(JSON.stringify(d.floors)) : DEFAULT_FLOORS();
    selIdx.value = -1;
    dirty.value = !d.floors;
    snapshots.value = [JSON.stringify(floors.value)];
    ptr.value = 0;
    draftVersion.value = Number(d.draft_version ?? 0);
    draftUpdatedAt.value = d.draft_updated_at ?? null;
  } catch (e) { ElMessage.error(e.message); }
}
load();
loadPageOptions();

async function onSwitchPage() {
  if (dirty.value) {
    try {
      await ElMessageBox.confirm('当前页有未保存的改动，切换后将丢失，确定切换？', '提示', { type: 'warning' });
    } catch { page.value = page.value === 'home' ? 'home_h5' : 'home'; return; }
  }
  load();
}

/** 删除装修页（决策#34②）：仅 page-*；删除后引用它的楼层点击将显示「页面建设中」 */
async function deletePage() {
  const target = page.value;
  try {
    await ElMessageBox.confirm(
      `确定删除装修页「${pageLabel.value}」（${target}）？将删除其全部版本；若有楼层动作指向它，C 端点击将显示「页面建设中」。`,
      '删除装修页', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
  } catch { return; }
  try {
    const d = await api(`/admin/schema/page?page=${encodeURIComponent(target)}`, { method: 'DELETE' });
    const refs = d.referenced_by ?? [];
    ElMessage.success(refs.length
      ? `已删除 ${target}（${d.versions_deleted} 个版本）。注意：仍被这些页面引用：${refs.join('、')}`
      : `已删除 ${target}（${d.versions_deleted} 个版本），无其他页面引用`);
    page.value = 'home';
    await loadPageOptions();
    await load();
  } catch (e) { ElMessage.error(e.message); }
}

async function saveDraft() {
  saving.value = true;
  try {
    const d = await api('/admin/schema/draft', { method: 'PUT', body: { page: page.value, floors: floors.value } });
    version.value = d.version;
    status.value = 'draft';
    dirty.value = false;
    ElMessage.success(`草稿已保存（v${d.version}）`);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}

async function publish() {
  saving.value = true;
  try {
    if (dirty.value || status.value !== 'draft') await saveDraft();
    const d = await api('/admin/schema/publish', { method: 'POST', body: { page: page.value } });
    version.value = d.version;
    status.value = 'published';
    dirty.value = false;
    ElMessage.success(`已发布 v${d.version}，小程序 / H5 端重新进入即生效`);
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}

/* —— 楼层操作 —— */
function addFloor(type, label) {
  const base = { type, ...newIds(type) };
  if (type === 'search-bar') Object.assign(base, { props: { logo_text: '券', placeholder: '搜索券 · 想要的全都有', action_text: '签到有礼', action: { type: 'jump', target: 'page', value: '/pages/rights/index' } } });
  else if (type === 'swiper') Object.assign(base, { props: { autoplay: true, interval: 4000, items: [{ title: '新轮播', emphasize: '文案', tags: ['标签'], tail: '立即查看', emoji: '✨', bg: 'linear-gradient(100deg, #e8336d 0%, #ff5d43 55%, #ffaa1d 100%)' }] } });
  else if (type === 'nav') Object.assign(base, { props: { columns: 5, items: [{ label: '新入口', icon: '✨', action: { type: 'none' } }] } });
  else if (type === 'coupon-strip') Object.assign(base, { props: { amount: '¥10', note_top: '满可用', note_bottom: '全平台通用', action_text: '立即领取', action: { type: 'jump', target: 'page', value: '/pages/rights/coupons' } } });
  else if (type === 'brand-chips') Object.assign(base, { props: { title: '品牌补贴日', badge: '低至5折', chips: ['麦当劳', '肯德基', '星巴克'] } });
  else if (type === 'goods-feed') Object.assign(base, { data_source: { mode: 'platform_tab', params: { tabs: ['jd', 'tb', 'pdd', 'vip'] } }, props: { title: label, more_text: '更多 >', page_size: 10 } });
  else if (type === 'notice') Object.assign(base, { props: { texts: ['新用户注册送 500 元宝', '双 11 大牌补贴进行中'] } });
  else if (type === 'divider') Object.assign(base, { props: { title: '区块标题', subtitle: '' } });
  else if (type === 'rich-text') Object.assign(base, { props: { title: '活动说明', badge: '必读', paras: ['这里是活动规则说明的第一段。', '这里是第二段。'], more_text: '了解详情 >', action: { type: 'none' } } });
  else if (type === 'blank') Object.assign(base, { props: { height: 48 } });
  else if (type === 'ingot-entry') Object.assign(base, { props: { title: '我的元宝', subtitle: '下单返元宝 · 元宝当钱花', action_text: '去查看', action: { type: 'jump', target: 'page', value: '/pages/ingot/index' } } });
  else if (type === 'movie-box') Object.assign(base, { props: { mode: 'hot', title: '', more: '', brand_code: 'life_01' } });
  else if (type === 'seckill') Object.assign(base, { props: { title: '限时秒杀', deadline: '', items: [{ title: '秒杀商品', pic: '', price: 9.9, origin_price: 19.9, action: { type: 'none' } }] } });
  else if (type === 'group-buy-floor') Object.assign(base, { props: { title: '超值拼团', items: [{ title: '拼团商品', pic: '', price: 39.9, group_price: 29.9, joined: '已拼 128 件', action: { type: 'none' } }] } });
  else if (type === 'coupon-wall') Object.assign(base, { props: { title: '券墙中心', coupons: [{ name: '全平台通用券', amount: 10, condition: '满99可用', action: { type: 'none' } }] } });
  else if (type === 'invite-floor') Object.assign(base, { props: { title: '邀请有礼', desc: '好友下单，双方都得元宝', reward_text: '每邀 1 人最高得 500 元宝', btn_text: '立即邀请', action: { type: 'none' } } });
  else if (type === 'redeem-entry') Object.assign(base, { props: { title: '视频会员 1 抢', subtitle: '低至 5 折 · 元宝当钱花', emoji: '🎬', btn_text: '立即抢', cid: 0, brand_code: 'life_05' } });
  else if (type === 'floor') Object.assign(base, { props: { title: '区块标题', subtitle: '', text: '这里放说明文字。', bg: '', action: { type: 'none' } } });
  else if (type === 'float-btn') Object.assign(base, { props: { text: '去抢购', icon: '🔥', bottom: 180, action: { type: 'none' } } });
  else if (type === 'category-nav') Object.assign(base, { props: { items: [{ label: '全部', hot: true, action: { type: 'none' } }, { label: '点餐', action: { type: 'plugin-launch', value: 'dining_13' } }, { label: '影票', action: { type: 'plugin-launch', value: 'life_01' } }] } });
  else if (type === 'member-card') Object.assign(base, { props: { title: '会员权益中心', subtitle: '元宝当钱花 · 权益随心兑', level_text: '', btn_text: '立即查看', bg: '', action: { type: 'jump', target: 'page', value: '/pages/rights/index' } } });
  else if (type === 'brand-matrix') Object.assign(base, { props: { columns: 4, items: [{ name: '麦当劳', icon: '🍔', tag: '', action: { type: 'plugin-launch', value: 'dining_01' } }, { name: '星巴克', icon: '☕', tag: '', action: { type: 'plugin-launch', value: 'dining_02' } }, { name: '瑞幸', icon: '🥤', tag: '9.9', action: { type: 'plugin-launch', value: 'dining_05' } }, { name: '影票', icon: '🎬', tag: '', action: { type: 'plugin-launch', value: 'life_01' } }] } });
  else if (type === 'activity-floor') Object.assign(base, { props: { title: '限时大促', subtitle: '大牌补贴进行中', image: '', bg: 'linear-gradient(100deg, #e8336d 0%, #ff5d43 55%, #ffaa1d 100%)', buttons: [{ text: '立即抢', ghost: false, action: { type: 'none' } }] } });
  else if (type === 'image-hotzone') Object.assign(base, { props: { image: '', zones: [{ x: 0, y: 0, w: 100, h: 100, action: { type: 'none' } }] } });
  else if (type === 'video-floor') Object.assign(base, { props: { title: '视频介绍', src: '', poster: '' } });
  else if (type === 'countdown') Object.assign(base, { props: { title: '限时开抢', note: '', deadline: '', expired_text: '活动已开始' } });
  else if (type === 'popup-modal') Object.assign(base, { props: { title: '开屏公告', content: '这里写弹窗说明文案', image: '', btn_text: '知道了', auto_show: true, action: { type: 'none' } } });
  floors.value.push(base);
  selIdx.value = floors.value.length - 1;
  commit();
}
function moveFloor(i, d) {
  const arr = floors.value;
  [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
  selIdx.value = i + d;
  commit();
}
function delFloor(i) {
  floors.value.splice(i, 1);
  if (selIdx.value >= floors.value.length) selIdx.value = floors.value.length - 1;
  commit();
}

/* —— 属性面板联动 —— */
const chipsText = computed({
  // chips 支持字符串或 {label,value} 对象（品牌选择器产出对象，手编逗号串产出字符串）
  get: () => (sel.value?.type === 'brand-chips' ? (sel.value.props.chips ?? []).map((c) => (typeof c === 'object' ? c.label : c)).join('，') : ''),
  set: (v) => { if (sel.value?.type === 'brand-chips') sel.value.props.chips = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean); },
});
const feedTabs = computed({
  get: () => sel.value?.data_source?.params?.tabs ?? [],
  set: (v) => { if (sel.value?.data_source?.params) sel.value.data_source.params.tabs = v; },
});

/* —— 商品流数据源（选品仅团购商品库；CPS 实时透传无选品） —— */
const feedMode = computed({
  get: () => sel.value?.type === 'goods-feed' ? (sel.value.data_source?.mode ?? 'platform_tab') : 'platform_tab',
  set: (m) => {
    if (sel.value?.type !== 'goods-feed') return;
    if (!sel.value.data_source || typeof sel.value.data_source !== 'object') sel.value.data_source = { mode: m, params: {} };
    sel.value.data_source.mode = m;
    if (m === 'self') {
      sel.value.data_source.params = { goods_ids: sel.value.data_source.params?.goods_ids ?? [] };
      if (!sel.value.props.layout) sel.value.props.layout = 'grid';
      if (sel.value.props.badge === undefined) sel.value.props.badge = true;
    } else {
      sel.value.data_source.params = { tabs: sel.value.data_source.params?.tabs ?? ['jd', 'pdd'] };
    }
  },
});
const pickedGoods = ref([]); // goods_id → {goods_id,title} 映射（展示用）
const selfPicker = ref({ open: false, kw: '', items: [], picked: [] });

async function loadSelfGoods() {
  try {
    const d = await api(`/admin/self-goods?tab=on&size=100${selfPicker.value.kw ? `&keyword=${encodeURIComponent(selfPicker.value.kw)}` : ''}`);
    selfPicker.value.items = d.items ?? [];
  } catch (e) { ElMessage.error(e.message); }
}
function openSelfPicker() {
  const ids = sel.value?.data_source?.params?.goods_ids ?? [];
  selfPicker.value.picked = [...ids];
  selfPicker.value.open = true;
  loadSelfGoods();
  // 已选但不在当前页的商品名回显
  pickedGoods.value = (sel.value?.data_source?.params?.__picked ?? []);
}
function togglePick(id) {
  const arr = selfPicker.value.picked;
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1); else arr.push(id);
}
function removePicked(id) {
  const ds = sel.value?.data_source;
  if (!ds?.params) return;
  ds.params.goods_ids = (ds.params.goods_ids ?? []).filter((x) => x !== id);
  ds.params.__picked = (ds.params.__picked ?? []).filter((g) => g.id !== id);
  pickedGoods.value = ds.params.__picked;
}
function applySelfPick() {
  if (sel.value?.type !== 'goods-feed') return;
  if (!sel.value.data_source?.params) sel.value.data_source = { mode: 'self', params: {} };
  const prev = new Map((sel.value.data_source.params.__picked ?? []).map((g) => [g.id, g]));
  sel.value.data_source.params.goods_ids = [...selfPicker.value.picked];
  // 名字映射：本次抽屉里能看到的直接取，历史保留
  sel.value.data_source.params.__picked = selfPicker.value.picked.map((id) => {
    const hit = selfPicker.value.items.find((g) => g.goods_id === id);
    return hit ? { id, title: hit.title } : (prev.get(id) ?? { id, title: `商品 #${id}` });
  });
  pickedGoods.value = sel.value.data_source.params.__picked;
  selfPicker.value.open = false;
  commit();
}

/* —— 权益直达（蚂蚁 fasttype 实时列表选 cid） —— */
const redeemPicker = ref({ items: [], loading: false });
async function loadRedeemTypes() {
  redeemPicker.value.loading = true;
  try {
    const d = await api('/admin/redeem/types');
    redeemPicker.value.items = d.items ?? [];
    if (!redeemPicker.value.items.length) ElMessage.warning('蚂蚁权益列表为空');
  } catch (e) { ElMessage.error(e.message); }
  redeemPicker.value.loading = false;
}
function pickRedeem(cid) {
  if (sel.value?.type !== 'redeem-entry') return;
  sel.value.props.cid = cid;
  const hit = redeemPicker.value.items.find((r) => r.cid === cid);
  if (hit) sel.value.props.title = hit.name.split(' ')[0] === hit.name ? hit.name : `${hit.name.split(' ')[0]} 1 抢`;
  commit();
}

/* —— 营销券选择（券快照内联） —— */
const couponPicker = ref({ open: false, items: [] });
async function openCouponPicker() {
  couponPicker.value.open = true;
  try {
    const d = await api('/admin/marketing/coupons');
    couponPicker.value.items = d.coupons ?? [];
  } catch (e) { ElMessage.error(e.message); }
}
function applyCoupon(c) {
  if (sel.value?.type !== 'coupon-strip') return;
  sel.value.props.amount = c.type === 'cash_off' ? `¥${c.amount}` : c.type === 'discount' ? `${c.amount} 折` : '免费兑';
  sel.value.props.note_top = c.threshold > 0 ? `满 ¥${c.threshold} 可用` : '无门槛';
  sel.value.props.note_bottom = c.name;
  sel.value.props.coupon_id = Number(c.id); // 档 C：真领券凭证（端上点击走 receive）
  // 有券可领时点击=领券，action 不再跳转券包
  sel.value.props.action = { type: 'none' };
  couponPicker.value.open = false;
  commit();
  ElMessage.success(`已关联券「${c.name}」（券ID ${c.id}）— C 端点击即真实领取`);
}

/* —— 品牌选择（159 品牌真数据 → chips 对象内联 {label,value}） —— */
const brandPicker = ref({ open: false, items: [] });
const brandPickedCodes = computed(() => (sel.value?.props?.chips ?? []).map((c) => (typeof c === 'object' ? c.value : null)).filter(Boolean));
async function openBrandPicker() {
  brandPicker.value.open = true;
  if (!brandPicker.value.items.length) {
    try {
      const d = await api('/admin/brands');
      brandPicker.value.items = d.items ?? [];
    } catch (e) { ElMessage.error(e.message); }
  }
}
function toggleBrand(b) {
  if (sel.value?.type !== 'brand-chips') return;
  const chips = sel.value.props.chips ?? [];
  const i = chips.findIndex((c) => typeof c === 'object' && c.value === b.brand_code);
  if (i >= 0) chips.splice(i, 1);
  else chips.push({ label: b.name, value: b.brand_code });
  sel.value.props.chips = chips;
}
function applyBrandPick() {
  brandPicker.value.open = false;
  commit();
}

/* —— 点击动作（Action）编辑 —— */
/** 页面注册表（A）：32 页全量分组，tab=true 的壳页端上走 switchTab（与 mini/core/action.js TAB_PAGES 同步维护） */
const PAGE_REGISTRY = [
  { group: 'Tab 壳页（switchTab）', pages: [
    { path: 'pages/index/index', label: '首页', tab: true },
    { path: 'pages/shell/s2', label: '壳页·生活服务位', tab: true },
    { path: 'pages/shell/s3', label: '壳页·会员权益位', tab: true },
    { path: 'pages/shell/s4', label: '壳页·第4位', tab: true },
    { path: 'pages/shell/s5', label: '壳页·我的位', tab: true },
  ] },
  { group: '会员权益', pages: [
    { path: 'pages/rights/index', label: '会员权益首页' },
    { path: 'pages/rights/category', label: '生活服务分类' },
    { path: 'pages/rights/grade', label: '权益档位' },
    { path: 'pages/rights/coupons', label: '我的券包' },
    { path: 'pages/rights/records', label: '兑换记录' },
    { path: 'pages/rights/levels', label: '会员等级' },
    { path: 'pages/rights/ingot', label: '我的元宝' },
  ] },
  { group: '订单与核销', pages: [
    { path: 'pages/orders/index', label: '订单列表' },
    { path: 'pages/orders/detail', label: '订单详情' },
    { path: 'pages/verify/qrcode', label: '我的核销码' },
    { path: 'pages/verify/scan', label: '扫码核销' },
  ] },
  { group: '商品', pages: [
    { path: 'pages/goods/list', label: '商品列表' },
    { path: 'pages/goods/detail', label: '商品详情' },
    { path: 'pages/goods/self-detail', label: '自营商品详情' },
    { path: 'pages/goods/search-result', label: '全站搜索（07B）' },
    { path: 'pages/goods/search', label: 'CPS 专属搜索（07）' },
  ] },
  { group: '交易', pages: [
    { path: 'pages/trade/confirm', label: '订单确认' },
    { path: 'pages/trade/result', label: '支付结果' },
  ] },
  { group: '分销', pages: [
    { path: 'pages/commission/wallet', label: '佣金钱包' },
    { path: 'pages/commission/withdraw', label: '佣金提现' },
    { path: 'pages/commission/invite', label: '邀请有礼' },
  ] },
  { group: '我的', pages: [
    { path: 'pages/mine/index', label: '我的' },
    { path: 'pages/profile/settings', label: '设置' },
    { path: 'pages/profile/profile-edit', label: '资料编辑' },
  ] },
  { group: '工具页', pages: [
    { path: 'pages/activity/index', label: '活动页壳页（用「活动页」动作配置）' },
    { path: 'pages/webview/index', label: '内置浏览器' },
    { path: 'pages/tkl/index', label: '淘口令中转' },
  ] },
];
const PAGE_FLAT = PAGE_REGISTRY.flatMap((g) => g.pages);
const TAB_PATHS = new Set(PAGE_FLAT.filter((p) => p.tab).map((p) => p.path));
function isTabPath(v) {
  const p = String(v ?? '').replace(/^\//, '').split('?')[0];
  return TAB_PATHS.has(p);
}

/** 品牌/插件下拉（B）：数据源=品牌库 /admin/brands（真实 brand_code，替代旧 BRAND_KEYS 死别名）；allow-create 保留但失焦实测探测 */
const brandOpts = ref([]);
async function loadBrandOpts() {
  if (brandOpts.value.length) return;
  try {
    const d = await api('/admin/brands');
    brandOpts.value = (d.items ?? []).map((b) => ({ brand_code: b.brand_code, name: b.name, category_name: b.category_name ?? b.category, enabled: b.enabled }));
  } catch (e) { ElMessage.error(e.message); }
}
const brandGroups = computed(() => {
  const map = new Map();
  for (const b of brandOpts.value) {
    if (!map.has(b.category_name)) map.set(b.category_name, { key: b.category_name, name: b.category_name, items: [] });
    map.get(b.category_name).items.push(b);
  }
  return [...map.values()];
});
const brandProbe = ref(null);
let probeSeq = 0;
async function probeBrand(code) {
  if (!code) { brandProbe.value = null; return; }
  if (brandOpts.value.some((b) => b.brand_code === code)) {
    brandProbe.value = { ok: true, msg: `已选品牌：${code}` };
    return;
  }
  const seq = ++probeSeq;
  brandProbe.value = { ok: null, msg: '探测品牌码中…' };
  try {
    const res = await fetch('/api/site/brand-launch?code=' + encodeURIComponent(code));
    const body = await res.json();
    if (seq !== probeSeq) return;
    brandProbe.value = body.ok
      ? { ok: true, msg: `自定义品牌码有效：${code}` }
      : { ok: false, msg: `⚠ 无效品牌码「${code}」：${body.code ?? ''}，C 端点击将呼起失败` };
  } catch {
    if (seq === probeSeq) brandProbe.value = { ok: false, msg: '探测请求失败（网络）' };
  }
}

/** 活动页（决策#33）：value = 装修页 key（page-xxxx）；下拉复用 /admin/schema/pages，新建即建空草稿并切换编辑 */
const activityPages = ref([]);
const creatingPage = ref(false);
async function loadActivityPages() {
  if (activityPages.value.length) return;
  try {
    const d = await api('/admin/schema/pages');
    activityPages.value = d.filter((p) => /^page-/.test(p.page));
  } catch { /* 列表失败留空，允许手输场景极少 */ }
}
async function createActivityPage() {
  creatingPage.value = true;
  try {
    const key = 'page-' + Math.random().toString(36).slice(2, 8);
    await api('/admin/schema/draft', { method: 'PUT', body: { page: key, floors: [] } });
    activityPages.value = [{ page: key, title: '' }, ...activityPages.value];
    if (activeAction.value) activeAction.value.value = key;
    // 编辑器切到新页直接装修
    pageOptions.value = [{ page: key, label: `页面 · ${key}` }, ...pageOptions.value.filter((o) => o.page !== key)];
    page.value = key;
    await load();
    ElMessage.success(`活动页 ${key} 已创建（草稿），装修完记得「发布」`);
  } catch (e) { ElMessage.error(e.message); } finally { creatingPage.value = false; }
}

/** 弹窗（D）：拆「文案弹层 / 聚宝盆签到」两档，target 显式化（checkin → 上抛宿主开签到） */
const popupKind = computed({
  get: () => (activeAction.value?.target === 'checkin' ? 'checkin' : 'text'),
  set: (v) => {
    const a = activeAction.value;
    if (!a) return;
    if (v === 'checkin') {
      a.target = 'checkin';
      if (!a.value) a.value = '签到领元宝';
    } else {
      delete a.target;
      if (a.value === '签到领元宝') a.value = '';
    }
  },
});
const navEditIdx = ref(-1);
const swiperEditIdx = ref(-1);
const itemAct = ref(null); // 泛化 item 级 action（分类导航/秒杀/拼团/券墙/宫格/活动按钮/热区）
function ensureItemAction(it) {
  if (!it.action || typeof it.action !== 'object') it.action = { type: 'none' };
}
function toggleItemAct(it) {
  ensureItemAction(it);
  itemAct.value = itemAct.value === it.action ? null : it.action;
}
/** 通用图片上传：写入 obj[key]（轮播/秒杀/拼团/热区/活动底图等共用） */
function uploadTo(obj, key, opt) {
  uploadImage(opt.file)
    .then((url) => { obj[key] = url; ElMessage.success('图片已上传'); })
    .catch((e) => ElMessage.error(e.message));
}
async function onUploadImg(it, opt) {
  uploadTo(it, 'img', opt);
}
/** 楼层级 action 支持的类型（action 存于 props.action） */
const FLOOR_ACT_TYPES = new Set(['search-bar', 'coupon-strip', 'rich-text', 'ingot-entry', 'float-btn', 'member-card', 'invite-floor', 'popup-modal', 'floor']);
const activeAction = computed(() => {
  if (!sel.value) return null;
  if (itemAct.value) return itemAct.value;
  if (sel.value.type === 'nav' && navEditIdx.value >= 0) {
    const it = sel.value.props.items?.[navEditIdx.value];
    return it?.action ?? null;
  }
  // 轮播 item 级 action
  if (sel.value.type === 'swiper' && swiperEditIdx.value >= 0) {
    const it = sel.value.props.items?.[swiperEditIdx.value];
    return it?.action ?? null;
  }
  // 楼层级 action（此前误查楼层根 `'action' in sel` 导致会员卡/悬浮按钮等编辑块不出现）
  if (FLOOR_ACT_TYPES.has(sel.value.type)) {
    if (!sel.value.props.action || typeof sel.value.props.action !== 'object') sel.value.props.action = { type: 'none' };
    return sel.value.props.action;
  }
  return null;
});

/* —— 楼层复制 —— */
function copyFloor(i) {
  const src = JSON.parse(JSON.stringify(floors.value[i]));
  const ids = newIds(src.type);
  src.floor_id = ids.floor_id;
  src.component_id = ids.component_id;
  floors.value.splice(i + 1, 0, src);
  selIdx.value = i + 1;
  commit();
  ElMessage.success('楼层已复制');
}

const schemaJson = computed(() => JSON.stringify({ page: page.value, floors: floors.value }, null, 2));

/* —— AI 重页：切回 AI 建页视图（设计稿 30 顶栏「cloudbase-agent AI 重页」）—— */
const emit = defineEmits(['regen-ai']);
</script>

<style scoped>
.diy { display: flex; flex-direction: column; gap: 12px; height: 100%; }

/* 顶部操作条 */
.opbar { display: flex; align-items: center; gap: 12px; }
.op-left { display: flex; align-items: center; gap: 10px; }
.page-select { width: 200px; }
.page-select :deep(.el-input__wrapper) { border-radius: 999px; }
.ai-btn {
  background: linear-gradient(100deg, #e8336d, #ff8a1d); color: #fff; border: none; cursor: pointer;
  font-weight: 800; font-size: 13px; border-radius: 999px; padding: 9px 16px; box-shadow: 0 3px 0 rgba(163, 18, 69, 0.35);
}
.ai-btn:hover { filter: brightness(1.06); }
.nav-row.editing { outline: 1.5px solid #ffaa1d; border-radius: 8px; }
.act-block { border-top: 1.5px dashed #f0dfc8; margin-top: 14px; padding-top: 4px; }
.op-right { margin-left: auto; display: flex; gap: 8px; }
.op-btn {
  display: flex; align-items: center; gap: 5px;
  background: #fff; border: 1.5px solid #f0dfc8; color: #3d2530; cursor: pointer;
  font-size: 13px; font-weight: 600; border-radius: 999px; padding: 9px 16px;
}
.op-btn:hover:not(:disabled) { background: #fff6e9; }
.op-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.op-btn.ghost { border-color: #e8336d; color: #e8336d; }
.op-btn.primary { background: #e8336d; border-color: #e8336d; color: #fff; box-shadow: 0 3px 0 rgba(163, 18, 69, 0.35); }
.op-btn.danger { border-color: #d63031; color: #d63031; }
.op-btn.danger:hover:not(:disabled) { background: #fdecec; }
.op-btn.primary:hover:not(:disabled) { background: #a31245; }

.state-line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #8a6b75; padding-left: 4px; flex-wrap: wrap; }
.ver { font-weight: 700; color: #3d2530; }
.dirty { color: #e8336d; font-weight: 700; }
.draft-hint { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.draft-hint.ok { color: #3d9a50; }
.draft-hint.warn { color: #a06a2c; }

/* 三栏 */
.cols { display: flex; gap: 14px; flex: 1; min-height: 0; }
.panel { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 16px; overflow: auto; }
.panel-title { font-size: 14px; font-weight: 800; color: #3d2530; margin-bottom: 12px; }

/* 左组件库 */
.palette { width: 210px; flex-shrink: 0; }
.pal-group-name { font-size: 12px; color: #a31245; font-weight: 700; margin: 10px 0 6px; }
.pal-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  background: #fff6e9; border: 1.5px solid #f6e3c8; border-radius: 10px;
  padding: 9px 10px; margin-bottom: 6px; cursor: pointer; font-size: 13px; font-weight: 600; color: #3d2530;
}
.pal-item:hover { border-color: #e8336d; background: #fdeef4; }
.pal-item.off { opacity: 0.45; cursor: not-allowed; background: #f7f3ec; }
.pal-dots { color: #d9a8bc; font-size: 10px; }
.pal-label { flex: 1; text-align: left; }
.pal-lock { font-size: 10px; color: #b0898f; }
.pal-tip { font-size: 11px; color: #b0898f; line-height: 1.6; margin-top: 10px; }

/* 中画布 */
.canvas-wrap { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 14px 16px; }
.canvas-head { font-size: 13px; color: #8a6b75; display: flex; justify-content: space-between; margin-bottom: 10px; }
.canvas-scroll { flex: 1; overflow: auto; display: flex; justify-content: center; align-items: flex-start; background: #fff6e9; border-radius: 12px; padding: 16px 0; }
.phone { width: 320px; background: #fff; border: 3px solid #3d2530; border-radius: 22px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 8px 0 rgba(163, 18, 69, 0.15); }
.phone-head { background: linear-gradient(120deg, #a31245, #e8336d); color: #fff; padding: 12px 14px; }
.ph-logo { font-weight: 900; font-size: 17px; letter-spacing: 1px; }
.ph-sub { font-size: 10.5px; opacity: 0.85; margin-top: 2px; }
.phone-body { flex: 1; padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 380px; }
.canvas-empty { flex: 1; display: flex; align-items: center; justify-content: center; }
.phone-tabbar { border-top: 1.5px solid #f0dfc8; display: flex; justify-content: space-around; padding: 8px 0; font-size: 11px; color: #b0898f; background: #fff; }
.phone-tabbar .on { color: #e8336d; font-weight: 700; }

.floor { position: relative; border: 2px dashed transparent; border-radius: 10px; cursor: pointer; }
.floor:hover { border-color: #ffaa1d; }
.floor.sel { border-color: #e8336d; background: #fdeef4; }
.floor-tag {
  position: absolute; top: -8px; left: 8px; z-index: 2;
  background: #3d2530; color: #fff; font-size: 10px; padding: 1px 8px; border-radius: 999px; display: none;
}
.floor.sel .floor-tag, .floor:hover .floor-tag { display: block; }
.floor-tools { position: absolute; top: -10px; right: 6px; z-index: 2; display: none; gap: 4px; }
.floor.sel .floor-tools, .floor:hover .floor-tools { display: flex; }
.floor-tools button {
  width: 22px; height: 22px; border: 1.5px solid #3d2530; background: #fff; border-radius: 6px;
  font-size: 11px; cursor: pointer; line-height: 1; color: #3d2530;
}
.floor-tools button:disabled { opacity: 0.35; cursor: not-allowed; }
.floor-tools .danger { color: #e8336d; border-color: #e8336d; }

/* 楼层预览样式已抽至 components/floor-preview.css（DIY 与 AI 页共用） */

/* 右属性面板 */
.props { width: 280px; flex-shrink: 0; }
.prop-hint { font-size: 11px; color: #b0898f; margin-bottom: 10px; }
.f-label { display: block; font-size: 12px; color: #8a6b75; font-weight: 600; margin: 10px 0 4px; }
.item-card { border: 1.5px solid #f0dfc8; border-radius: 10px; padding: 8px 10px; margin-top: 8px; }
.item-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 700; color: #a31245; }
.mini-del { border: none; background: none; color: #e8336d; cursor: pointer; font-size: 11px; }
.img-up-row { display: flex; align-items: center; gap: 8px; }
.img-up-preview { width: 88px; height: 36px; object-fit: cover; border-radius: 8px; border: 1.5px solid #f0dfc8; }
.mini-up {
  border: 1.5px dashed #e8336d; background: #fff; color: #e8336d; cursor: pointer;
  font-size: 11px; font-weight: 700; border-radius: 8px; padding: 6px 12px;
}
.mini-up:hover { background: #fdeef4; }
.nav-row { display: flex; gap: 5px; align-items: center; margin-top: 6px; }
.nav-icon { width: 64px; }
.add-item {
  width: 100%; margin-top: 10px; background: #fff6e9; border: 1.5px dashed #e8336d; color: #e8336d;
  border-radius: 10px; padding: 8px; cursor: pointer; font-size: 12.5px; font-weight: 700;
}
.add-item:hover { background: #fdeef4; }
.schema-pre { background: #3d2530; color: #ffe9c9; border-radius: 10px; padding: 14px; font-size: 11.5px; max-height: 55vh; overflow: auto; }

/* 选择器抽屉 */
.picker-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; overflow: auto; }
.picker-row { display: flex; align-items: center; gap: 10px; border: 1.5px solid #f0dfc8; border-radius: 12px; padding: 8px 10px; cursor: pointer; }
.picker-row:hover { border-color: #e8336d; }
.picker-row.off { opacity: 0.5; }
.picker-img { width: 46px; height: 46px; border-radius: 8px; object-fit: cover; flex: none; border: 1px solid #f0dfc8; }
.picker-ph { display: flex; align-items: center; justify-content: center; background: #fff6e9; font-size: 20px; }
.picker-t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.picker-t b { font-size: 13px; color: #3d2530; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-t i { font-style: normal; font-size: 11.5px; color: #a08592; }
.picked-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.picked-chip { display: inline-flex; align-items: center; gap: 4px; background: #fdeef4; color: #a31245; font-size: 11.5px; font-weight: 600; border-radius: 999px; padding: 3px 9px; max-width: 100%; }
.picked-chip i { font-style: normal; cursor: pointer; color: #e8336d; font-weight: 800; }
.picked-empty { font-size: 11.5px; color: #c5b3a4; }
.field-note { font-size: 11px; color: #b0898f; margin-top: 4px; }
.probe-bad { font-size: 11px; color: #d63031; margin-top: 4px; font-weight: 600; }
.act-row { display: flex; gap: 8px; align-items: center; }
.act-row .el-select { flex: 1; }
.act-new { flex-shrink: 0; white-space: nowrap; }
.muted { color: #c5b3a4; font-size: 13px; }
.pad { padding: 20px 4px; }
</style>
