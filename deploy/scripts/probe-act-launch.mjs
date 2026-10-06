// 验证：brand-launch mode=act 动态转链（抽查各分类代表 + 未映射空壳诚实 404）
const BASE = 'https://mk.fyt360.cn/api/site/brand-launch';
const codes = [
  'meituan_01', // 美团官方小程序 → we_app_info → mode=launch
  'eleme_08',   // 饿了么 → we_app_info
  'taxi_01',    // 滴滴 → we_app_info
  'tb_06',      // 淘宝联盟 H5 → mode=h5url
  'jd_13',      // 京东外卖 H5
  'vip_11',     // 唯品会 H5
  'pdd_04',     // 拼多多 H5
  'hotel_05',   // 飞猪 H5
  'meituan_11', // 未映射空壳 → 404 诚实
];
for (const code of codes) {
  const res = await fetch(`${BASE}?code=${code}`);
  const text = await res.text();
  console.log(res.status, code, text.slice(0, 260));
}
