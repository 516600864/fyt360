// seed：初始数据（幂等 ON CONFLICT）
// 范围 = M1 开工计划：159 业务入口 / 23 组件 / L1-L3 / 三角色 + 平台超管 / 示例站点 A
import bcrypt from 'bcryptjs';
import { loadDotEnv } from './lib/common.mjs';
import { connectDb } from './lib/db.mjs';
import { categories } from '../seed/data-entries.mjs';
import { components } from '../seed/data-components.mjs';
import { memberLevels, roles, sampleSite } from '../seed/data-system.mjs';

async function main() {
  loadDotEnv();
  const client = await connectDb();
  const inTx = client.backend === 'direct'; // tcbapi 后端逐条执行、无会话事务，靠幂等补偿
  const stats = {};
  try {
    if (inTx) await client.query('BEGIN');

    // 1. 品牌 10 大分类
    for (const c of categories) {
      await client.query(
        `INSERT INTO brand_category (code, name, sort) VALUES ($1,$2,$3)
         ON CONFLICT (code) DO NOTHING`,
        [c.code, c.name, c.sort]
      );
    }
    stats.categories = categories.length;

    // 2. 159 业务入口 → brand_action_cfg（先校验总数再写库）
    const entryCount = categories.reduce((n, c) => n + c.entries.length, 0);
    if (entryCount !== 159) throw new Error(`入口数 ${entryCount} ≠ 159，终止`);
    for (const c of categories) {
      for (let i = 0; i < c.entries.length; i++) {
        await client.query(
          `INSERT INTO brand_action_cfg (site_scope, category, brand_code, name, action_type, enabled)
           VALUES ('all', $1, $2, $3, 'launch', TRUE)
           ON CONFLICT (site_scope, category, brand_code) DO NOTHING`,
          [c.code, `${c.code}_${String(i + 1).padStart(2, '0')}`, c.entries[i]]
        );
      }
    }
    stats.entries = entryCount;

    // 3. 23 组件模板库
    for (const comp of components) {
      await client.query(
        `INSERT INTO component_template (code, name, category, schema_tpl)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (code) DO NOTHING`,
        [comp.code, comp.name, comp.category, JSON.stringify(comp.schema_tpl)]
      );
    }
    stats.components = components.length;

    // 4. 会员等级 L1/L2/L3（§11.2）
    for (const lv of memberLevels) {
      await client.query(
        `INSERT INTO member_level (code, name, sort, ingot_price, self_rate, direct_rate, team_rate, team2_rate, "desc", status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
         ON CONFLICT (code) DO NOTHING`,
        [lv.code, lv.name, lv.sort, lv.ingot_price, lv.self_rate, lv.direct_rate, lv.team_rate, lv.team2_rate, lv.desc]
      );
    }
    stats.memberLevels = memberLevels.length;

    // 5. 内置角色
    for (const r of roles) {
      await client.query(
        `INSERT INTO role (role_code, name, permissions) VALUES ($1,$2,$3::jsonb)
         ON CONFLICT (role_code) DO NOTHING`,
        [r.role_code, r.name, JSON.stringify(r.permissions)]
      );
    }
    stats.roles = roles.length;

    // 6. 示例站点 A
    const siteRes = await client.query(
      `INSERT INTO site (code, name, theme, status) VALUES ($1,$2,$3::jsonb,'active')
       ON CONFLICT (code) DO NOTHING
       RETURNING site_id`,
      [sampleSite.code, sampleSite.name, JSON.stringify(sampleSite.theme)]
    );
    stats.siteCreated = siteRes.rowCount;

    // 7. 平台超管（密码取 ADMIN_INIT_PASSWORD，首次登录强制改密）
    //    重复执行不覆盖已改密码
    const pwd = process.env.ADMIN_INIT_PASSWORD;
    if (pwd && pwd.trim() !== '') {
      const hash = bcrypt.hashSync(pwd, 10);
      await client.query(
        `INSERT INTO admin_user (username, password_hash, role, must_change_password)
         VALUES ('admin', $1, 'platform_admin', TRUE)
         ON CONFLICT (username) DO NOTHING`,
        [hash]
      );
      stats.adminSeeded = 1;
    } else {
      console.warn('[seed] ADMIN_INIT_PASSWORD 未设置，跳过平台超管创建（deploy 阶段会强制要求）');
    }

    // 8. 示例站点 A 默认首页 Schema（空壳渲染器消费）
    const { rows: siteRows } = await client.query(`SELECT site_id FROM site WHERE code = $1`, [sampleSite.code]);
    if (siteRows[0]) {
      const homeSchema = [
        { component_id: 'c1', floor_id: 'f_hero', type: 'swiper', props: { items: [], autoplay: true } },
        { component_id: 'c2', floor_id: 'f_search', type: 'search-bar', props: { sticky: true } },
        { component_id: 'c3', floor_id: 'f_nav', type: 'nav', props: { columns: 5, items: [] } },
        { component_id: 'c4', floor_id: 'f_feed', type: 'goods-feed', props: { source: 'haojingke', tabSwitch: ['jd', 'tb', 'pdd', 'vip', 'self'] } },
      ];
      await client.query(
        `INSERT INTO page_schema (site_id, page, schema_json, version, status, source)
         SELECT $1, 'home', $2::jsonb, 1, 'published', 'manual'
         WHERE NOT EXISTS (
           SELECT 1 FROM page_schema WHERE site_id = $1 AND page = 'home' AND status = 'published'
         )`,
        [siteRows[0].site_id, JSON.stringify(homeSchema)]
      );
      stats.homeSchema = 1;
    }

    if (inTx) await client.query('COMMIT');
    console.log(`[seed] 完成（幂等，后端=${client.backend}）：`, JSON.stringify(stats));
  } catch (e) {
    if (inTx) await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('[seed] 失败：', e.message);
  process.exit(1);
});
