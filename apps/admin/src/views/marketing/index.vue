<template>
  <!-- admin-40 营销中心：优惠券（唯一已闭环营销能力）/ 秒杀·拼团（开发中）/ 分佣开关（dist_alloc 单一真相源） / 签到梯度（决策#31）
       2026-10-02：Banner 位 tab 已移除——能力本就在装修器 swiper 楼层，营销中心无独立数据面，冗余入口 -->
  <div class="mk-page">
    <div class="head-row">
      <div>
        <h2 class="title">营销中心</h2>
        <p class="subtitle">优惠券（已上线）· 秒杀 / 拼团（开发中）· 分佣开关 · 签到梯度（聚宝盆 D1~D7 可配）</p>
      </div>
      <button v-if="tab === 'coupon'" class="rose-btn" @click="onNewCoupon">＋ 新建券</button>
      <button v-else-if="tab === 'seckill'" class="ghost-btn" @click="onDevPending('秒杀')">功能开发中</button>
      <button v-else-if="tab === 'groupbuy'" class="ghost-btn" @click="onDevPending('拼团')">功能开发中</button>
    </div>

    <div class="chip-row">
      <button v-for="t in tabs" :key="t.key" class="chip" :class="{ active: tab === t.key }" @click="switchTab(t.key)">{{ t.label }}</button>
    </div>

    <!-- 优惠券 -->
    <div v-if="tab === 'coupon'" class="grid">
      <div class="card">
        <div class="card-head">
          <span class="card-title">优惠券配置</span>
          <button class="ghost-btn" @click="onNewCoupon">＋ 新建券</button>
        </div>
        <div v-if="!coupons.length" class="empty-tip">暂无优惠券 · 点右上「新建券」创建第一张</div>
        <div v-for="c in coupons" :key="c.id" class="cp-row">
          <div class="cp-main">
            <div class="cp-name">{{ c.name }}</div>
            <div class="cp-sub">{{ couponDesc(c) }}</div>
          </div>
          <div class="cp-right">
            <span class="phase" :class="phaseClass(c.phase)">{{ c.phase }}</span>
            <a class="op" @click.prevent="toggleCoupon(c)">{{ c.status === 'active' ? '停用' : '启用' }}</a>
          </div>
        </div>
      </div>
      <div class="side-note card">
        <div class="card-title">◎ 券规则说明</div>
        <p class="tiny-note">· 券仅作用于本站自营到店团购下单；CPS 转链与权益订单不参与<br />· 立减券减固定金额；折扣券按 1~9.9 折减免；兑换券按商品全额抵扣<br />· 「有效期从」留空=立即生效；已过期券在C 端不再可领、不可选<br />· 券核销不影响上级分佣，发放与领取统计实时取自 user_coupon</p>
      </div>
    </div>

    <!-- 秒杀：数据面未建（seckill_activity 表已建但无写接口，2026-10-02 明确收口为开发中） -->
    <div v-else-if="tab === 'seckill'" class="grid">
      <div class="card">
        <div class="card-head">
          <span class="card-title">秒杀场次</span>
          <el-tag size="small" type="info" effect="plain">功能开发中</el-tag>
        </div>
        <el-empty description="秒杀场次尚未开放：场次创建、限时秒杀价、独立库存与限购能力均在开发中。当前可先用「优惠券」做限时促销" />
        <div v-if="seckills.length" class="cp-list">
          <div v-for="s in seckills" :key="s.id" class="cp-row">
            <div class="cp-main">
              <div class="cp-name">{{ s.goods_title }}</div>
              <div class="cp-sub">秒杀价 ¥{{ s.seckill_price }} · {{ time(s.start_at) }} ~ {{ time(s.end_at) }} · 库存 {{ s.stock }} · 限购 {{ s.limit_per_user }}/人</div>
            </div>
            <span class="phase" :class="s.status === 'active' ? 'on' : 'off'">{{ s.status === 'active' ? '进行中' : '已停用' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 拼团：schema 未建，接口 501（2026-10-02 保持诚实空态） -->
    <div v-else-if="tab === 'groupbuy'" class="card">
      <div class="card-head">
        <span class="card-title">拼团</span>
        <el-tag size="small" type="info" effect="plain">功能开发中</el-tag>
      </div>
      <el-empty description="拼团尚未开放：开团/参团/成团/超时退款全链路在建。当前可先用「优惠券」做拉新促活" />
    </div>

    <!-- 签到梯度（决策#31 聚宝盆：D1~D7 奖励后台可配） -->
    <div v-else-if="tab === 'checkin'" class="grid">
      <div class="card">
        <div class="card-head">
          <span class="card-title">聚宝盆签到 · 连签 7 天一盆</span>
          <el-tag v-if="ckCustomized" size="small" type="warning" effect="plain">已自定义</el-tag>
          <el-tag v-else size="small" type="info" effect="plain">默认梯度</el-tag>
        </div>
        <div class="ck-grid">
          <label v-for="(r, i) in ckRewards" :key="i" class="ck-cell" :class="{ d7: i === 6 }">
            <span class="ck-day">第 {{ i + 1 }} 天{{ i === 6 ? ' · 盆满大奖' : '' }}</span>
            <el-input-number v-model="ckRewards[i]" :min="1" :max="1000000" :step="10" :controls="false" style="width: 100%" />
            <span class="ck-unit">元宝</span>
          </label>
        </div>
        <button class="rose-btn ck-save" @click="saveCheckin">保存梯度</button>
        <div class="warn-bar">机制：断签不补签、重新计盆（第 8 天起开新盆按 D1 计）；D7 盆满触发「盆满钵满」动画。保存后 C 端签到弹层实时生效。</div>
      </div>
      <div class="side-note card">
        <div class="card-title">◎ 口径提醒</div>
        <p class="tiny-note">签到奖励入元宝账户（与购物返利/邀请奖励同池）；元宝唯一消耗 = 兑换会员等级。记录在 checkin_record（一盆一行，含逐日明细）。</p>
      </div>
    </div>

    <!-- 签到订阅提醒（决策#32：一次性订阅，授权一次发一条；每日 09:00 定时提醒未签用户） -->
    <div v-else-if="tab === 'checkin-push'" class="grid">
      <div class="card">
        <div class="card-head">
          <span class="card-title">签到每日提醒 · 订阅消息</span>
          <el-tag v-if="ckPushConfigured" size="small" type="success" effect="plain">已配置</el-tag>
          <el-tag v-else size="small" type="info" effect="plain">未配置</el-tag>
        </div>
        <div class="push-form">
          <label class="push-label">
            <span class="push-name">订阅消息模板 ID</span>
            <el-input v-model="ckPushTmpl" placeholder="mp.weixin.qq.com → 订阅消息 → 一次性订阅模板 ID" clearable />
          </label>
          <label class="push-label">
            <span class="push-name">模板字段映射（JSON，值支持 {n} 占位 = 今日可得元宝）</span>
            <el-input v-model="ckPushMap" type="textarea" :rows="4" placeholder='如 {"thing1":{"value":"该添金啦！今日可得{n}元宝"},"number2":{"value":"{n}"}}（与模板字段精确匹配）' />
          </label>
          <button class="rose-btn ck-save" @click="savePush">保存提醒配置</button>
          <button class="ghost-btn" style="margin-left: 10px" @click="testPush">手动触发一次提醒</button>
        </div>
        <div class="warn-bar">机制：一次性订阅 = 用户授权一次可发一条（C 端签到成功后引导授权）；每日 09:00 对已授权且未签到的用户推送，成功后消耗一条额度。定时器已随部署自动创建（checkin-remind-timer），无需手工配置。</div>
      </div>
      <div class="side-note card">
        <div class="card-title">◎ 配置步骤</div>
        <p class="tiny-note">① 小程序后台申请「一次性订阅」模板，复制模板 ID 填入上方<br />② 字段映射与模板字段精确对应，值可用 {'{n}'} 占位符（发送时替换为今日可得元宝数）<br />③ 保存后 C 端签到弹层自动下发授权请求<br />④ 每日 09:00 推送由 checkin-remind-timer 云函数触发，部署时自动配置；改周期执行 <code>node deploy/scripts/function-deploy.mjs --job=checkin-remind</code></p>
      </div>
    </div>

    <!-- 分佣开关 -->
    <div v-else class="grid">
      <div class="card">
        <div class="card-head"><span class="card-title">分佣开关 · 站点·活动·品类三级</span></div>
        <div v-for="(it, i) in distItems" :key="it.key" class="sw-row">
          <div>
            <div class="sw-label">{{ it.label }}</div>
            <div class="sw-sub">{{ subTexts[i] ?? '未开启时该项下单不参与三级分配' }}</div>
          </div>
          <el-switch v-model="it.on" :disabled="!isPlatform" @change="saveSwitch" />
        </div>
        <div class="warn-bar">分佣关闭的订单：自购元宝返照常发放，仅停止上级现金分佣</div>
      </div>
      <div class="side-note card">
        <div class="card-title">◎ 比例只读提醒</div>
        <p class="tiny-note">L2 直推 10% · L3 直推 20% · L3 间推 5%（随等级策略调整，改档请前往「分销管理 → 佣金结算配置」）</p>
      </div>
    </div>

    <!-- 新建券弹窗 -->
    <el-dialog v-model="dlg" title="新建优惠券" width="440px">
      <div class="form">
        <label>券名<el-input v-model="form.name" placeholder="如：新人立减券" maxlength="40" /></label>
        <div class="form-2">
          <label>类型
            <el-select v-model="form.type" style="width: 100%">
              <el-option label="立减券（减固定金额）" value="cash_off" />
              <el-option label="折扣券（按折扣减免）" value="discount" />
              <el-option label="兑换券（全额抵扣）" value="exchange" />
            </el-select>
          </label>
          <label>作用域
            <el-select v-model="form.scope" style="width: 100%" disabled>
              <el-option label="到店团购订单" value="self" />
            </el-select>
          </label>
        </div>
        <div class="form-2">
          <label v-if="form.type === 'discount'">折扣（1~9.9 折）<el-input-number v-model="form.amount" :min="1" :max="9.9" :step="0.5" :precision="1" style="width: 100%" /></label>
          <label v-else-if="form.type === 'cash_off'">面额（元）<el-input-number v-model="form.amount" :min="0.01" :step="1" :precision="2" style="width: 100%" /></label>
          <label v-else class="fld-static">兑换券<text class="tiny-note">按商品全额抵扣，无面额</text></label>
          <label>使用门槛（0=无门槛）<el-input-number v-model="form.threshold" :min="0" :step="5" style="width: 100%" /></label>
        </div>
        <div class="form-2">
          <label>有效期从<el-date-picker v-model="form.valid_from" type="datetime" placeholder="留空=立即生效" style="width: 100%" /></label>
          <label>有效期至<el-date-picker v-model="form.valid_to" type="datetime" placeholder="留空=长期有效" style="width: 100%" /></label>
        </div>
        <div class="form-2">
          <label>发放总量<el-input-number v-model="form.total" :min="1" :step="100" style="width: 100%" /></label>
          <label class="fld-static">提示<text class="tiny-note">{{ phaseHint }}</text></label>
        </div>
      </div>
      <template #footer>
        <el-button @click="dlg = false">取消</el-button>
        <el-button type="primary" color="#e8336d" @click="submitCoupon">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';

const isPlatform = JSON.parse(localStorage.getItem('fyt_admin_info') ?? 'null')?.role === 'platform_admin';
const tabs = [
  { key: 'coupon', label: '优惠券' },
  { key: 'seckill', label: '秒杀活动' },
  { key: 'groupbuy', label: '拼团' },
  { key: 'switch', label: '分佣开关' },
  { key: 'checkin', label: '签到梯度' },
  { key: 'checkin-push', label: '签到提醒' },
];
const subTexts = ['全局分销开启，全品类生效', '参与秒杀场次，秒杀价低不另分佣', '分佣关闭，保留自购返元宝'];
const tab = ref('coupon');
const coupons = ref([]);
const seckills = ref([]);
const distItems = ref([]);
const ckRewards = ref([50, 60, 70, 80, 90, 100, 500]);
const ckCustomized = ref(false);
const ckPushTmpl = ref('');
const ckPushMap = ref('');
const ckPushConfigured = ref(false);
const dlg = ref(false);
const form = ref(newCouponForm());

function newCouponForm() {
  return { name: '', type: 'cash_off', scope: 'self', amount: 5, threshold: 0, total: 1000, valid_from: null, valid_to: null };
}

const phaseHint = computed(() => {
  if (!form.value.valid_from) return '立即生效';
  return '未到开始时间 → 排期中，C 端不可领';
});

// 全站时间统一带年份（2026-10-02 修：原先只显月/日，跨年券看不出哪年失效）
const time = (t) => (t ? new Date(t).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const phaseClass = (p) => (p === '进行中' ? 'on' : p === '排期中' ? 'wait' : 'off');

function couponDesc(c) {
  const parts = [];
  if (c.valid_from || c.valid_to) parts.push(`有效期 ${c.valid_from ? time(c.valid_from) : '—'} ~ ${c.valid_to ? time(c.valid_to) : '—'}`);
  parts.push(`已发 ${c.issued.toLocaleString()} / ${c.total.toLocaleString()}`);
  parts.push('自营到店团购可用');
  return parts.join(' · ');
}

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

async function loadTab(key) {
  try {
    if (key === 'coupon') coupons.value = (await api('/admin/marketing/coupons')).coupons;
    else if (key === 'seckill') seckills.value = (await api('/admin/marketing/seckills')).seckills;
    else if (key === 'switch') distItems.value = (await api('/admin/marketing/dist-switch')).items;
    else if (key === 'checkin') {
      const d = await api('/admin/checkin');
      ckRewards.value = d.rewards;
      ckCustomized.value = d.customized;
    } else if (key === 'checkin-push') {
      const d = await api('/admin/checkin');
      ckPushTmpl.value = d.push?.tmpl ?? '';
      ckPushMap.value = d.push?.map ?? '';
      ckPushConfigured.value = !!(d.push?.tmpl && d.push?.map);
    }
  } catch (e) { ElMessage.error(e.message); }
}
function switchTab(key) { tab.value = key; loadTab(key); }

function onDevPending(name) { ElMessage.info(`${name}功能开发中，当前暂不支持创建`); }
function onNewCoupon() { form.value = newCouponForm(); dlg.value = true; }

async function submitCoupon() {
  if (!form.value.name.trim()) return ElMessage.warning('券名不能为空');
  // 有效期区间自检（2026-10-02）：开始晚于结束是配置错误，后端会拒，这里先拦一道给运营明确提示
  if (form.value.valid_from && form.value.valid_to && new Date(form.value.valid_from) >= new Date(form.value.valid_to)) {
    return ElMessage.warning('有效期「从」必须早于「至」');
  }
  // 兑换券无面额（服务端按全额抵扣计算），避免运营误填造成困惑
  const amount = form.value.type === 'exchange' ? 0 : Number(form.value.amount);
  try {
    await api('/admin/marketing/coupons', {
      method: 'POST',
      body: {
        ...form.value,
        name: form.value.name.trim(),
        amount,
        valid_from: form.value.valid_from ? new Date(form.value.valid_from).toISOString() : null,
        valid_to: form.value.valid_to ? new Date(form.value.valid_to).toISOString() : null,
      },
    });
    ElMessage.success('券已创建（进行中）');
    dlg.value = false;
    await loadTab('coupon');
  } catch (e) { ElMessage.error(e.message); }
}

async function toggleCoupon(c) {
  try {
    await api(`/admin/marketing/coupons/${c.id}`, { method: 'PATCH', body: { status: c.status === 'active' ? 'disabled' : 'active' } });
    ElMessage.success(c.status === 'active' ? '已停用' : '已启用');
    await loadTab('coupon');
  } catch (e) { ElMessage.error(e.message); }
}

async function saveSwitch() {
  try {
    await api('/admin/marketing/dist-switch', { method: 'PUT', body: { items: distItems.value } });
    ElMessage.success('分佣开关已保存（与佣金结算配置共用同一配置）');
  } catch (e) { ElMessage.error(e.message); }
}

async function saveCheckin() {
  const rewards = ckRewards.value.map((v) => Number(v));
  if (rewards.some((v) => !Number.isInteger(v) || v <= 0)) return ElMessage.warning('每项须为正整数');
  try {
    await api('/admin/checkin', { method: 'PUT', body: { rewards } });
    ckCustomized.value = true;
    ElMessage.success('签到梯度已保存，随站点配置实时下发');
  } catch (e) { ElMessage.error(e.message); }
}

async function savePush() {
  const tmpl = ckPushTmpl.value.trim();
  const mapRaw = ckPushMap.value.trim();
  if (!tmpl) return ElMessage.warning('模板 ID 必填');
  if (mapRaw) {
    try {
      const m = JSON.parse(mapRaw);
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('not object');
    } catch {
      return ElMessage.warning('字段映射须为合法 JSON 对象');
    }
  }
  try {
    await api('/admin/checkin/push-config', { method: 'PUT', body: { tmpl, map: mapRaw || null } });
    ckPushConfigured.value = !!mapRaw;
    ElMessage.success('提醒配置已保存（C 端签到后开始收集授权）');
  } catch (e) { ElMessage.error(e.message); }
}

async function testPush() {
  try {
    const d = await api('/jobs/checkin-remind', { method: 'POST' });
    const lines = (d.sites ?? []).map((s) => `${s.site}: ${s.skipped ? '跳过(' + s.skipped + ')' : `发 ${s.sent ?? 0} · 清 ${s.cleared ?? 0} · 失败 ${s.failed ?? 0}`}`);
    ElMessage({ message: lines.join('；') || '无站点', type: 'info', duration: 5000 });
  } catch (e) { ElMessage.error(e.message); }
}

onMounted(() => loadTab('coupon'));
</script>

<style scoped>
.mk-page { display: flex; flex-direction: column; gap: 14px; }
.head-row { display: flex; align-items: flex-start; justify-content: space-between; }
.title { font-size: 20px; font-weight: 900; color: #3d2530; margin: 0 0 4px; }
.subtitle { font-size: 12px; color: #b08a96; margin: 0; }
.rose-btn {
  background: #e8336d; color: #fff; border: none; cursor: pointer;
  font-size: 12.5px; font-weight: 800; border-radius: 999px; padding: 8px 18px;
}
.chip-row { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  border: 1.5px solid #e8b7c8; background: #fff; color: #a31245; cursor: pointer;
  font-size: 13px; font-weight: 700; border-radius: 999px; padding: 7px 20px;
}
.chip:hover { background: #fff6e9; }
.chip.active { background: #e8336d; border-color: #e8336d; color: #fff; }
.grid { display: grid; grid-template-columns: 1fr 300px; gap: 14px; align-items: start; }
@media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 16px 18px; }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.card-title { font-size: 14px; font-weight: 800; color: #3d2530; }
.ghost-btn {
  background: #fff; border: 1.5px solid #e8b7c8; color: #a31245; cursor: pointer;
  font-size: 12px; font-weight: 700; border-radius: 999px; padding: 5px 14px;
}
.cp-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid #f6e9da; border-radius: 12px; margin-bottom: 10px; background: #fffdf9; }
.cp-name { font-size: 13.5px; font-weight: 800; color: #3d2530; }
.cp-sub { font-size: 11.5px; color: #b99aa4; margin-top: 3px; }
.cp-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.phase { font-size: 12px; font-weight: 800; }
.phase.on { color: #1a9d5c; }
.phase.wait { color: #e07800; }
.phase.off { color: #aaa; }
.op { color: #a35b76; font-size: 12px; cursor: pointer; }
.empty-tip { font-size: 12.5px; color: #b99aa4; padding: 10px 0 4px; }
.side-note { background: #fff6e9; }
.tiny-note { font-size: 11.5px; color: #8a6b75; line-height: 2; margin: 8px 0 0; }
.sw-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px dashed #f3e6d8; }
.ck-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
@media (max-width: 1100px) { .ck-grid { grid-template-columns: repeat(2, 1fr); } }
.push-form { display: flex; flex-direction: column; gap: 12px; margin-bottom: 14px; }
.push-label { display: flex; flex-direction: column; gap: 6px; }
.push-name { font-size: 12px; font-weight: 700; color: #6b4a56; }
.ck-cell { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1.5px solid #f0dfc8; border-radius: 12px; background: #fffdf9; }
.ck-cell.d7 { border-color: #e8b7c8; background: #fff6e9; }
.ck-day { font-size: 11.5px; font-weight: 800; color: #8a6b75; }
.ck-cell.d7 .ck-day { color: #a31245; }
.ck-unit { font-size: 11px; color: #b99aa4; }
.ck-save { margin-bottom: 12px; }
.sw-label { font-size: 13.5px; font-weight: 800; color: #3d2530; }
.sw-sub { font-size: 11.5px; color: #b99aa4; margin-top: 2px; }
.warn-bar { background: #fbdde9; color: #a31245; font-size: 12px; font-weight: 700; border-radius: 10px; padding: 9px 14px; margin-top: 12px; }
.form label { display: block; font-size: 12px; color: #6d4a56; font-weight: 600; margin-bottom: 10px; }
.form-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
</style>
