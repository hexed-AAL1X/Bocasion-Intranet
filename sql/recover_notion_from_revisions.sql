-- Recuperación manual: ver revisiones disponibles por tab
SELECT tab_id, revision_num, kind, row_count, user_name, label, created_at
FROM notion_tab_revisions
WHERE row_count > 0
ORDER BY tab_id, created_at DESC;

-- Restaurar vía API (recomendado):
-- POST /out/api/notion-history.php?userId=TU_USER_ID
-- Body: { "action": "restore_latest", "tabId": "TU_TAB_ID", "userName": "Admin" }

-- O restaurar una revisión concreta:
-- POST /out/api/notion-history.php?userId=TU_USER_ID
-- Body: { "action": "apply_revision", "tabId": "TU_TAB_ID", "revisionId": "rev_...", "userName": "Admin" }
