-- Recuperar Ivan Lima (user_prueba_seed) — paso rápido si ya tiene 31 filas en prod

-- 1) ¿Cuántas filas y bytes tiene cada tab?
SELECT tab_id, JSON_LENGTH(tasks) AS filas_mysql, LENGTH(tasks) AS bytes
FROM notion_tasks
WHERE tab_id IN ('prueba_tab_tareas','prueba_tab_clientes','notion_prueba_tab1','notion_prueba_tab2','notion_prueba_tab3','notion_1780326556785_5e3ccf');

-- 2) ¿El JSON es válido? (si json_valid=0 → tasks.php devuelve error y la UI muestra 0)
SELECT tab_id,
       LENGTH(tasks) AS bytes,
       JSON_VALID(tasks) AS json_valid,
       JSON_LENGTH(tasks) AS filas
FROM notion_tasks
WHERE tab_id = 'prueba_tab_tareas';

-- 3) ¿Columna tasks es LONGTEXT? (TEXT trunca adjuntos grandes y rompe el JSON)
SHOW COLUMNS FROM notion_tasks LIKE 'tasks';
-- Si Type = text → ejecutar: sql/migrate_notion_tasks_longtext.sql

-- Apuntar al tab con la data principal (Mayo 2026, 31 filas)
UPDATE notion_tabs
SET active_tab_id = 'prueba_tab_tareas'
WHERE user_id = 'user_prueba_seed';

-- Importar tabs adicionales desde backup: subir out/ y abrir:
-- preview:  /out/api/notion-import-user.php?secret=SYNC_SECRET_2026&userId=user_prueba_seed&mode=preview
-- restore:  /out/api/notion-import-user.php?secret=SYNC_SECRET_2026&userId=user_prueba_seed&mode=restore
