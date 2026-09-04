-- ¿Qué tab abre cada usuario y tiene tasks en MySQL?
SELECT
  nt.user_id,
  nt.active_tab_id,
  CASE
    WHEN t.tab_id IS NULL THEN '❌ NO EXISTE fila en notion_tasks'
    WHEN t.tasks IS NULL OR t.tasks = '[]' OR JSON_LENGTH(t.tasks) = 0 THEN '⚠️ fila vacía'
    ELSE CONCAT('✅ ', JSON_LENGTH(t.tasks), ' filas, ', LENGTH(t.tasks), ' bytes')
  END AS estado_tasks
FROM notion_tabs nt
LEFT JOIN notion_tasks t ON t.tab_id COLLATE utf8mb4_unicode_ci = nt.active_tab_id COLLATE utf8mb4_unicode_ci
ORDER BY nt.user_id;

-- Cuántas filas tiene cada tab con data
SELECT tab_id, JSON_LENGTH(tasks) AS num_filas, LENGTH(tasks) AS bytes
FROM notion_tasks
ORDER BY bytes DESC;

-- Tabs en notion_tasks que ningún usuario tiene en su lista activa (huérfanos)
-- (Revisar manualmente en phpMyAdmin el JSON de notion_tabs.tabs)
