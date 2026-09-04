-- ============================================================
-- RECUPERACIÓN DE EMERGENCIA — Notion (ejecutar PASO A PASO)
-- ============================================================

-- ── PASO 1: Estado actual ──────────────────────────────────
SELECT COUNT(*) AS total_tabs FROM notion_tasks;

SELECT COUNT(*) AS tabs_vacios
FROM notion_tasks
WHERE tasks IS NULL OR tasks = '[]' OR tasks = '' OR JSON_LENGTH(tasks) = 0;

-- ── PASO 2: ¿Hay revisiones? ───────────────────────────────
-- Si COUNT = 0 → NO uses los pasos 3-5. Ve al PASO 6 (backup hosting).
SELECT COUNT(*) AS revisiones_con_datos
FROM notion_tab_revisions
WHERE row_count > 0;

SELECT tab_id, revision_num, row_count, kind, label, created_at
FROM notion_tab_revisions
WHERE row_count > 0
ORDER BY tab_id, created_at DESC;

-- ── PASO 3-5: SOLO si PASO 2 devolvió revisiones (> 0) ─────
-- (Tu caso: COUNT = 0 → NO ejecutar esto)

-- UPDATE notion_tasks nt
-- JOIN (
--   SELECT tab_id, tasks_json, columns_json
--   FROM (
--     SELECT tab_id, tasks_json, columns_json,
--            ROW_NUMBER() OVER (PARTITION BY tab_id ORDER BY created_at DESC) AS rn
--     FROM notion_tab_revisions
--     WHERE row_count > 0
--   ) ranked
--   WHERE rn = 1
-- ) rev ON rev.tab_id COLLATE utf8mb4_unicode_ci = nt.tab_id COLLATE utf8mb4_unicode_ci
-- SET nt.tasks = rev.tasks_json;

-- ── PASO 6: SIN REVISIONES → backup del hosting ────────────
-- cPanel → File Manager → Backups / Backup Wizard
-- O phpMyAdmin → Importar dump .sql de AYER (antes del deploy)
-- Tablas a restaurar: notion_tasks, notion_columns, notion_tabs
--
-- ── PASO 7: ¿Quedaron JSON en el servidor? ─────────────────
-- Por FTP revisa si existe: /out/data/tasks.*.json
-- Si hay archivos con contenido (no []), importa con:
-- GET https://www.bocasion.com/out/api/sync.php?secret=SYNC_SECRET_2026&mode=json_to_db
-- (sync.php ya tiene protección anti-vaciado)

-- ── PASO 8: Exportar lo que queda (por si acaso) ───────────
-- GET https://www.bocasion.com/out/api/sync.php?secret=SYNC_SECRET_2026&mode=status
-- GET https://www.bocasion.com/out/api/sync.php?secret=SYNC_SECRET_2026&mode=db_to_json
