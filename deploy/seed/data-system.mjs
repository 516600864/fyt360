// 会员等级（§11.2 / 决策 #20/#21）+ RBAC 内置角色（§8.2）+ 示例站点
export const memberLevels = [
  { code: 'L1', name: '省心会员', sort: 1, ingot_price: 0, self_rate: 0, direct_rate: 0, team_rate: 0, team2_rate: 0, desc: '注册即得，纯消费者：领券购物 + 权益兑换入口，无返利资格' },
  { code: 'L2', name: '返利会员', sort: 2, ingot_price: 5000, self_rate: 0.4, direct_rate: 0.1, team_rate: 0, team2_rate: 0, desc: '元宝兑换；自购省钱 + 团队起点' },
  { code: 'L3', name: '合伙人', sort: 3, ingot_price: 20000, self_rate: 0.6, direct_rate: 0.2, team_rate: 0.05, team2_rate: 0, desc: '元宝兑换；全比例收益（自购 + 直推 + 间推）' },
];

// 元宝默认参数（决策 #21，后台可配；M1 仅随 seed 记录于 role permissions 外的系统注释，
// 运行时参数 M2 起读 site 级配置表扩展）
export const ingotDefaults = { rebatePerYuan: 100, inviteReward: 500 };

export const roles = [
  {
    role_code: 'platform_admin', name: '平台超管',
    permissions: ['site.manage', 'system.settings', 'pay.onboard', 'commission.config', 'provider.key', 'dashboard.global', 'site.switch'],
  },
  {
    role_code: 'site_admin', name: '站点管理员',
    permissions: ['page.diy', 'goods.self', 'order.manage', 'verify.manage', 'withdraw.first_audit', 'marketing.manage', 'ai.page'],
  },
  {
    role_code: 'readonly_ops', name: '只读运营',
    permissions: ['dashboard.view', 'order.view', 'goods.view'],
  },
];

// 示例站点 A（§14.2：一键部署产出空平台 + 示例站点；凭据留空由后台录入）
export const sampleSite = {
  code: 'site-a',
  name: '示例站点 A',
  theme: {
    primary: '#E8336D',
    secondary: '#FFAA1D',
    surface: '#FFF6E9',
    dark: '#A31245',
    borderThick: '3px',
    radiusLg: '20px',
  },
};
