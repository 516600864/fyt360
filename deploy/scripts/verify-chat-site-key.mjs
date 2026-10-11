// 判别探针：site-a 蚂蚁行临时 inactive → niwo 会话转链仍成功 = 证明走 niwo key（修复实锤）
// 判据决定性：旧代码 resolveHjkConfig(undefined) 恒 fallback site-a → 必 503；新代码用 niwo key → 成功
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import { connectDb } from './lib/db.mjs';

for (const line of fs.readFileSync('D:/Hope/fyt360/fyt360/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}
const db = await connectDb();
const API = 'https://mk.fyt360.cn/api';

// niwo siteId + 测试用户 25（D先生 测试号，chat_message 实锤在此站活跃）
const site = (await db.query(`SELECT site_id FROM site WHERE code = 'niwo'`)).rows[0];
const siteId = site.site_id;
const token = jwt.sign({ typ: 'user', userId: 25, siteId }, process.env.JWT_SECRET);

const msg = '【淘宝】假一赔四 https://e.tb.cn/h.8ABWHqJAnjMAkw7?tk=1J1ZTrGpnL2 CZ009 「澳洲驱虫药驱赶蟑螂神器」点击链接直接打开';

async function convertOnce(tag) {
  const res = await fetch(`${API}/chat/sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: msg, session_id: `probe-keyfix-${Date.now()}` }),
  });
  const text = await res.text();
  const cardEv = text.split('\n\n').find((b) => b.startsWith('event: card') && b.includes('parse_card'));
  const errEv = text.split('\n\n').find((b) => b.startsWith('event: error'));
  if (cardEv) {
    const data = JSON.parse(cardEv.split('\ndata: ')[1] ?? '{}');
    console.log(`[${tag}] ✅ parse_card platform=${data?.platform} 口令=${String(data?.link?.url ?? data?.link?.tkl ?? '').slice(0, 20)}`);
    return true;
  }
  if (errEv) console.log(`[${tag}] ❌ error: ${errEv.split('\ndata: ')[1]}`);
  else console.log(`[${tag}] ❌ 无卡片无错误，原始前 200 字: ${text.slice(0, 200)}`);
  return false;
}

try {
  // 1) 基线：不改配置，niwo 会话转链（新旧代码都可能成功，仅作对照）
  const baseline = await convertOnce('baseline');

  // 2) 判别：site-a 蚂蚁行置 inactive（60s 缓存窗口风险：等缓存过期再测才严谨 → 先清不可能，等 61s）
  await db.query(`UPDATE provider_config pc SET status='inactive' FROM site s
                   WHERE s.site_id=pc.site_id AND s.code='site-a' AND pc.provider='mayixingqiu'`);
  console.log('[gate] site-a mayixingqiu → inactive，等 61s 让线上 60s 凭据缓存过期…');
  await new Promise((s) => setTimeout(s, 61_000));
  const gated = await convertOnce('gated(site-a禁用)');

  // 3) 判读
  if (baseline && gated) console.log('\n🎯 判定：gated 仍成功 → 转链走的是 niwo key（2403****e668），修复生效');
  else if (baseline && !gated) console.log('\n🚨 判定：gated 失败 → 转链仍在用 site-a key，修复未生效（旧代码或容器未更新）');
  else console.log('\n⚠️ 基线即失败，先查基础链路');
} finally {
  // 4) 恢复 site-a active（原值，非快照恢复）
  await db.query(`UPDATE provider_config pc SET status='active' FROM site s
                   WHERE s.site_id=pc.site_id AND s.code='site-a' AND pc.provider='mayixingqiu'`);
  const chk = (await db.query(`SELECT pc.status FROM provider_config pc JOIN site s ON s.site_id=pc.site_id
                                WHERE s.code='site-a' AND pc.provider='mayixingqiu'`)).rows[0];
  console.log(`[restore] site-a mayixingqiu status = ${chk.status}`);
  // 5) 清理本次探针产生的测试消息（user 25 + niwo，session 前缀 probe-keyfix-）
  const del = await db.query(`DELETE FROM chat_message WHERE site_id=$1::uuid AND user_id=25 AND session_id LIKE 'probe-keyfix-%' RETURNING id`, [siteId]);
  console.log(`[cleanup] 清理测试消息 ${del.rows.length} 条`);
  await db.end();
}
