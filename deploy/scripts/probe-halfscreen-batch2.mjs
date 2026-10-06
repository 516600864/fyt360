// 验证：brand-launch 线上端点 × 新增 2 品牌 + 抽查 3 个已录品牌
const BASE = 'https://mk.fyt360.cn/api/site/brand-launch';
for (const code of ['meituan_37', 'life_06', 'dining_06', 'life_03', 'dining_10']) {
  const res = await fetch(`${BASE}?code=${code}`);
  const text = await res.text();
  let out = text;
  try { out = JSON.stringify(JSON.parse(text)); } catch {}
  console.log(res.status, code, out.slice(0, 320));
}
