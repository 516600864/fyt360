import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('./.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]));
const B='https://mk.fyt360.cn';
async function j(pw, path, opt={}){ const r=await fetch(B+path,opt); return {status:r.status, body:await r.json().catch(()=>({})), headers:r.headers}; }
// 1. admin 登录 → 建壳 + 建号 + 设负责人
const al = await j('','/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:env.ADMIN_INIT_PASSWORD})});
const at = al.body.data.token;
const ah = {Authorization:'Bearer '+at,'Content-Type':'application/json'};
const code = 'repro'+Date.now().toString(36).slice(-5);
const site = await j('','/api/admin/sites',{method:'POST',headers:ah,body:JSON.stringify({code, name:'复现站'})});
if(!site.body.ok){console.log('site POST fail:', JSON.stringify(site.body)); process.exit(1);} const SID = site.body.data.site?.site_id ?? site.body.data.site_id;
const uname = 'repro_'+code;
await j('','/api/admin/settings/accounts',{method:'POST',headers:ah,body:JSON.stringify({username:uname,password:'Repro#2026abc',role:'site_admin'})});
// 找新账号 id
const mems = await j('','/api/admin/sites/members',{headers:ah});
console.log('members resp:', JSON.stringify(mems.body).slice(0,400)); const acc = (mems.body.data?.members ?? []).find(a=>a.username===uname); if(!acc){process.exit(1);}
await j('','/api/admin/sites/'+SID,{method:'PATCH',headers:ah,body:JSON.stringify({owner_admin_id:acc.admin_id})});
// 2. 该账号登录 → 保存凭据 → 立刻 GET
const ul = await j('','/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:uname,password:'Repro#2026abc'})});
const ut = ul.body.data.token;
const uh = {Authorization:'Bearer '+ut,'Content-Type':'application/json'};
const my = await j('','/api/admin/sites/my',{headers:uh});
console.log('my sites:', JSON.stringify(my.body.data.sites));
const put = await j('','/api/admin/sites/provision/'+SID+'/mayixingqiu',{method:'PUT',headers:uh,body:JSON.stringify({apikey:'e2e-invalid-key-repro'})});
console.log('PUT:', put.status, JSON.stringify(put.body.data?.test));
const g1 = await j('','/api/admin/sites/provision/'+SID,{headers:uh});
const ants1 = g1.body.data?.groups?.find(x=>x.key==='mayixingqiu');
console.log('GET#1:', g1.status, 'site.provisioned=', g1.body.data?.site?.provisioned, 'ants=', JSON.stringify(ants1));
const g2 = await j('','/api/admin/sites/provision/'+SID,{headers:uh});
const ants2 = g2.body.data?.groups?.find(x=>x.key==='mayixingqiu');
console.log('GET#2:', g2.status, 'ants=', JSON.stringify(ants2));
// 清理
await j('','/api/admin/sites/'+SID,{method:'DELETE',headers:ah});
if(acc) await j('','/api/admin/settings/accounts/'+acc.admin_id,{method:'DELETE',headers:ah});
console.log('cleaned', code);
