-- 019: 底部菜单 tabbar-v1（决策#28：custom-tab-bar + 5 壳页，Tab2~5 站点级可配）
-- tabbar 为 NULL 时端上回退原生 tabBar 默认项（不 seed，编辑器保存后才有值）
ALTER TABLE site ADD COLUMN IF NOT EXISTS tabbar jsonb;
