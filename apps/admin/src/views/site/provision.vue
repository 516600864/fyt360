<template>
  <!-- admin-52 凭据开通向导（决策 #43 正式新屏）
       四组凭据落点互不相同，逐卡片写明「落哪 / 能不能测 / 要不要填」 -->
  <div class="provision">
    <div class="head">
      <h2 class="title">凭据开通</h2>
      <p class="subtitle">
        站点「壳」已建好，下面五组凭据由本站负责人自助配置。平台不代持任何凭据。
      </p>
    </div>

    <div v-if="!site || site.scope !== 'site'" class="state-box warn">
      <b>请先选择站点</b>
      <p>当前是平台工作台（跨站只读）。请在右上角「工作台」切到具体站点后再配置凭据。</p>
    </div>

    <!-- ⛔ 无权 / 会话缺站标识：说清「找谁」，而不是停在四个空 Tab -->
    <div v-else-if="denied" class="state-box warn">
      <b>{{ denied === 'notOwner' ? '你不是该站负责人，无权配置凭据' : '无法读取该站凭据状态' }}</b>
      <p v-if="denied === 'notOwner'">
        凭据是站点的「钱袋子」，按决策 #43 只有负责人（admin_user_site.is_owner）能读写。
        请让该站负责人在此配置，或联系平台管理员在「站点管理 → 成员卡 → 设为负责人」移交给你。
      </p>
      <p v-else-if="denied === 'noSiteId'">
        当前会话缺少站点标识（site_id），无法定位要配置哪一站。请退出后重新选择站点再进入。
      </p>
      <p v-else>你没有该站的管理权限，或站点已被删除。请在右上角「工作台」切换站点，或联系平台管理员。</p>
    </div>

    <template v-else>
      <!-- 开通状态条 ⛔ 2026-10-05 修：服务端开通状态在 data.site.provisioned / data.provision_state.provisioned，
           从来没有顶层 data.provisioned —— 原来直接读 info.provisioned 恒 undefined →
           横幅从上线起就恒显「站点尚未开通」，哪怕站点早已 active+passed（ducunyi 反复被这个坑）。 -->
      <div class="state-box" :class="provisioned ? 'ok' : 'no'">
        <div class="state-row">
          <span class="state-dot" />
          <b>{{ provisioned ? '站点已开通' : '站点尚未开通' }}</b>
          <span class="state-site">{{ info.site?.name }}（{{ info.site?.code }}）</span>
        </div>
        <p v-if="!provisioned">{{ info.provision_state?.blocker }}</p>
        <p v-else>其余功能已全部解锁。若要新增或更换凭据，改完点保存即可（会自动重测蚂蚁星球连通性）。</p>
        <p class="state-hint">{{ info.provision_state?.hint }}</p>
      </div>

      <el-alert
        v-if="info.site && info.site.status !== 'active'"
        type="warning" :closable="false" class="status-alert"
        :title="`当前站点状态为「${STATUS_TEXT[info.site.status] ?? info.site.status}」`"
      >
        <template #default>
          <template v-if="info.site.status === 'pending'">
            蚂蚁凭据连通测试通过后站点会<b>自动启用</b>，无需手动操作；C 端即刻对外可访问。
          </template>
          <template v-else>
            站点已被停用。恢复上线需回到「站点管理」点<b>启用</b>（凭据已在，连通性不受影响）。
          </template>
        </template>
      </el-alert>

      <!-- ⛔ admin-52 设计稿 1:1：五块编号纵列（①蚂蚁 ②小程序 ③公众号 ④支付 ⑤企微），
           不是 el-tabs —— 设计稿每块常驻可见，逐块自带「必填/选填 + 配置态」徽标与说明，
           Tab 化会把「还有哪块没配」藏起来，违背「开通清单」的定位。 -->
      <div class="prov-list" v-loading="loading">
        <!-- ① 蚂蚁星球 -->
        <section class="prov-card">
          <header class="pc-head">
            <span class="pc-no">1</span>
            <b class="pc-title">蚂蚁星球 API Key</b>
            <span class="badge req">必填</span>
            <span class="pc-status" :class="group('mayixingqiu').configured ? 'ok' : 'no'">
              {{ group('mayixingqiu').configured ? '已配置' : '未配置' }}
            </span>
          </header>
          <p class="desc">本站全部 CPS 供给的唯一来源（{{ group('mayixingqiu').note }}）</p>
          <div class="meta-row">
            <span class="meta-k">落点</span><span class="meta-v">{{ group('mayixingqiu').store_at }}</span>
            <span class="meta-k">连通性测试</span><span class="meta-v ok-text">✅ 唯一提供测试的一组</span>
          </div>

          <el-form label-width="110px" class="form">
            <el-form-item label="apikey">
              <el-input v-model="ants.apikey" :placeholder="ants.key_masked || '蚂蚁星球后台 → 系统设置 → API 开放平台'" />
            </el-form-item>
            <el-form-item label="api_secret">
              <el-input
                v-model="ants.api_secret" type="password" show-password
                :placeholder="ants.has_secret ? '已配置（留空表示不修改）' : '选填，部分签名接口需要'"
              />
            </el-form-item>
          </el-form>

          <!-- ⛔ 必须 configured 才渲染测试结果：未配置/加载失败时 ants.test_status 是 undefined，
               `undefined !== 'untested'` 恒真 → 会渲染出假的「连通失败」，看起来就像保存没生效 -->
          <div v-if="ants.configured && ants.test_status !== 'untested'" class="test-result" :class="ants.test_status">
            <b>{{ ants.test_status === 'passed' ? '✅ 连通正常' : '❌ 连通失败' }}</b>
            <span>{{ ants.test_message }}</span>
            <span v-if="ants.tested_at" class="test-time">{{ ants.tested_at.slice(0, 19).replace('T', ' ') }}</span>
          </div>

          <div class="btn-row">
            <el-button type="primary" :loading="saving" @click="saveAnts">保存并测试</el-button>
            <el-button :loading="testing" :disabled="!ants.configured" @click="testAnts">重新测试</el-button>
            <span class="btn-note">保存时会自动打一次上游，不需要再点测试。</span>
          </div>
        </section>

        <!-- ② 小程序 -->
        <section class="prov-card">
          <header class="pc-head">
            <span class="pc-no">2</span>
            <b class="pc-title">微信小程序凭据</b>
            <span class="badge">选填</span>
            <span class="pc-status" :class="group('wechat_mini').configured ? 'ok' : 'no'">
              {{ group('wechat_mini').configured ? '已配置' : '未配置' }}
            </span>
          </header>
          <p class="desc">{{ group('wechat_mini').note }}</p>
          <p class="desc sub">{{ group('wechat_mini').note_extra }}</p>
          <div class="meta-row">
            <span class="meta-k">落点</span><span class="meta-v">{{ group('wechat_mini').store_at }}</span>
          </div>

          <el-form label-width="110px" class="form">
            <el-form-item label="appid">
              <el-input v-model="mini.appid" :placeholder="mini.key_masked || 'wx 开头 + 16 位'" />
            </el-form-item>
            <el-form-item label="app_secret">
              <el-input
                v-model="mini.mini_secret" type="password" show-password
                :placeholder="mini.has_secret ? '已配置（留空表示不修改）' : '小程序后台 → 开发管理 → 开发设置'"
              />
            </el-form-item>
          </el-form>
          <div class="btn-row">
            <el-button type="primary" :loading="saving" @click="saveMini">保存</el-button>
            <span class="btn-note">配错的表现是 C 端登录静默失败，服务端离线验不出来，填完请真机点一次登录。</span>
          </div>
        </section>

        <!-- ③ 公众号（admin-52 设计稿第③块，此前整块漏实现） -->
        <section class="prov-card">
          <header class="pc-head">
            <span class="pc-no">3</span>
            <b class="pc-title">微信公众号凭据</b>
            <span class="badge warn2">做 H5 必填</span>
            <span class="pc-status" :class="group('wechat_mp').configured ? 'ok' : 'no'">
              {{ group('wechat_mp').configured ? '已配置' : '未配置' }}
            </span>
          </header>
          <p class="desc">{{ group('wechat_mp').note }}</p>
          <p class="desc sub">{{ group('wechat_mp').note_extra }}</p>
          <div class="meta-row">
            <span class="meta-k">落点</span><span class="meta-v">{{ group('wechat_mp').store_at }}</span>
          </div>

          <el-form label-width="110px" class="form">
            <el-form-item label="appid">
              <el-input v-model="mp.appid" :placeholder="mp.key_masked || 'wx 开头 + 16 位（与小程序 appid 同形，但不是同一个）'" />
            </el-form-item>
            <el-form-item label="app_secret">
              <el-input
                v-model="mp.api_secret" type="password" show-password
                :placeholder="mp.has_secret ? '已配置（留空表示不修改）' : '公众平台 → 设置与开发 → 基本配置 → 开发者密码'"
              />
            </el-form-item>
          </el-form>
          <div class="btn-row">
            <el-button type="primary" :loading="saving" @click="saveMp">保存</el-button>
            <span class="btn-note">配错的表现是 OAuth code 换不回 openid（H5 登录 401）；另需在公众平台配置 H5 域名的网页授权回调域名。</span>
          </div>
        </section>

        <!-- ④ 微信支付 -->
        <section class="prov-card">
          <header class="pc-head">
            <span class="pc-no">4</span>
            <b class="pc-title">微信支付商户号</b>
            <span class="badge">仅自营需要</span>
            <span class="pc-status" :class="group('site_payment').configured ? 'ok' : 'no'">
              {{ group('site_payment').configured ? '已配置' : '未配置' }}
            </span>
          </header>
          <p class="desc">{{ group('site_payment').note }}</p>
          <p class="desc sub">
            与侧栏「支付商户」菜单<b>同写 site_payment 一张表</b>（同一真相源的两个入口）：
            这里管「配齐开通」，费率调整 / 换证书等日常维护去支付商户菜单。
          </p>
          <div class="meta-row">
            <span class="meta-k">落点</span><span class="meta-v">{{ group('site_payment').store_at }}</span>
          </div>

          <el-form label-width="110px" class="form">
            <el-form-item label="商户号">
              <el-input v-model="pay.mch_id" :placeholder="pay.mch_id_masked || '如 1618593690（商户平台 → 账户中心）'" />
            </el-form-item>
            <el-form-item label="APIv3 密钥">
              <el-input
                v-model="pay.mch_key" type="password" show-password
                :placeholder="pay.has_key ? '已配置（留空表示不修改）' : '商户平台 → API 安全 → 设置 APIv3 密钥（32 位）'"
              />
            </el-form-item>
            <el-form-item label="证书序列号">
              <el-input v-model="pay.serial_no" :placeholder="pay.serial_no || '商户 API 证书序列号（十六进制，apiclient_cert.pem 中可见）'" />
            </el-form-item>
            <el-form-item label="商户私钥">
              <el-input
                v-model="pay.cert" type="textarea" :rows="4"
                :placeholder="pay.has_cert ? '已配置（留空表示不修改）' : 'apiclient_key.pem 全文，含 BEGIN/END 两行'"
              />
            </el-form-item>
            <el-form-item label="支付回调地址">
              <el-input :model-value="pay.callback_url" readonly class="readonly-input">
                <template #append>
                  <el-button @click="copyCallback">复制</el-button>
                </template>
              </el-input>
            </el-form-item>
          </el-form>
          <div class="btn-row">
            <el-button type="primary" :loading="saving" @click="savePay">保存</el-button>
            <span class="btn-note">证书序列号必须与私钥配对，否则下单会失败；凭据正确与否只有真下一单才知道。</span>
          </div>
        </section>

        <!-- ⑤ 企微客服 -->
        <section class="prov-card">
          <header class="pc-head">
            <span class="pc-no">5</span>
            <b class="pc-title">企业微信客服</b>
            <span class="badge">选填</span>
            <span class="pc-status" :class="group('kf').configured ? 'ok' : 'no'">
              {{ group('kf').configured ? '已配置' : '未配置' }}
            </span>
          </header>
          <p class="desc">{{ group('kf').note }}</p>
          <div class="meta-row">
            <span class="meta-k">落点</span><span class="meta-v">{{ group('kf').store_at }}</span>
          </div>

          <el-form label-width="110px" class="form">
            <el-form-item label="企业 ID">
              <el-input v-model="kf.corp_id" :placeholder="kf.corp_id || '企业微信 → 我的企业 → 企业信息（ww 开头）'" />
            </el-form-item>
            <el-form-item label="客服链接">
              <el-input v-model="kf.kf_url" :placeholder="kf.kf_url_masked || 'https://work.weixin.qq.com/kfid/...'" />
            </el-form-item>
            <el-form-item label="启用">
              <el-switch v-model="kf.active" />
            </el-form-item>
          </el-form>
          <div class="btn-row">
            <el-button type="primary" :loading="saving" @click="saveKf">保存</el-button>
            <span class="btn-note">企业 ID 还须人工在微信公众平台后台绑定，平台侧无法代劳。</span>
          </div>
        </section>
      </div>

      <!-- 开通检查清单（admin-52 设计稿 1:1 2026-10-09 重导版：标题+右侧注+chips 状态副文案+下载成功条）。
           ⚠️ 判定口径按决策 #44：白名单门控只认蚂蚁星球；此处如实展示五块配置完整性。 -->
      <div class="overview">
        <div class="ov-head">
          <div class="ov-title">开通检查清单</div>
          <span class="ov-note">仅「蚂蚁星球 apikey」通过即可开通；公众号仅在做 H5 时必需，其余可后补</span>
        </div>
        <div class="ov-grid">
          <div v-for="g in info.groups" :key="g.key" class="ov-cell">
            <span class="ov-name">{{ OV_NAME[g.key] ?? g.title }}</span>
            <span class="ov-state" :class="ovState(g)">{{ ovSub(g) }}</span>
          </div>
        </div>

        <!-- 决策 #48 下载入口（admin-52 设计稿：汇总卡底部全宽成功条）。
             展示条件 = 已开通 且 小程序凭据已配置——appid 是服务端出包注入的真相源，
             缺了服务端也 409 SITE_MINI_NOT_CONFIGURED，条子亮着就是许诺能下载。 -->
        <div v-if="provisioned && group('wechat_mini').configured" class="pkg-bar">
          <span class="pkg-check">✓</span>
          <div class="pkg-text">
            <b>已开通 · 小程序安装包就绪</b>
            <span>凭据开通完成即生成安装包，可反复下载（每次下载实时注入本站凭据；模板随平台部署刷新<template v-if="pkgVersion.version">，当前模板 {{ pkgVersion.version }}</template>）；下载后用微信开发者工具导入并上传发布</span>
          </div>
          <el-button class="pkg-btn" :loading="pkgLoading" @click="downloadPkg">下载小程序包</el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { adminApi } from '../../lib/api.js';

const props = defineProps({ site: { type: Object, default: null } });
const emit = defineEmits(['done']);

const STATUS_TEXT = { pending: '待开通', active: '运行中', disabled: '已停用' };

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const info = ref({ groups: [], site: null, provision_state: {} });

const ants = reactive({ apikey: '', api_secret: '' });
const mini = reactive({ appid: '', mini_secret: '' });
const mp = reactive({ appid: '', api_secret: '' });
const pay = reactive({ mch_id: '', mch_key: '', serial_no: '', cert: '', callback_url: '' });
const kf = reactive({ corp_id: '', kf_url: '', active: false });

const group = (key) => info.value.groups.find((g) => g.key === key) ?? {};

/* ── 开通检查清单（admin-52 画布 2026-10-09 重导版 1:1）── */
/** chips 显示名：画布用短名（服务端 title 是全称，别处可能在用，不动服务端） */
const OV_NAME = {
  mayixingqiu: '蚂蚁星球 apikey',
  wechat_mini: '小程序 appid',
  wechat_mp: '微信公众号',
  site_payment: '微信支付商户',
  kf: '企微客服',
};
/** chips 副文案：画布绘制了「未配置态后果」与蚂蚁「连通通过」，其余状态按同模式如实补全 */
function ovSub(g) {
  if (g.key === 'mayixingqiu') {
    if (!g.configured) return '未配置 · 站点无法开通';
    if (g.test_status === 'passed') return '已配置 · 连通通过';
    if (g.test_status === 'failed') return '已配置 · 连通失败';
    return '已配置';
  }
  if (g.key === 'wechat_mini') return g.configured ? '已配置' : '未配置 · 暂无安装包可下';
  if (g.key === 'wechat_mp') return g.configured ? '已配置' : '未配置 · 小程序可正常用，H5 端将无法登录';
  if (g.key === 'site_payment') return g.configured ? '已配置' : '未配置 · 站点将无自营团购';
  if (g.key === 'kf') return g.configured ? '已配置' : '未配置 · 客服入口将隐藏';
  return g.configured ? '已配置' : '未配置';
}
/** 副文案配色：绿=就绪 / 橙=影响营收（支付）/ 灰=暂缺 / 红=蚂蚁连通失败 */
function ovState(g) {
  if (g.key === 'mayixingqiu') {
    if (g.configured && g.test_status === 'failed') return 'fail';
    return g.configured ? 'ok' : 'no';
  }
  if (g.key === 'site_payment') return g.configured ? 'ok' : 'warn';
  return g.configured ? 'ok' : 'no';
}
/**
 * 掩码回填契约的提交侧守卫：含 '•' 的值 = 用户没改（还是回填的掩码串）→ 发空串，
 * 服务端按「沿用原值」处理。真凭据不可能含 '•'，不会误伤真实输入。
 */
const fresh = (v) => {
  const s = String(v ?? '').trim();
  return s.includes('•') ? '' : s;
};
const siteId = computed(() => (props.site?.scope === 'site' ? props.site.site_id : ''));
/** 开通状态唯一读法：provision_state.provisioned（服务端权威），回落 site.provisioned。
 *  ⛔ 服务端从未发过顶层 data.provisioned，别再读那个（2026-10-05 恒 false 惨案）。 */
const provisioned = computed(() =>
  Boolean(info.value.provision_state?.provisioned ?? info.value.site?.provisioned)
);
/**
 * 屏 52 全部端点都过 requireOwner：非负责人连读都 403（凭据配置态本身就是敏感信息）。
 * ⛔ 2026-10-05：原实现只弹一句红色 toast，页面停在四个空 Tab，用户不知道该找谁。
 *   现在把「无权」渲染成明确的说明态（谁该做什么），而不是让人对着空表单猜。
 */
const denied = ref('');

const pkgLoading = ref(false);
/** 模板包版本（2026-10-09 tabbar 事故后增补）：让租户自证下载到的是新包 */
const pkgVersion = ref({ version: null, built_at: null });
/**
 * 决策 #48：下载本站专属小程序包（服务端按 wechat_mini 凭据实时注入 appid/SITE_CODE）。
 * ⛔ adminApi 是 JSON 包装（r.json() 会把 zip 流吃爆），二进制必须裸 fetch + blob；
 *   错误响应靠 content-type 识别回 JSON 语义。文件名固定 miniprogram-<code>.zip
 *   （与端点 Content-Disposition 一致，绕开各浏览器对该头的兼容差异）。
 * 每次下载=服务端实时重新注入生成（appid/token/项目名）；模板本体随平台部署刷新，
 * 版本号来自模板 meta（BUILD 串），进页面即拉取展示。
 */
async function loadPkgMeta() {
  try {
    const code = info.value.site?.code;
    if (!code) return;
    const d = await adminApi(`/admin/sites/${code}/miniprogram/meta`);
    pkgVersion.value = { version: d?.version ?? null, built_at: d?.built_at ?? null };
  } catch { /* meta 拿不到不阻塞主流程，下载时端点还有双保险 */ }
}

async function downloadPkg() {
  pkgLoading.value = true;
  try {
    const code = info.value.site?.code;
    const r = await fetch(`/api/admin/sites/${code}/miniprogram`, {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token') },
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      throw new Error(j?.message || `下载失败（HTTP ${r.status}）`);
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `miniprogram-${code}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    const v = r.headers.get('X-Mini-Pkg-Version') || pkgVersion.value.version;
    loadPkgMeta();
    ElMessage.success(v ? `已下载模板版本 ${v}：微信开发者工具导入 → 上传 → 提审` : '安装包已开始下载：微信开发者工具导入 → 上传 → 提审');
  } catch (e) { ElMessage.error(e.message); } finally { pkgLoading.value = false; }
}

async function load() {
  if (!siteId.value) {
    denied.value = 'noSiteId';
    return;
  }
  loading.value = true;
  denied.value = '';
  try {
    const d = await adminApi(`/admin/sites/provision/${siteId.value}`);
    info.value = d;

    // ⛔ 掩码回填契约（2026-10-06 D先生拍板）：已配置的字段把服务端掩码值回填输入框，
    //   用户一眼能看到「有值且是哪个 key 的头尾」，而不是一片空白猜自己配没配过。
    //   提交时经 fresh() 剥离：值 == 掩码（含 •）→ 发空串，服务端按「沿用原值」处理，
    //   绝不会把掩码串当真值写库（服务端 dropMasked 二次兜底）。
    const a = group('mayixingqiu');
    // ⛔ 2026-10-09 修潜伏 bug：模板读 ants.configured/test_status/test_message/tested_at/key_masked/has_secret，
    //   但这里只回填过 apikey/api_secret —— 测试结果条永不渲染、「重新测试」按钮永久禁用（服务端字段一直都在）。
    Object.assign(ants, a);
    ants.apikey = a.key_masked ?? '';
    ants.api_secret = a.secret_masked ?? '';

    const m = group('wechat_mini');
    mini.appid = m.key_masked ?? ''; mini.mini_secret = m.secret_masked ?? '';

    const w = group('wechat_mp');
    mp.appid = w.key_masked ?? ''; mp.api_secret = w.secret_masked ?? '';

    const p = group('site_payment');
    pay.mch_id = p.mch_id_masked ?? ''; pay.mch_key = p.mch_key_masked ?? '';
    pay.serial_no = p.serial_no_masked ?? ''; pay.cert = p.cert_masked ?? '';
    pay.callback_url = p.callback_url ?? '';

    const c = group('kf');
    kf.corp_id = c.corp_id ?? ''; kf.kf_url = c.kf_url_masked ?? '';
    kf.active = c.status === 'active';
  } catch (e) {
    const msg = String(e?.message ?? '加载失败');
    if (msg.includes('负责人')) denied.value = 'notOwner';
    else if (msg.includes('站点不存在') || msg.includes('请求失败')) denied.value = 'noAccess';
    else ElMessage.error(msg);
  } finally {
    loading.value = false;
  }
}

function saved(msg) {
  ElMessage.success(msg);
  emit('done');
  return load();
}

async function saveAnts() {
  const apiKey = fresh(ants.apikey);
  // 掩码态 = 已配置（沿用原 key），只在「没有任何 key」时才拦
  if (!apiKey && !group('mayixingqiu').configured) { ElMessage.warning('apikey 必填'); return; }
  saving.value = true;
  try {
    const d = await adminApi(`/admin/sites/provision/${siteId.value}/mayixingqiu`, {
      method: 'PUT',
      body: JSON.stringify({ apikey: apiKey, api_secret: fresh(ants.api_secret) }),
    });
    if (d.test?.status === 'passed') {
      // site_activated：站点原本 pending，凭据通过后服务端已自动翻 active（C 端即刻可访问）
      ElMessage.success(d.site_activated ? `站点已开通并启用：${d.test.message}` : `已开通：${d.test.message}`);
      // ⛔ 先就地刷新向导内容（用户亲眼看到 passed + 掩码 key），再通知父级解锁侧栏。
      //   顺序反了的话父级会把状态切走/重挂，成功态根本来不及渲染。
      ants.apikey = ''; ants.api_secret = '';
      await load();
      emit('done');
    } else {
      await saved(`已保存，但连通测试失败：${d.test?.message ?? '未知错误'}`);
    }
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}

async function testAnts() {
  testing.value = true;
  try {
    const d = await adminApi(`/admin/sites/provision/${siteId.value}/mayixingqiu/test`, { method: 'POST' });
    if (d.test?.status === 'passed') {
      ElMessage.success(`连通正常：${d.test.message}`);
      emit('done');
    } else {
      ElMessage.warning(`连通失败：${d.test?.message ?? '未知错误'}`);
    }
    await load();
  } catch (e) { ElMessage.error(e.message); } finally { testing.value = false; }
}

async function saveMini() {
  const appid = fresh(mini.appid);
  if (!appid && !group('wechat_mini').configured) { ElMessage.warning('appid 必填'); return; }
  saving.value = true;
  try {
    await adminApi(`/admin/sites/provision/${siteId.value}/mini`, {
      method: 'PUT',
      body: JSON.stringify({ appid, mini_secret: fresh(mini.mini_secret) }),
    });
    mini.appid = ''; mini.mini_secret = '';
    await saved('小程序凭据已保存');
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}

async function saveMp() {
  const appid = fresh(mp.appid);
  if (!appid && !group('wechat_mp').configured) { ElMessage.warning('appid 必填'); return; }
  saving.value = true;
  try {
    await adminApi(`/admin/sites/provision/${siteId.value}/mp`, {
      method: 'PUT',
      body: JSON.stringify({ appid, api_secret: fresh(mp.api_secret) }),
    });
    mp.appid = ''; mp.api_secret = '';
    await saved('公众号凭据已保存');
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}

async function savePay() {
  saving.value = true;
  try {
    // ⛔ admin-52 设计稿本屏不含佣金费率/启用开关（那是「支付商户」菜单的日常维护项）：
    //   rate 不传 → 服务端沿用旧值或默认 0.2；status 恒 active（字段齐全由服务端强校验）
    await adminApi(`/admin/sites/provision/${siteId.value}/payment`, {
      method: 'PUT',
      body: JSON.stringify({
        mch_id: fresh(pay.mch_id),
        mch_key: fresh(pay.mch_key),
        serial_no: fresh(pay.serial_no),
        cert: fresh(pay.cert),
        status: 'active',
      }),
    });
    pay.mch_id = ''; pay.mch_key = ''; pay.cert = '';
    await saved('支付商户凭据已保存');
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}

async function copyCallback() {
  try {
    await navigator.clipboard.writeText(pay.callback_url);
    ElMessage.success('回调地址已复制，请到微信支付商户平台 → API 安全配置中填写');
  } catch { ElMessage.error('复制失败，请手动选择复制'); }
}

async function saveKf() {
  saving.value = true;
  try {
    await adminApi(`/admin/sites/provision/${siteId.value}/kf`, {
      method: 'PUT',
      body: JSON.stringify({
        corp_id: fresh(kf.corp_id),
        kf_url: fresh(kf.kf_url),
        status: kf.active ? 'active' : 'disabled',
      }),
    });
    kf.kf_url = '';
    await saved('客服配置已保存');
  } catch (e) { ElMessage.error(e.message); } finally { saving.value = false; }
}

watch(siteId, load);
onMounted(() => { load(); loadPkgMeta(); });
</script>

<style scoped>
.provision { display: flex; flex-direction: column; gap: 14px; }
.title { margin: 0; font-size: 22px; font-weight: 900; color: #3d2530; }
.subtitle { margin: 6px 0 0; font-size: 13px; color: #a08592; }
.head { display: flex; flex-direction: column; }

.state-box { border-radius: 14px; padding: 14px 18px; border: 1.5px solid; }
.state-box.ok { background: #eafaf1; border-color: #b6e8ce; color: #166c48; }
.state-box.no { background: #fff6e9; border-color: #f2d6a8; color: #8a4d00; }
.state-box.warn { background: #fdf6ec; border-color: #f2d6a8; color: #8a4d00; }
.state-row { display: flex; align-items: center; gap: 10px; }
.state-dot { width: 10px; height: 10px; border-radius: 999px; background: currentColor; }
.state-site { font-size: 12.5px; opacity: 0.8; }
.state-box p { margin: 8px 0 0; font-size: 12.5px; line-height: 1.6; }
.state-hint { opacity: 0.72; font-size: 11.5px !important; }
.status-alert { margin: 0; }

/* ── 编号纵列卡片（admin-52 设计稿布局）── */
.prov-list { display: flex; flex-direction: column; gap: 12px; }
.prov-card {
  background: #fff; border: 1.5px solid #f0dbe4; border-radius: 14px;
  padding: 16px 18px 14px; display: flex; flex-direction: column;
}
.pc-head { display: flex; align-items: center; gap: 9px; margin-bottom: 6px; }
.pc-no {
  width: 22px; height: 22px; border-radius: 999px; background: #e8336d; color: #fff;
  font-size: 12.5px; font-weight: 900; display: inline-flex; align-items: center; justify-content: center;
  flex: none;
}
.pc-title { font-size: 15px; font-weight: 900; color: #3d2530; }
.badge {
  background: #fdf0f5; color: #a31245; font-size: 10.5px; font-weight: 800;
  border-radius: 5px; padding: 2px 7px; flex: none;
}
.badge.req { background: #e8336d; color: #fff; }
.badge.warn2 { background: #ffe9c8; color: #8a4d00; }
.pc-status { margin-left: auto; font-size: 12px; font-weight: 800; }
.pc-status.ok { color: #1f9d61; }
.pc-status.no { color: #c2937a; }

/* ── 开通检查清单（admin-52 画布 2026-10-09 重导版）── */
.overview { border: 1.5px dashed #e8c9d6; border-radius: 14px; padding: 12px 16px; background: #fffafc; }
.ov-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.ov-title { font-size: 13px; font-weight: 900; color: #a31245; }
.ov-note { font-size: 11.5px; color: #a08592; }
.ov-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.ov-cell {
  display: flex; flex-direction: column; gap: 4px; background: #fff;
  border: 1px solid #f0dbe4; border-radius: 10px; padding: 9px 11px;
}
.ov-name { font-size: 12px; font-weight: 700; color: #5c3a4a; }
.ov-state { font-size: 11.5px; font-weight: 800; line-height: 1.5; }
.ov-state.ok { color: #1f9d61; }
.ov-state.no { color: #b9a3ad; }
.ov-state.warn { color: #c2711d; }
.ov-state.fail { color: #c02626; }
@media (max-width: 900px) { .ov-grid { grid-template-columns: repeat(2, 1fr); } }

/* ── 小程序安装包成功条（admin-52 设计稿：汇总卡底部全宽，色值取自画布采样）── */
.pkg-bar {
  margin-top: 10px; display: flex; align-items: center; gap: 12px;
  background: #f2f9f4; border-radius: 12px; padding: 13px 16px;
}
.pkg-check {
  width: 22px; height: 22px; border-radius: 999px; background: #3fa45c; color: #fff;
  font-size: 13px; font-weight: 900; display: inline-flex; align-items: center; justify-content: center;
  flex: none;
}
.pkg-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.pkg-text b { font-size: 13.5px; color: #262626; }
.pkg-text span { font-size: 12px; color: #8c8c8c; line-height: 1.55; }
.pkg-btn {
  margin-left: auto; flex: none; border: none; color: #2c2c2f; font-weight: 800;
  background: #ffaa1d; border-radius: 999px; padding: 10px 22px;
}
.pkg-btn:hover, .pkg-btn:focus { background: #ffb63d; color: #2c2c2f; }

.readonly-input :deep(input) { color: #8a6b75; font-family: Consolas, monospace; font-size: 12px; }

.card-body { padding: 4px 4px 10px; }
.meta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.meta-k { background: #fff6e9; color: #a08592; font-size: 11px; font-weight: 800; border-radius: 5px; padding: 2px 7px; }
.meta-v { color: #5c3a4a; font-size: 12px; font-family: Consolas, monospace; }
.ok-text { color: #1f9d61; font-family: inherit; }
.no-text { color: #a08592; font-family: inherit; }
.desc { margin: 0 0 14px; font-size: 12.5px; color: #8a6b75; line-height: 1.65; }
.desc.sub { color: #a08592; }
.desc b { color: #a31245; }

.form { max-width: 640px; }
.test-result {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  border-radius: 10px; padding: 9px 13px; margin-bottom: 14px; font-size: 12.5px;
}
.test-result.passed { background: #eafaf1; color: #166c48; }
.test-result.failed { background: #fdecec; color: #a82020; }
.test-time { opacity: 0.7; font-size: 11.5px; }

.btn-row { display: flex; align-items: center; gap: 10px; }
.btn-note { font-size: 11.5px; color: #a08592; }
</style>