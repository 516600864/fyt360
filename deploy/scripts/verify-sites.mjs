// 站点管理端到端验证：登录 → /api/admin/sites + /members
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const BASE = 'https://mk.fyt360.cn';
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: env.ADMIN_INIT_PASSWORD }),
}).then((r) => r.json());
if (!login.ok) { console.log('登录失败:', login.message); process.exit(1); }
const auth = { Authorization: `Bearer ${login.data.token}` };

const s = await fetch(`${BASE}/api/admin/sites`, { headers: auth }).then((r) => r.json());
console.log('sites:', s.ok ? JSON.stringify(s.data.sites.map((x) => ({ code: x.code, name: x.name, appid: x.appid ? '✓' : null, domain: x.domain, status: x.status, mini: x.mini_count }))) : s.message);

const m = await fetch(`${BASE}/api/admin/sites/members`, { headers: auth }).then((r) => r.json());
console.log('members:', m.ok ? JSON.stringify(m.data.members.map((x) => ({ u: x.username, role: x.role, st: x.status, sites: x.sites.map((y) => y.name) }))) : m.message);
