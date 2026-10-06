-- 012: 首页追加影票热映楼层（2026-09-27，D先生 确认排入默认首页）
-- 仅对 published 的 home 追加 movie-box 楼层（置于商品流之前），幂等：已有 movie-box 楼层则跳过
-- 楼层定义与 packages/renderer/schema/default-home.json 的 f-movie 保持同源
UPDATE page_schema
   SET schema_json = jsonb_set(
         schema_json,
         '{floors}',
         schema_json->'floors' || '[{"type":"movie-box","floor_id":"f-movie","component_id":"c-movie","props":{"mode":"hot","title":"","more":"","brand_code":"life_01"}}]'::jsonb
       ),
       version = version + 1,
       updated_at = now()
 WHERE page = 'home'
   AND status = 'published'
   AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(schema_json->'floors') f
          WHERE f->>'type' = 'movie-box'
       );
