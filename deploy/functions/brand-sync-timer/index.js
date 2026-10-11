// fyt360 通用定时器桥（云函数版定时触发器）——多任务复用
// 链路：SCF timer → 本函数 → HTTPS POST 云托管 /api/jobs/<job>/cron?token=
// 为什么不用云托管原生定时触发器：CloudBase 云托管 API 仅开放 TimerScale（定时扩缩容），
// 无"定时发 HTTP 请求"的触发器；云函数定时器全程可 API 配置，部署脚本幂等创建（开源可复用）。
// 环境变量（由 function-deploy.mjs 注入）：JOB_URL / JOB_TOKEN
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

// SCF timer event 携带 TriggerName/Time，这里不关心具体字段，单任务单 POST
exports.main = async () => {
  const base = process.env.JOB_URL;
  const token = process.env.JOB_TOKEN;
  if (!base || !token) return { ok: false, error: 'JOB_URL / JOB_TOKEN 未配置' };
  try {
    const r = await postCron(`${base}?token=${encodeURIComponent(token)}`);
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
