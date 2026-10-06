// fyt360 订单同步定时器（云函数版定时触发器）
// 链路：SCF timer（每 30 分钟）→ 本函数 → HTTPS POST 云托管 ordersync cron 端点
// 为什么不用云托管原生定时触发器：CloudBase 云托管 API 仅开放 TimerScale（定时扩缩容），
// 无"定时发 HTTP 请求"的触发器；云函数定时器全程可 API 配置，部署脚本幂等创建（开源可复用）。
const https = require('node:https');

function postCron(target) {
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        timeout: 280_000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': 0 },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 800) }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    req.end();
  });
}

// SCF timer event 携带 TriggerName/Time，这里不关心具体字段，一律执行全站点同步
exports.main = async () => {
  const base = process.env.ORDERSYNC_URL;
  const token = process.env.ORDERSYNC_TOKEN;
  const sites = (process.env.ORDERSYNC_SITES || 'site-a')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!base || !token) return { ok: false, error: 'ORDERSYNC_URL / ORDERSYNC_TOKEN 未配置' };

  const results = [];
  for (const site of sites) {
    try {
      results.push({ site, ...(await postCron(`${base}?token=${encodeURIComponent(token)}&code=${encodeURIComponent(site)}`)) });
    } catch (e) {
      results.push({ site, error: e.message });
    }
  }
  return { ok: true, results };
};
