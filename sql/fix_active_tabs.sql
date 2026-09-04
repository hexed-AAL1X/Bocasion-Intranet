-- FIX INMEDIATO: admin apunta a tab vacío, data está en notion_1779214564446_a0f196
UPDATE notion_tabs
SET active_tab_id = 'notion_1779214564446_a0f196'
WHERE user_id = 'user_admin_seed';

-- Verificar después:
SELECT user_id, active_tab_id FROM notion_tabs WHERE user_id = 'user_admin_seed';

-- Para el resto, usar API (subir notion-repair-tabs.php):
-- preview: /out/api/notion-repair-tabs.php?secret=SYNC_SECRET_2026&mode=preview
-- repair:  /out/api/notion-repair-tabs.php?secret=SYNC_SECRET_2026&mode=repair
