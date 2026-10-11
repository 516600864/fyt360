// 探针2：site 名称 + 模拟浏览器会话（x-fyt-site 头）实测线上 commission/config
import { readFileSync } from 'node:fs';
for (const line of readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2];
}

const BASE = 'https://mk.fyt360.cn';

const login = async () => {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_INIT_PASSWORD }),
  });
  const j = await r.json();
  return { token: j?.data?.token ?? '', role: j?.data?.admin?.role, keys: Object.keys(j?.data?.admin ?? {}) };
};

const { token, role, keys } = await login();
console.log('login role =', role, '| admin 返回字段 =', keys.join(','));

for (const hdr of [null, 'niwo', 'site-a']) {
  const headers = { Authorization: 'Bearer ' + token };
  if (hdr) headers['x-fyt-site'] = hdr;
  const r = await fetch(BASE + '/api/admin/commission/config?site=site-a', { headers });
  const j = await r.json().catch(() => null);
  console.log(`\nx-fyt-site=${hdr ?? '(无)'} → GET config?site=site-a : HTTP ${r.status}`,
    j?.ok ? `levels=${j.data.levels.length} stats=${JSON.stringify(j.data.stats)}` : `body=${JSON.stringify(j)}`);
}

// niwo 的 config 也顺带测
const r2 = await fetch(BASE + '/api/admin/commission/config?site=niwo', { headers: { Authorization: 'Bearer ' + token } });
const j2 = await r2.json().catch(() => null);
console.log(`\nGET config?site=niwo : HTTP ${r2.status}`,
  j2?.ok ? `levels=${j2.data.levels.length} site=${j2.data.site} rules=${Object.keys(j2.data.rules).join(',')}` : `body=${JSON.stringify(j2)}`);
