<template>
  <!-- admin-50 系统设置（画布 1:1）：左锚点子导航 + 五段（供应商凭据/企业微信客服/角色权限 RBAC/管理员账号/操作日志）。
       平台级·仅超管（服务端 requirePlatform 强制）。凭据只回掩码；审计只记成功写操作。 -->
  <div class="settings-page">
    <div class="head-row">
      <div class="head-left">
        <h2 class="title">系统设置</h2>
        <span class="scope-tag">平台级 · 仅超管</span>
      </div>
      <span class="head-sub">供应商凭据 / 企业微信客服 / 角色权限 / 管理员账号 / 操作日志</span>
    </div>

    <div class="body-grid">
      <!-- 左锚点子导航 -->
      <aside class="subnav">
        <button
          v-for="s in sections" :key="s.key"
          class="subnav-item" :class="{ active: activeSection === s.key }"
          @click="scrollTo(s.key)"
        >{{ s.label }}</button>
      </aside>

      <div class="content">
        <!-- ① 供应商凭据 -->
        <section :ref="el => setRef('cred')" class="anchor">
          <div class="sec-tabs-row">
            <div class="site-tabs">
              <button
                v-for="s in sites" :key="s.site_id"
                class="site-tab" :class="{ active: curSite?.site_id === s.site_id }"
                @click="curSiteId = s.site_id"
              >
                {{ s.name }}<template v-if="s === curSite">（当前）</template>
              </button>
              <button class="site-tab ghost" @click="onNewSite">＋ 新站点…</button>
            </div>
            <span class="sec-note">凭据跟 site_id 走存 provider_config，不落平台 env（决策 #25①）</span>
          </div>

          <div v-for="p in providerCards" :key="p.key" class="provider-card" :class="{ un: !p.cfg.configured }">
            <div class="pc-icon" :style="{ background: p.iconBg }">
              <el-icon :size="20" color="#fff"><component :is="p.icon" /></el-icon>
            </div>
            <div class="pc-main">
              <div class="pc-head">
                <span class="pc-name">{{ p.name }}</span>
                <span class="pc-tag" :class="p.cfg.configured ? 'ok' : 'miss'">{{ p.cfg.configured ? '已配置' : '未配置' }}</span>
                <span class="pc-mono">provider={{ p.key }}</span>
              </div>
              <div class="pc-rows">
                <div v-for="f in p.rows" :key="f.label" class="pc-row">
                  <span class="pc-label">{{ f.label }}</span>
                  <span class="pc-value" :class="{ mono: f.mono, dim: f.dim }">{{ f.value }}</span>
                </div>
                <div class="pc-row">
                  <span class="pc-label">更新于</span>
                  <span class="pc-value dim">{{ p.cfg.updated_at ? fmtTime(p.cfg.updated_at) : '—' }} · {{ p.usage }}</span>
                </div>
              </div>
            </div>
            <div class="pc-ops">
              <button class="mini-btn primary" @click="onEditCred(p)">{{ p.cfg.configured ? '编辑凭据' : '去配置' }}</button>
              <button v-if="p.cfg.configured" class="mini-btn ghost" @click="onToggleCred(p)">
                {{ p.cfg.status === 'active' ? '停用' : '启用' }}
              </button>
            </div>
          </div>
        </section>

        <!-- 企业微信客服（迁移 040 · D先生 2026-10-05）：corpId + 客服链接跟 site_id 走 -->
        <section :ref="el => setRef('kf')" class="anchor">
          <div class="sec-head">
            <h3 class="sec-title"><i class="sec-idx">2</i> 企业微信客服</h3>
            <span class="sec-note">site.kf_corp_id / site.kf_url —— <b>跟站点走</b>，多租户各接各的企业</span>
          </div>

          <div class="sec-tabs-row">
            <div class="site-tabs">
              <button
                v-for="s in sites" :key="s.site_id"
                class="site-tab" :class="{ active: curSite?.site_id === s.site_id }"
                @click="curSiteId = s.site_id"
              >{{ s.name }}</button>
            </div>
            <span
              class="pc-tag" :class="kfForm.status === 'active' ? 'ok' : 'miss'"
              style="margin-left: auto"
            >{{ kfForm.status === 'active' ? '已开通' : '未开通' }}</span>
          </div>

          <div class="card kf-card">
            <div class="kf-grid">
              <div class="kf-field">
                <label class="kf-label">
                  企业ID（corpId）<i>*</i>
                  <span class="kf-req">小程序端必需</span>
                </label>
                <el-input
                  v-model="kfForm.corp_id" placeholder="ww 开头的一串字符，如 ww1234567890abcdef"
                  clearable style="width: 100%"
                />
                <p class="kf-hint">
                  企业微信管理后台 →「我的企业」→「企业信息」→ 复制<b>企业ID</b>。
                  该值前后<b>不能有空格</b>（微信会报「ID 不一致」，官方已知坑，本页已自动去空格）。
                </p>
              </div>

              <div class="kf-field">
                <label class="kf-label">
                  客服链接（kf_url）<i>*</i>
                  <span class="kf-req">两端都要</span>
                </label>
                <el-input
                  v-model="kfForm.kf_url" placeholder="https://work.weixin.qq.com/kfid/kfc_..."
                  clearable style="width: 100%"
                />
                <p class="kf-hint">
                  企业微信 →「应用管理」→「应用」→「微信客服」→ 点进客服账号 → 复制<b>客服链接</b>。
                  仅允许 <code>work.weixin.qq.com</code> 官方域名（安全边界：端上会直接跳它）。
                </p>
              </div>

              <div class="kf-field kf-field-status">
                <label class="kf-label">开通状态</label>
                <el-switch
                  v-model="kfForm.status" active-value="active" inactive-value="disabled"
                  active-text="已开通" inactive-text="未开通"
                />
                <p class="kf-hint" :class="{ 'kf-hint-warn': !kfFormReady }">
                  <template v-if="!kfFormReady">企业ID 与客服链接都填了才能开通（缺任一端上必然呼不起）。</template>
                  <template v-else>开通后小程序「我的」宫格与商品详情页底栏即可唤起企业微信客服。</template>
                </p>
              </div>
            </div>

            <div class="kf-ops">
              <el-button type="primary" :loading="kfSaving" @click="onSaveKf">保 存 配 置</el-button>
              <el-button :loading="kfLoading" @click="onTestKf">刷新</el-button>
              <span v-if="kfForm.kf_url" class="kf-mono" title="当前已保存的链接（掩码）">{{ kfMasked }}</span>
            </div>
          </div>

          <!-- 文字接入说明（D先生 2026-10-05 要求） -->
          <div class="card kf-guide">
            <h4 class="guide-title">接入说明（照着做，五步）</h4>
            <ol class="guide-list">
              <li>
                <b>企业微信侧开通并认证</b>：登录 work.weixin.qq.com →「我的企业」完成<b>企业验证</b>
                （未认证的无法绑定小程序；小型企业认证约 300 元 / 5 个工作日）。
              </li>
              <li>
                <b>创建客服账号</b>：「应用管理」→「应用」→「微信客服」→ 添加客服账号并配置接待人员。
              </li>
              <li>
                <b>拿到两个值填到本页</b>：企业ID（我的企业 → 企业信息）+ 客服链接（客服账号详情页）。
              </li>
              <li>
                <b>微信公众平台绑定企业ID</b>（<b>这一步平台做不了，必须人工</b>）：
                小程序后台 →「功能」→「客服」→「微信客服」→ 填入企业ID 完成绑定。
                <span class="guide-warn">未绑这一步，小程序端点了会直接失败（降级为复制客服链接）。</span>
                要求：非个人主体小程序，且企业ID 与小程序属同一主体。
              </li>
              <li>
                <b>开启客服账号的「小程序内接入」</b>：客服账号详情页把接入场景选为
                「在微信内其他场景接入」，否则拿到的链接无法在小程序内唤起。
              </li>
            </ol>

            <h4 class="guide-title">两端行为差异（重要，别当成 bug）</h4>
            <div class="guide-table">
              <div class="gt-row gt-head">
                <span>端</span><span>调用方式</span><span>用户看到</span>
              </div>
              <div class="gt-row">
                <span class="gt-end">小程序</span>
                <span><code>wx.openCustomerServiceChat</code>（需基础库 ≥ 2.19.0）</span>
                <span>微信原生客服浮层，不离开小程序</span>
              </div>
              <div class="gt-row">
                <span class="gt-end">H5</span>
                <span>该 API 在 H5 <b>不存在</b>，只能整页跳转到客服链接</span>
                <span>会离开本站，在微信/浏览器里打开会话</span>
              </div>
            </div>

            <h4 class="guide-title">常见故障</h4>
            <ul class="guide-list guide-list-plain">
              <li><b>「ID 不一致」</b> → 复制企业ID 时带了空格/换行。本页保存时会自动去空格，但若你从别处直接贴到公众平台仍需手动清理。</li>
              <li><b>点了没反应</b> → 优先查：① 公众平台是否已绑定企业ID ② 本页状态是否为「已开通」③ 客服链接是否已失效（客服账号删除后链接立即失效）。</li>
              <li><b>端上显示「客服暂未开通」</b> → 本页该站点状态为「未开通」，或企业ID/客服链接有缺项（服务端会拒绝只填一半就开通）。</li>
              <li><b>H5 跳转到空白页</b> → 链接是微信内专属协议，在外部浏览器打开会被拒。属正常，微信内打开即好。</li>
            </ul>
          </div>
        </section>

        <!-- ③ 角色权限（RBAC） -->
        <section :ref="el => setRef('rbac')" class="anchor">
          <div class="sec-head">
            <h3 class="sec-title"><i class="sec-idx">3</i> 角色权限（RBAC）</h3>
            <span class="sec-note">role 表 · permissions（菜单/动作）· 站点级成员绑定在「站点管理」屏维护</span>
            <button class="mini-btn ghost ml-auto" @click="onNewRole">＋ 新建角色</button>
          </div>
          <div class="role-cards">
            <div v-for="r in roles" :key="r.role_code" class="role-card" :class="{ hot: r.role_code === 'platform_admin' }">
              <div class="rc-head">
                <span class="rc-name">{{ r.name }}</span>
                <span class="rc-builtin">内置</span>
              </div>
              <p class="rc-desc">{{ roleDesc[r.role_code] ?? '—' }}</p>
            </div>
          </div>
          <div class="card matrix-card">
            <el-table :data="matrix" style="width: 100%" :header-cell-style="headerStyle">
              <el-table-column prop="module" label="菜单模块" min-width="280" />
              <el-table-column v-for="r in roles" :key="r.role_code" :label="r.name" align="center" width="120">
                <template #default="{ row }">
                  <span class="perm" :class="row[r.role_code] === '读写' ? 'rw' : row[r.role_code] === '只读' ? 'ro' : 'na'">{{ row[r.role_code] }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>

        <!-- ③ 管理员账号 -->
        <section :ref="el => setRef('admins')" class="anchor">
          <div class="sec-head">
            <h3 class="sec-title"><i class="sec-idx">4</i> 管理员账号</h3>
            <span class="sec-note">admin_user 平台级账号；站点绑定（admin_user_site）在「站点管理」屏</span>
            <button class="mini-btn primary ml-auto" @click="onNewAdmin">＋ 新建账号</button>
          </div>
          <div class="card">
            <el-table :data="admins" v-loading="loadingAdmins" style="width: 100%" :header-cell-style="headerStyle">
              <el-table-column prop="username" label="用户名" min-width="140" />
              <el-table-column label="角色" width="130">
                <template #default="{ row }">
                  <span class="role-tag" :class="row.role === 'platform_admin' ? 'rt-platform' : row.role === 'readonly_ops' ? 'rt-ro' : 'rt-site'">
                    {{ roleName(row.role) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="绑定站点" min-width="180">
                <template #default="{ row }">
                  <span v-if="row.role === 'platform_admin'" class="dim">全部站点（平台级）</span>
                  <span v-else-if="!row.sites?.length" class="dim">未绑定</span>
                  <span v-else>{{ row.sites.join(' / ') }}</span>
                </template>
              </el-table-column>
              <el-table-column label="状态" width="90">
                <template #default="{ row }">
                  <span class="st" :class="row.status === 'active' ? 'st-on' : 'st-off'">
                    <i class="st-dot" />{{ row.status === 'active' ? '正常' : '停用' }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="创建时间" width="110">
                <template #default="{ row }">{{ String(row.created_at).slice(0, 10) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="90" align="right">
                <template #default="{ row }">
                  <el-link type="primary" :underline="false" @click="onEditAdmin(row)">编辑</el-link>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>

        <!-- ④ 操作日志 -->
        <section :ref="el => setRef('audit')" class="anchor">
          <div class="sec-head">
            <h3 class="sec-title"><i class="sec-idx">5</i> 操作日志</h3>
            <span class="sec-note">admin_audit_log · 记录全后台写操作（仅成功）</span>
            <button class="mini-btn ghost ml-auto" @click="onExportCsv">导出 CSV</button>
          </div>
          <div class="card">
            <div class="filters">
              <el-select v-model="filter.operator" placeholder="操作人：全部" clearable style="width: 140px" @change="loadAudit">
                <el-option v-for="a in admins" :key="a.username" :label="a.username" :value="a.username" />
              </el-select>
              <el-select v-model="filter.module" placeholder="模块：全部" clearable style="width: 140px" @change="loadAudit">
                <el-option v-for="m in auditModules" :key="m" :label="moduleName(m)" :value="m" />
              </el-select>
              <el-select v-model="filter.days" style="width: 120px" @change="loadAudit">
                <el-option :value="7" label="近 7 天" />
                <el-option :value="30" label="近 30 天" />
                <el-option :value="0" label="全部时间" />
              </el-select>
            </div>
            <el-table :data="auditItems" v-loading="loadingAudit" style="width: 100%" :header-cell-style="headerStyle">
              <el-table-column label="时间" width="150">
                <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
              </el-table-column>
              <el-table-column prop="username" label="操作人" width="100" />
              <el-table-column label="站点上下文" width="120">
                <template #default="{ row }">{{ row.site_name ?? '平台级' }}</template>
              </el-table-column>
              <el-table-column label="模块" width="100">
                <template #default="{ row }">{{ moduleName(row.target_type) }}</template>
              </el-table-column>
              <el-table-column label="动作 / 对象" min-width="240">
                <template #default="{ row }">
                  {{ actionLabel(row.action) }}<template v-if="row.target_id"> · {{ row.target_id }}</template>
                </template>
              </el-table-column>
              <el-table-column label="结果" width="80">
                <template #default><span class="perm rw">成功</span></template>
              </el-table-column>
              <el-table-column prop="ip" label="IP" width="130" />
            </el-table>
          </div>
        </section>
      </div>
    </div>

    <!-- 凭据编辑弹窗 -->
    <el-dialog v-model="cred.visible" :title="`配置凭据 · ${cred.site_name} · ${cred.providerLabel}`" width="480px" destroy-on-close>
      <el-form label-width="90px" label-position="left">
        <el-form-item :label="cred.provider === 'wechat_mini' ? 'AppID' : 'AppID/Key'" :required="!cred.configured">
          <el-input v-model="cred.apikey" :placeholder="cred.configured ? `已设置 ${cred.key_masked} · 留空=保留` : '输入完整 Key/AppID'" />
        </el-form-item>
        <el-form-item label="Secret">
          <el-input
            v-model="cred.api_secret"
            type="password"
            show-password
            :placeholder="cred.has_secret
              ? '已设置 · 留空=保留原值'
              : (cred.provider === 'mayixingqiu'
                  ? '点餐/电影票/权益兑换三类订单接口的 md5 签名密钥（推广中心 → 开发管理 → apikey 页面获取）'
                  : 'AppSecret')"
          />
          <div v-if="cred.provider === 'mayixingqiu' && !cred.has_secret" class="hint-warn">
            未配置 api_secret：平台活动（pforder）不受影响，但<strong>点餐 / 电影票 / 权益兑换</strong>三类订单会因缺少签名而同步不进来。
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="cred.status" active-value="active" inactive-value="disabled" active-text="启用" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cred.visible = false">取消</el-button>
        <el-button type="primary" :loading="cred.saving" @click="onSaveCred">保存</el-button>
      </template>
    </el-dialog>

    <!-- 账号新建/编辑弹窗 -->
    <el-dialog v-model="adminDlg.visible" :title="adminDlg.editing ? `编辑账号 · ${adminDlg.username}` : '新建账号'" width="480px" destroy-on-close>
      <el-form label-width="90px" label-position="left">
        <el-form-item label="用户名" required>
          <el-input v-model="adminDlg.username" :disabled="adminDlg.editing" placeholder="3~32 位字母数字-_" />
        </el-form-item>
        <el-form-item :label="adminDlg.editing ? '重置密码' : '初始密码'" :required="!adminDlg.editing">
          <el-input v-model="adminDlg.password" type="password" show-password :placeholder="adminDlg.editing ? '留空=不修改' : '至少 8 位，首次登录强制改密'" />
        </el-form-item>
        <el-form-item label="角色" required>
          <el-select v-model="adminDlg.role" style="width: 100%" :disabled="adminDlg.editing && adminDlg.admin_id === selfId">
            <el-option v-for="r in roles" :key="r.role_code" :label="r.name" :value="r.role_code" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="adminDlg.role !== 'platform_admin'" label="绑定站点">
          <el-select v-model="adminDlg.site_ids" multiple style="width: 100%" placeholder="可暂不绑定，之后在「站点管理」里加为成员">
            <el-option v-for="s in sites" :key="s.site_id" :label="s.name" :value="s.site_id" />
          </el-select>
          <div class="form-hint">可先建账号、再建站点（建站不必先有人）。账号未绑定任何站点时登录会提示「尚未分配站点」，请到「站点管理」把该账号加为成员并「设为负责人」。</div>
        </el-form-item>
        <el-form-item v-if="adminDlg.editing" label="状态">
          <el-switch v-model="adminDlg.status" active-value="active" inactive-value="disabled" :disabled="adminDlg.admin_id === selfId" active-text="正常" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adminDlg.visible = false">取消</el-button>
        <el-button type="primary" :loading="adminDlg.saving" @click="onSaveAdmin">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Connection, Iphone, ChatDotRound } from '@element-plus/icons-vue';

const adminInfo = JSON.parse(localStorage.getItem('fyt_admin_info') ?? 'null');
const selfId = String(adminInfo?.adminId ?? '');

const sections = [
  { key: 'cred', label: '供应商凭据' },
  { key: 'kf', label: '企业微信客服' },
  { key: 'rbac', label: '角色权限' },
  { key: 'admins', label: '管理员账号' },
  { key: 'audit', label: '操作日志' },
];
const activeSection = ref('cred');
const sectionRefs = {};
const setRef = (key) => (el) => { if (el) sectionRefs[key] = el; };
const scrollTo = (key) => {
  activeSection.value = key;
  sectionRefs[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};
const onScroll = () => {
  for (const s of sections) {
    const el = sectionRefs[s.key];
    if (el && el.getBoundingClientRect().top < 140) activeSection.value = s.key;
  }
};
onMounted(() => window.addEventListener('scroll', onScroll, true));
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll, true));

const headerStyle = { background: '#fff6e9', color: '#5c3a4a', fontWeight: 700 };
const loadingAdmins = ref(false);
const loadingAudit = ref(false);
const sites = ref([]);
const curSiteId = ref('');
const curSite = computed(() => sites.value.find((s) => s.site_id === curSiteId.value) ?? sites.value[0]);
const roles = ref([]);
const admins = ref([]);
const auditItems = ref([]);
const auditModules = ref(['auth', 'provider', 'payment', 'tabbar', 'schema', 'admin']);
const filter = reactive({ operator: '', module: '', days: 7 });

const roleDesc = {
  platform_admin: '全部站点 + 全局聚合；写操作须切入具体站点',
  site_admin: '仅授权站点：装修 / 商品 / 订单 / 核销 / 提现和审批 / 营销 / AI 装修',
  readonly_ops: '仅授权站点数据只读；一切写操作不可见',
};
const matrix = [
  { module: '数据看板', platform_admin: '读写', site_admin: '读写', readonly_ops: '只读' },
  { module: '商品与品牌 / 订单 / 分销', platform_admin: '读写', site_admin: '读写', readonly_ops: '只读' },
  { module: 'AI装修 / 营销中心 / 积分兑换 / 支付商户', platform_admin: '读写', site_admin: '读写', readonly_ops: '只读' },
  { module: '站点管理（平台级）', platform_admin: '读写', site_admin: '—', readonly_ops: '—' },
  { module: '系统设置（平台级）', platform_admin: '读写', site_admin: '—', readonly_ops: '—' },
];

const providerMeta = [
  { key: 'mayixingqiu', name: '蚂蚁星球（CPS 供给）', label: '蚂蚁星球', icon: Connection, iconBg: '#e8336d', usage: '用于 CPS 商品代理 / 转链（蚂蚁星球仅 apikey）' },
  { key: 'wechat_mini', name: '微信小程序', label: '微信小程序', icon: Iphone, iconBg: '#1f9d61', usage: '用于 code2session / stable_token' },
  { key: 'wechat_mp', name: '微信公众号（认证服务号）', label: '微信公众号', icon: ChatDotRound, iconBg: '#d98b00', usage: '承载 H5 静默登录（snsapi_base）等能力；未配置时接口报 PROVIDER_NOT_CONFIGURED' },
];
const EMPTY_CFG = { configured: false, key_masked: '', appid_masked: '', has_secret: false, status: '', updated_at: null };

function rowsOf(p) {
  const c = p.cfg;
  if (!c.configured) return [];
  if (p.key === 'mayixingqiu') {
    // ⚠️ 蚂蚁星球的api_secret **真实有用**（2026-10-04 修正）：
    //   点餐(dcorder)/影票(movieorder)/权益兑换(recharge-orderlist) 三类订单接口
    //   全部要求 md5 签名，密钥即此字段。之前这里硬编码「未使用」是错的，
    //   导致没人知道要去配，点餐/影票/权益这三类订单一直同步不进来。
    return [
      { label: 'apikey', value: c.key_masked, mono: true },
      {
        label: 'api_secret',
        value: c.has_secret ? '••••••（已设置 · 签名可用）' : '未设置 · 点餐/影票/权益兑换需签名',
        dim: !c.has_secret,
      },
    ];
  }
  return [
    { label: p.key === 'wechat_mini' ? 'appid' : 'AppID', value: (p.key === 'wechat_mini' && c.appid_masked) || c.key_masked, mono: true },
    { label: 'secret', value: c.has_secret ? '••••••（默认脱敏）' : '未设置', dim: !c.has_secret },
  ];
}

const providerCards = computed(() => {
  const cfgs = curSite.value?.providers ?? {};
  return providerMeta.map((m) => {
    const full = { ...m, cfg: cfgs[m.key] ?? EMPTY_CFG };
    return { ...full, rows: rowsOf(full) };
  });
});

async function api(path, opts = {}) {
  const headers = { Authorization: 'Bearer ' + localStorage.getItem('fyt_admin_token'), ...(opts.headers ?? {}) };
  const r = await fetch('/api' + path, { ...opts, headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.message || '请求失败');
  return j.data;
}

const fmtTime = (t) => (t ? String(t).slice(0, 16).replace('T', ' ') : '—');
const roleName = (code) => roles.value.find((r) => r.role_code === code)?.name ?? code;
const moduleName = (m) => ({ auth: '认证', provider: '系统设置', payment: '支付商户', tabbar: '底部菜单', schema: '页面装修', admin: '管理员账号' }[m] ?? (m || '—'));
const actionLabel = (a) => ({
  'admin.login': '登录管理台', 'admin.password_change': '修改密码', 'admin.create': '新建账号', 'admin.update': '编辑账号', 'admin.reset_password': '重置密码',
  'provider.save': '更新供应商凭据', 'payment.create': '新建支付凭据', 'payment.update': '更新支付凭据', 'payment.toggle': '切换支付状态',
  'tabbar.save': '保存底部菜单', 'schema.publish': '发布页面',
}[a] ?? a);

async function load() {
  loadingAdmins.value = true;
  try {
    const [ov, rl, ad] = await Promise.all([api('/admin/settings/overview'), api('/admin/settings/roles'), api('/admin/settings/admins')]);
    sites.value = ov.sites;
    if (!curSiteId.value && ov.sites.length) curSiteId.value = ov.sites[0].site_id;
    roles.value = rl.roles;
    admins.value = ad.admins;
    await Promise.all([loadAudit(), loadKf()]);
  } catch (e) {
    ElMessage.error(e.message ?? '加载失败');
  } finally {
    loadingAdmins.value = false;
  }
}

async function loadAudit() {
  loadingAudit.value = true;
  try {
    const q = new URLSearchParams({ days: String(filter.days), limit: '200' });
    if (filter.operator) q.set('operator', filter.operator);
    if (filter.module) q.set('module', filter.module);
    const d = await api('/admin/settings/audit?' + q.toString());
    auditItems.value = d.items;
  } catch (e) {
    ElMessage.error(e.message ?? '日志加载失败');
  } finally {
    loadingAudit.value = false;
  }
}

function onNewSite() {
  ElMessage.info('新建站点在「站点管理」屏进行');
}
function onNewRole() {
  ElMessage.info('当前为内置角色阶段，自定义角色暂未开放');
}

// —— 凭据编辑 ——
const cred = reactive({
  visible: false, saving: false, configured: false,
  site_id: '', site_code: '', site_name: '', provider: '', providerLabel: '', key_masked: '',
  apikey: '', api_secret: '', status: 'active', has_secret: false,
});

function onEditCred(p) {
  cred.site_id = curSite.value.site_id;
  cred.site_code = curSite.value.code;
  cred.site_name = curSite.value.name;
  cred.provider = p.key;
  cred.providerLabel = p.label;
  cred.configured = p.cfg.configured;
  cred.key_masked = p.cfg.key_masked ?? '';
  cred.has_secret = !!p.cfg.has_secret;
  cred.apikey = '';
  cred.api_secret = '';
  cred.status = p.cfg.configured ? (p.cfg.status || 'active') : 'active';
  cred.visible = true;
}

async function onSaveCred() {
  if (!cred.configured && !cred.apikey.trim()) { ElMessage.warning('AppID/Key 必填（该站点尚未配置）'); return; }
  // 蚂蚁星球 apikey 可先只填 apikey（pforder 免签可用）；
  // 但 api_secret 决定点餐/影票/权益兑换三类能否同步，未配置时明确提示而不是静默放过
  if (cred.provider === 'mayixingqiu' && !cred.has_secret && !cred.api_secret.trim()) {
    ElMessage.warning('建议配置 api_secret：缺失将导致点餐 / 电影票 / 权益兑换三类订单无法同步');
  }
  cred.saving = true;
  try {
    const body = { site_id: cred.site_id, provider: cred.provider, apikey: cred.apikey.trim(), status: cred.status };
    if (cred.api_secret.trim()) body.api_secret = cred.api_secret.trim();
    await api('/site/provider', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    ElMessage.success('凭据已保存并立即生效（缓存已失效）');
    cred.visible = false;
    load();
  } catch (e) {
    ElMessage.error(e.message ?? '保存失败');
  } finally {
    cred.saving = false;
  }
}

async function onToggleCred(p) {
  const next = p.cfg.status === 'active' ? 'disabled' : 'active';
  const action = next === 'disabled' ? '停用' : '启用';
  try {
    await ElMessageBox.confirm(`确认${action}「${curSite.value.name}」的 ${p.label} 凭据？`, `${action}凭据`, { type: 'warning' });
  } catch { return; }
  try {
    await api('/site/provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: curSite.value.site_id, provider: p.key, apikey: '', status: next }),
    });
    ElMessage.success(`已${action}`);
    load();
  } catch (e) {
    ElMessage.error(e.message ?? `${action}失败`);
  }
}

// —— 企业微信客服（迁移 040）——
const kfForm = reactive({ site_id: '', corp_id: '', kf_url: '', status: 'disabled' });
const kfLoading = ref(false);
const kfSaving = ref(false);
const kfMasked = ref('');

/** 两项都填了才允许开通（与服务端 KF_INCOMPLETE 同口径，前端先拦一道） */
const kfFormReady = computed(() => {
  const c = String(kfForm.corp_id ?? '').trim().replace(/\s/g, '');
  const u = String(kfForm.kf_url ?? '').trim();
  return /^ww[0-9a-zA-Z]{10,32}$/.test(c) && u.length > 0;
});

async function loadKf() {
  const siteId = curSiteId.value;
  if (!siteId) return;
  kfLoading.value = true;
  try {
    const d = await api(`/admin/settings/kf?site_id=${encodeURIComponent(siteId)}`);
    kfForm.site_id = d.site_id;
    kfForm.corp_id = d.corp_id ?? '';
    kfForm.kf_url = d.kf_url ?? '';
    kfForm.status = d.status ?? 'disabled';
    kfMasked.value = d.kf_url_masked ?? '';
  } catch (e) {
    ElMessage.error(e.message ?? '客服配置加载失败');
  } finally {
    kfLoading.value = false;
  }
}

function onTestKf() { loadKf(); }

async function onSaveKf() {
  if (!kfForm.site_id) { ElMessage.warning('请先选择站点'); return; }
  if (kfForm.status === 'active' && !kfFormReady.value) {
    ElMessage.warning('开通前须填齐：企业ID（ww 开头）与客服链接（work.weixin.qq.com 官方域名）');
    return;
  }
  kfSaving.value = true;
  try {
    const body = {
      site_id: kfForm.site_id,
      corp_id: String(kfForm.corp_id ?? '').trim().replace(/\s/g, ''),
      kf_url: String(kfForm.kf_url ?? '').trim(),
      status: kfForm.status,
    };
    const d = await api('/admin/settings/kf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    kfForm.status = d.kf_status;
    kfMasked.value = d.kf_url_masked ?? '';
    ElMessage.success(d.kf_status === 'active' ? '已开通，端上即刻生效' : '已保存（未开通）');
  } catch (e) {
    ElMessage.error(e.message ?? '保存失败');
  } finally {
    kfSaving.value = false;
  }
}

// —— 账号编辑 ——
const adminDlg = reactive({
  visible: false, saving: false, editing: false,
  admin_id: '', username: '', password: '', role: 'site_admin', site_ids: [], status: 'active',
});

function onNewAdmin() {
  adminDlg.editing = false;
  adminDlg.admin_id = '';
  adminDlg.username = '';
  adminDlg.password = '';
  adminDlg.role = 'site_admin';
  adminDlg.site_ids = [];
  adminDlg.status = 'active';
  adminDlg.visible = true;
}

function onEditAdmin(row) {
  adminDlg.editing = true;
  adminDlg.admin_id = row.admin_id;
  adminDlg.username = row.username;
  adminDlg.password = '';
  adminDlg.role = row.role;
  adminDlg.site_ids = sites.value.filter((s) => row.sites?.includes(s.name)).map((s) => s.site_id);
  adminDlg.status = row.status;
  adminDlg.visible = true;
}

async function onSaveAdmin() {
  adminDlg.saving = true;
  try {
    if (adminDlg.editing) {
      const body = { role: adminDlg.role, status: adminDlg.status, site_ids: adminDlg.role === 'platform_admin' ? [] : adminDlg.site_ids };
      if (adminDlg.password) body.password = adminDlg.password;
      await api(`/admin/settings/admins/${adminDlg.admin_id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      ElMessage.success('账号已更新');
    } else {
      await api('/admin/settings/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminDlg.username, password: adminDlg.password, role: adminDlg.role, site_ids: adminDlg.role === 'platform_admin' ? [] : adminDlg.site_ids }),
      });
      ElMessage.success('账号已创建，首次登录须改密');
    }
    adminDlg.visible = false;
    load();
  } catch (e) {
    ElMessage.error(e.message ?? '保存失败');
  } finally {
    adminDlg.saving = false;
  }
}

function onExportCsv() {
  const head = '时间,操作人,站点上下文,模块,动作,对象,结果,IP\n';
  const lines = auditItems.value.map((r) => [
    fmtTime(r.created_at), r.username ?? '', r.site_name ?? '平台级', moduleName(r.target_type),
    actionLabel(r.action), r.target_id ?? '', '成功', r.ip ?? '',
  ].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','));
  const blob = new Blob(['\ufeff' + head + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `audit-log-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 切站点：客服配置必须跟着换（跟 site_id 走，切了站点还是上一家的值＝数据串站）
watch(curSiteId, () => { loadKf(); });

onMounted(load);
</script>

<style scoped>
.settings-page { display: flex; flex-direction: column; gap: 14px; }

.head-row { display: flex; align-items: center; }
.head-left { display: flex; align-items: center; gap: 10px; }
.title { margin: 0; font-size: 22px; font-weight: 900; color: #3d2530; }
.scope-tag {
  background: #e8336d; color: #fff; font-size: 11.5px; font-weight: 800;
  border-radius: 999px; padding: 3px 10px;
}
.head-sub { margin-left: auto; font-size: 12.5px; color: #a08592; }

.body-grid { display: flex; gap: 18px; align-items: flex-start; }
.subnav {
  width: 150px; flex-shrink: 0; position: sticky; top: 12px;
  display: flex; flex-direction: column; gap: 8px;
  background: #fff; border: 1.5px solid #f0dfc8; border-radius: 14px; padding: 10px;
}
.subnav-item {
  border: none; background: transparent; cursor: pointer; text-align: left;
  color: #8a6b75; font-size: 13.5px; font-weight: 700;
  border-radius: 10px; padding: 11px 14px;
}
.subnav-item:hover { background: #fff6e9; }
.subnav-item.active { background: #e8336d; color: #fff; }

.content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 26px; }
.anchor { scroll-margin-top: 76px; }

.sec-tabs-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.site-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.site-tab {
  border: 1.5px solid #f0dfc8; background: #fff; cursor: pointer;
  color: #8a6b75; font-size: 12.5px; font-weight: 700;
  border-radius: 999px; padding: 7px 16px;
}
.site-tab.active { background: #e8336d; border-color: #e8336d; color: #fff; }
.site-tab.ghost { border-style: dashed; color: #c5b3a4; }
.sec-note { font-size: 12px; color: #c5b3a4; }
.form-hint { font-size: 12px; color: #c5b3a4; line-height: 1.6; margin-top: 4px; }
.sec-tabs-row .sec-note { margin-left: auto; }

.provider-card {
  background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px;
  padding: 16px 18px; display: flex; gap: 14px; align-items: flex-start;
}
.provider-card + .provider-card { margin-top: 12px; }
.provider-card.un { background: #fffcf5; }
.pc-icon { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pc-main { flex: 1; min-width: 0; }
.pc-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pc-name { font-size: 15px; font-weight: 900; color: #3d2530; }
.pc-tag { font-size: 11px; font-weight: 800; border-radius: 6px; padding: 2px 8px; }
.pc-tag.ok { background: #e6f6ee; color: #1f9d61; }
.pc-tag.miss { background: #fde3ec; color: #d03050; }
.pc-mono { font-family: Consolas, monospace; font-size: 11.5px; color: #a08592; }
.pc-rows { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.pc-row { display: flex; gap: 12px; font-size: 12.5px; }
.pc-label { width: 76px; color: #a08592; flex-shrink: 0; }
.pc-value { color: #3d2530; }
.pc-value.mono { font-family: Consolas, monospace; }
.pc-value.dim { color: #c5b3a4; }
.pc-ops { display: flex; flex-direction: column; gap: 8px; flex-shrink: 0; }

.mini-btn {
  border: none; cursor: pointer; font-size: 12.5px; font-weight: 800;
  border-radius: 999px; padding: 8px 16px; white-space: nowrap;
}
.mini-btn.primary { background: #e8336d; color: #fff; box-shadow: 0 3px 0 rgba(163, 18, 69, 0.25); }
.mini-btn.primary:hover { background: #d0295f; }
.mini-btn.ghost { background: #fff; color: #a31245; border: 1.5px solid #f0b7cd; }
.ml-auto { margin-left: auto; }

.sec-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.sec-title { margin: 0; font-size: 16px; font-weight: 900; color: #3d2530; display: flex; align-items: center; gap: 8px; }
.sec-idx {
  font-style: normal; background: #3d2530; color: #fff;
  width: 20px; height: 20px; border-radius: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 800;
}

.role-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 12px; }
.role-card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 14px; padding: 14px 16px; }
.role-card.hot { border-color: #e8336d; box-shadow: 0 4px 0 rgba(232, 51, 109, 0.12); }
.rc-head { display: flex; align-items: center; gap: 8px; }
.rc-name { font-size: 14px; font-weight: 900; color: #3d2530; }
.rc-builtin { font-size: 10.5px; font-weight: 800; background: #fff6e9; color: #a3691b; border-radius: 6px; padding: 1px 7px; }
.rc-desc { margin: 8px 0 0; font-size: 12px; color: #a08592; line-height: 1.6; }

.card { background: #fff; border: 1.5px solid #f0dfc8; border-radius: 16px; padding: 14px 16px; }
.perm { font-size: 12.5px; font-weight: 800; border-radius: 6px; padding: 2px 10px; }
.perm.rw { background: #e6f6ee; color: #1f9d61; }
.perm.ro { background: #fff6e9; color: #a08592; }
.perm.na { color: #d9c2ae; }

.role-tag { font-size: 11.5px; font-weight: 800; border-radius: 6px; padding: 3px 10px; white-space: nowrap; }
.rt-platform { background: #ffe9c9; color: #9a5b00; }
.rt-site { background: #fde3ec; color: #a31245; }
.rt-ro { background: #f0ebe4; color: #8a6b75; }

.st { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 700; }
.st-dot { width: 7px; height: 7px; border-radius: 999px; }
.st-on { color: #1f9d61; } .st-on .st-dot { background: #1f9d61; }
.st-off { color: #a08592; } .st-off .st-dot { background: #c5b3a4; }

.filters { display: flex; gap: 10px; margin-bottom: 12px; }
.dim { color: #c5b3a4; font-size: 12.5px; }
/* 企业微信客服（迁移 040） */
.kf-card { margin-bottom: 12px; }
.kf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 20px; }
.kf-field { display: flex; flex-direction: column; gap: 6px; }
.kf-field-status { grid-column: 1 / -1; }
.kf-label { font-size: 13px; font-weight: 800; color: #5c3a4a; display: flex; align-items: center; gap: 8px; }
.kf-label i { font-style: normal; color: #e8336d; }
.kf-req {
  font-size: 10.5px; font-weight: 800; background: #fff6e9; color: #a3691b;
  border-radius: 6px; padding: 1px 7px;
}
.kf-hint { margin: 0; font-size: 12px; color: #a08592; line-height: 1.65; }
.kf-hint code { background: #f7f2ec; border-radius: 4px; padding: 0 5px; font-size: 11.5px; }
.kf-hint-warn { color: #d03050; }
.kf-ops { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.kf-mono { font-family: Consolas, monospace; font-size: 11.5px; color: #c5b3a4; margin-left: auto; }

.kf-guide { background: #fffdf8; }
.guide-title {
  margin: 0 0 8px; font-size: 14px; font-weight: 900; color: #3d2530;
  display: flex; align-items: center; gap: 7px;
}
.guide-title::before { content: ''; width: 3px; height: 14px; border-radius: 2px; background: #e8336d; }
.kf-guide .guide-title:not(:first-child) { margin-top: 20px; }
.guide-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 7px; }
.guide-list-plain { list-style: none; padding-left: 2px; }
.guide-list li { font-size: 12.5px; color: #6b5a52; line-height: 1.7; }
.guide-list b { color: #3d2530; }
.guide-list code { background: #f7f2ec; border-radius: 4px; padding: 0 5px; font-size: 11.5px; }
.guide-warn { color: #d03050; font-weight: 700; }

.guide-table { border: 1.5px solid #f0dfc8; border-radius: 10px; overflow: hidden; }
.gt-row {
  display: grid; grid-template-columns: 70px 1fr 1fr; gap: 10px;
  padding: 9px 12px; font-size: 12.5px; color: #6b5a52; line-height: 1.6;
  border-bottom: 1px solid #f7f2ec; align-items: start;
}
.gt-row:last-child { border-bottom: none; }
.gt-head { background: #fff6e9; font-weight: 800; color: #5c3a4a; }
.gt-end { font-weight: 800; color: #3d2530; }
.gt-row code { background: #f7f2ec; border-radius: 4px; padding: 0 5px; font-size: 11.5px; }

.hint-warn {
  margin-top: 6px;
  padding: 7px 10px;
  border-radius: 8px;
  background: #fff6e9;
  border: 1px solid #ffd9a8;
  color: #a31245;
  font-size: 12px;
  line-height: 1.6;
}
</style>
