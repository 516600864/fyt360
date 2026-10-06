<template>
  <view class="doc-page" :style="pageTheme">
    <view class="doc-card">
      <text class="doc-title">{{ doc.title }}</text>
      <text class="doc-updated">更新日期：{{ doc.updated }}</text>
      <view v-for="(s, i) in doc.sections" :key="i" class="doc-sec">
        <text class="ds-head">{{ i + 1 }}. {{ s.h }}</text>
        <text class="ds-body">{{ s.b }}</text>
      </view>

      <!-- 企微客服入口（迁移 040）：协议里的【客服联系方式】占位符由这个真按钮兑现 -->
      <view class="doc-sec kefu-sec">
        <text class="ds-head">联系客服</text>
        <text class="ds-body">如对协议或服务有疑问、意见、投诉，点击下方按钮接入企业微信人工客服，我们将在 15 个工作日内答复。</text>
        <button class="kefu-btn" @tap="onKefu">
          <text class="kefu-ico">🎧</text>
          <text class="kefu-txt">{{ kefuEnabled ? '接入人工客服' : '联系客服' }}</text>
        </button>
        <text class="kefu-note">客服工作时间内实时响应；非工作时间可留言，客服将在次日回复。</text>
      </view>
    </view>
  </view>
</template>

<script>
import { openCustomerService, prefetchKf, isKfEnabled } from '../../utils/kefu';

/**
 * 协议文档页（内置通用文本，无后端依赖）：
 *   /pages/profile/doc?doc=agreement → 用户协议
 *   /pages/profile/doc?doc=privacy   → 隐私政策
 * 文本为通用底稿：正式运营前建议按主体信息（公司全称/联系方式/ICP）替换【】占位后定稿。
 */
const AGREEMENT = {
  title: '用户服务协议',
  updated: '2026年10月1日',
  sections: [
    { h: '协议的接受', b: '欢迎使用 FYT360 小程序（以下简称"本平台"）。本协议是您与本平台运营主体【运营主体全称】之间关于使用本平台服务的约定。您注册、登录或实际使用本平台服务，即视为已阅读并同意本协议全部内容。' },
    { h: '服务说明', b: '本平台为生活消费优惠信息聚合服务，提供到店团购、优惠商品导购、会员权益及返利等功能。部分商品或服务由第三方合作方（含电商平台、线下商户）提供，本平台仅提供信息展示、交易撮合或转链服务；第三方商品/服务的质量、交付与售后由相应提供方负责。' },
    { h: '账号与使用规范', b: '您承诺以真实身份使用本平台，不得利用技术手段批量注册、刷单、套取返利或元宝，不得从事任何违反法律法规或损害平台及第三方合法权益的行为。若发现上述行为，本平台有权视情节采取警告、扣除违规所得、限制功能或封禁账号等措施。' },
    { h: '交易与售后', b: '通过本平台下单的交易，请以订单页展示的价格与规则为准。第三方平台订单的退款、售后按相应第三方平台规则执行；到店团购订单请在有效期内到店核销使用，未核销券码按订单页标注的规则申请退款。如有争议，您可通过平台客服渠道反馈，我们将协助您与提供方协商解决。' },
    { h: '返利、元宝与会员等级', b: '您通过本平台完成的合格订单可能获得返利或元宝奖励，具体比例与到账时间以页面规则展示为准。元宝可用于兑换会员等级等用途，不可转让、不可提现、不构成任何有价证券。因第三方平台结算延迟、订单退款或风控判定不合格的订单，本平台有权不发放或追回相应奖励。' },
    { h: '服务的变更与中断', b: '因系统维护、第三方服务调整或不可抗力等原因，本平台可能暂停或变更部分服务。对已产生的订单与账户权益，本平台将依法依约妥善处理。' },
    { h: '免责声明', b: '本平台展示的优惠信息来自第三方合作方，可能因价格调整、库存变化等原因与实际不符，请以下单页面为准。对于因第三方原因造成的损失，本平台在法律允许范围内协助处理，但不承担超出法律规定的赔偿责任。' },
    { h: '法律适用与争议解决', b: '本协议适用中华人民共和国法律。因本协议产生的争议，双方应友好协商解决；协商不成的，任何一方可向本平台运营主体所在地有管辖权的人民法院提起诉讼。' },
  ],
};

const PRIVACY = {
  title: '隐私政策',
  updated: '2026年10月1日',
  sections: [
    { h: '我们如何收集信息', b: '为提供服务，我们会在您使用以下功能时收集必要信息：① 微信登录：收集您的微信用户标识（openid/unionid）、昵称与头像，用于创建和识别账号；② 手机号绑定（可选）：在您主动授权时收集，用于账号安全与客服联络；③ 订单与核销：收集您的订单记录、返利记录及团购券码核销记录；④ 设备信息：收集必要的设备参数用于保障服务安全。我们不收集与提供服务无关的个人信息。' },
    { h: '我们如何使用信息', b: '收集的信息用于：账号登录与识别、订单归因与返利结算、到店核销验证、客服与售后支持、服务安全与风控。我们不会将您的个人信息用于上述目的之外的用途。' },
    { h: '信息的共享', b: '仅在以下情形下共享必要信息：① 微信登录与订阅消息：向微信开放平台提供必要标识；② CPS 导购与返利：向合作联盟（如蚂蚁星球）传递生成转链所需的匿名化参数，用于订单归因与佣金结算；③ 支付服务：通过微信支付完成交易；④ 法律法规要求或有权机关依法要求时。除上述情形外，我们不会向任何第三方提供您的个人信息。' },
    { h: '信息的存储与保护', b: '您的信息存储于中华人民共和国境内的服务器。我们采用加密传输、访问控制等技术手段保护您的信息安全，并将信息保留期限限定为实现上述目的所必需的最短时间。' },
    { h: '您的权利', b: '您可以在"我的-设置"中查看、更正个人资料；可以联系客服查询或导出您的订单与流水；可以通过"处理注销"功能申请注销账号。注销后，我们将对您的身份信息进行匿名化处理，法律法规另有规定的除外。' },
    { h: '未成年人保护', b: '本平台面向成年人提供服务。若您为未满 14 周岁的未成年人，请在监护人陪同下阅读本政策，并在征得监护人同意后使用本平台。' },
    { h: '政策更新', b: '我们可能适时修订本政策。重大变更时，我们将通过平台公告或弹窗等方式向您提示。若您在变更后继续使用本平台，即视为同意修订后的政策。' },
    { h: '联系我们', b: '如对本政策有任何疑问、意见或投诉，可通过小程序"帮助与反馈"或客服渠道联系我们，我们将在 15 个工作日内答复。【客服联系方式】' },
  ],
};

export default {
  data() {
    return { doc: AGREEMENT, kefuEnabled: false };
  },
  onLoad(q) {
    const isPrivacy = q && q.doc === 'privacy';
    this.doc = isPrivacy ? PRIVACY : AGREEMENT;
    uni.setNavigationBarTitle({ title: this.doc.title });
    // 预取客服开通状态（迁移 040）：按钮文案据此区分"接入人工客服"与"联系客服"
    prefetchKf();
    isKfEnabled().then((on) => { this.kefuEnabled = !!on; });
  },
  methods: {
    /** 企微客服（迁移 040）：未开通时 kefu.js 内部给明确提示，不静默 */
    onKefu() {
      openCustomerService();
    },
  },
};
</script>

<style scoped>
.doc-page {
  min-height: 100vh;
  background: var(--fyt-bg, #fff6e9);
  padding: 24rpx 32rpx 64rpx;
}
.doc-card {
  background: #fffdf7;
  border: 2rpx solid #f7c2d6;
  border-radius: 24rpx;
  padding: 36rpx 32rpx;
}
.doc-title { display: block; font-size: 38rpx; font-weight: 900; color: #2b2b2b; }
.doc-updated { display: block; font-size: 24rpx; color: var(--fyt-text-2, #8c8577); margin: 10rpx 0 8rpx; }
.doc-sec { display: block; margin-top: 26rpx; }
.ds-head { display: block; font-size: 29rpx; font-weight: 800; color: var(--fyt-primary, #e8336d); margin-bottom: 8rpx; }
.ds-body { display: block; font-size: 26rpx; line-height: 1.75; color: #4a443c; }

/* 企微客服按钮（迁移 040）：走波普风 VI，玫红描边，与主 CTA 同族 */
.kefu-sec { margin-top: 8rpx; }
.kefu-btn {
  margin: 24rpx 0 0;
  display: flex; align-items: center; justify-content: center; gap: 12rpx;
  height: 88rpx; width: 100%;
  background: var(--fyt-primary, #e8336d);
  border: 3rpx solid var(--fyt-primary, #e8336d);
  border-radius: 28rpx;
  box-shadow: 0 6rpx 0 rgba(163, 18, 69, 0.22);
  line-height: 1;
}
.kefu-btn::after { border: none; }
.kefu-ico { font-size: 34rpx; }
.kefu-txt { font-size: 30rpx; font-weight: 700; color: #fff; }
.kefu-note { display: block; margin-top: 16rpx; font-size: 22rpx; color: #8c8577; line-height: 1.6; }
</style>
