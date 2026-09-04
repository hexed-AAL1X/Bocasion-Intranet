<?php
/** Biblioteca compartida: historial de revisiones y audit log para tabs Notion. */
mb_internal_encoding('UTF-8');

const HISTORY_MAX_REVISIONS = 25;
const HISTORY_MAX_AUDIT = 200;
const HISTORY_AUTO_MIN_INTERVAL_SEC = 600; // 10 min entre auto-checkpoints

function history_safe_id(string $id): string {
    return preg_replace('/[^a-zA-Z0-9_\-]/', '', $id);
}

/** MySQL DATETIME (hora del servidor) → ISO sin marcar UTC falso. */
function history_mysql_datetime_to_iso($value): string {
    if (!is_string($value) || $value === '') {
        return date('c');
    }
    if (strpos($value, 'T') !== false) {
        return $value;
    }
    return str_replace(' ', 'T', $value);
}

function history_ensure_tables(PDO $db): void {
    static $done = false;
    if ($done) return;

    try {
        $db->exec("CREATE TABLE IF NOT EXISTS `notion_tab_revisions` (
            `id` VARCHAR(64) NOT NULL,
            `tab_id` VARCHAR(128) NOT NULL,
            `revision_num` INT NOT NULL,
            `user_id` VARCHAR(64) NOT NULL DEFAULT '',
            `user_name` VARCHAR(128) NOT NULL DEFAULT '',
            `kind` ENUM('auto','manual','pre_destructive') NOT NULL DEFAULT 'auto',
            `label` VARCHAR(255) NOT NULL DEFAULT '',
            `pinned` TINYINT(1) NOT NULL DEFAULT 0,
            `row_count` INT NOT NULL DEFAULT 0,
            `content_hash` CHAR(64) NOT NULL DEFAULT '',
            `tasks_json` LONGTEXT NOT NULL,
            `columns_json` LONGTEXT NOT NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_tab_created` (`tab_id`, `created_at` DESC),
            KEY `idx_tab_num` (`tab_id`, `revision_num` DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        $db->exec("CREATE TABLE IF NOT EXISTS `notion_tab_audit` (
            `id` BIGINT NOT NULL AUTO_INCREMENT,
            `tab_id` VARCHAR(128) NOT NULL,
            `user_id` VARCHAR(64) NOT NULL DEFAULT '',
            `user_name` VARCHAR(128) NOT NULL DEFAULT '',
            `action` VARCHAR(64) NOT NULL,
            `summary` VARCHAR(255) NOT NULL DEFAULT '',
            `meta_json` JSON NULL,
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_audit_tab_created` (`tab_id`, `created_at` DESC)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    } catch (Throwable $e) {
        // Sin permiso CREATE: asumir que las tablas ya existen o el historial está deshabilitado.
        error_log('notion history ensure_tables: ' . $e->getMessage());
    }

    $done = true;
}

function history_load_user_tabs(PDO $db, string $userId): array {
    $stmt = $db->prepare('SELECT `tabs` FROM `notion_tabs` WHERE `user_id` = ? LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return [];
    $tabs = json_decode($row['tabs'], true);
    return is_array($tabs) ? $tabs : [];
}

function history_get_accessible_tab_ids(PDO $db, string $userId): array {
    $userId = history_safe_id($userId);
    if (!$userId) return [];

    $ids = [];
    foreach (history_load_user_tabs($db, $userId) as $tab) {
        if (!empty($tab['id'])) {
            $ids[history_safe_id($tab['id'])] = true;
        }
    }

    $stmt = $db->prepare(
        'SELECT DISTINCT ns.tab_id
         FROM notion_shares ns
         WHERE ns.shared_with_id = ? AND ns.status = "accepted"'
    );
    try {
        $stmt->execute([$userId]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            if (!empty($row['tab_id'])) {
                $ids[history_safe_id($row['tab_id'])] = true;
            }
        }
    } catch (Throwable $e) {
        // notion_shares puede no existir en instalaciones antiguas
        error_log('notion history shares: ' . $e->getMessage());
    }

    return array_keys($ids);
}

function history_user_can_access_tab(PDO $db, string $userId, string $tabId): bool {
    $tabId = history_safe_id($tabId);
    $userId = history_safe_id($userId);
    if (!$tabId || !$userId) return false;
    return in_array($tabId, history_get_accessible_tab_ids($db, $userId), true);
}

function history_prepare_heavy(): void {
    @ini_set('memory_limit', '512M');
    @set_time_limit(120);
}

function history_load_tasks(PDO $db, string $tabId): array {
    history_prepare_heavy();
    $stmt = $db->prepare('SELECT `tasks` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return [];
    $decoded = json_decode($row['tasks'], true);
    return is_array($decoded) ? $decoded : [];
}

function history_save_tasks(PDO $db, string $tabId, array $tasks): void {
    history_prepare_heavy();
    $json = json_encode($tasks, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) {
        throw new RuntimeException('No se pudieron serializar las tareas.');
    }
    $db->prepare('INSERT INTO `notion_tasks` (`tab_id`,`tasks`) VALUES (?,?)
                  ON DUPLICATE KEY UPDATE `tasks`=VALUES(`tasks`)')
       ->execute([$tabId, $json]);
}

function history_load_columns(PDO $db, string $tabId): array {
    $stmt = $db->prepare('SELECT `base_columns`,`custom_columns` FROM `notion_columns` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return ['baseColumns' => [], 'customColumns' => []];
    }
    return [
        'baseColumns'   => json_decode($row['base_columns'], true) ?: [],
        'customColumns' => json_decode($row['custom_columns'], true) ?: [],
    ];
}

function history_save_columns(PDO $db, string $tabId, array $columns): void {
    $db->prepare('INSERT INTO `notion_columns` (`tab_id`,`base_columns`,`custom_columns`) VALUES (?,?,?)
                  ON DUPLICATE KEY UPDATE `base_columns`=VALUES(`base_columns`),`custom_columns`=VALUES(`custom_columns`)')
       ->execute([
           $tabId,
           json_encode($columns['baseColumns'] ?? [], JSON_UNESCAPED_UNICODE),
           json_encode($columns['customColumns'] ?? [], JSON_UNESCAPED_UNICODE),
       ]);
}

function history_attachments_lib_loaded(): void {
    static $loaded = false;
    if ($loaded) {
        return;
    }
    require_once __DIR__ . '/notion-attachments-lib.php';
    $loaded = true;
}

function history_revision_attachments_dir(string $tabId, string $revisionId): string {
    history_attachments_lib_loaded();
    $base = notion_primary_data_root() . '/notion-history-attachments';
    $dir = $base . '/' . history_safe_id($tabId) . '/' . history_safe_id($revisionId);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function history_revision_attachment_bases(string $tabId): array {
    history_attachments_lib_loaded();
    $bases = [];
    foreach (notion_data_root_candidates() as $root) {
        $base = $root . '/notion-history-attachments/' . history_safe_id($tabId);
        if (is_dir($base)) {
            $bases[] = $base;
        }
    }
    $primary = notion_primary_data_root() . '/notion-history-attachments/' . history_safe_id($tabId);
    if (!in_array($primary, $bases, true)) {
        $bases[] = $primary;
    }
    return $bases;
}

function history_find_attachment_revision_dir(string $tabId, string $attachmentId, string $preferredRevisionId = ''): ?string {
    $safeId = history_safe_id($attachmentId);
    if ($safeId === '') {
        return null;
    }
    if ($preferredRevisionId !== '') {
        $preferredDir = history_revision_attachments_dir($tabId, $preferredRevisionId);
        if (is_file($preferredDir . '/' . $safeId . '.bin')) {
            return $preferredDir;
        }
    }
    foreach (history_revision_attachment_bases($tabId) as $tabBase) {
        foreach (scandir($tabBase) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $dir = $tabBase . '/' . $entry;
            if (!is_dir($dir)) {
                continue;
            }
            if (is_file($dir . '/' . $safeId . '.bin')) {
                return $dir;
            }
        }
    }
    return null;
}

function history_copy_attachment_from_resolved(string $srcDir, string $destDir, string $attachmentId): bool {
    $safeId = history_safe_id($attachmentId);
    if ($safeId === '') {
        return false;
    }
    if (!is_dir($destDir)) {
        mkdir($destDir, 0755, true);
    }
    $bin = rtrim($srcDir, '/\\') . '/' . $safeId . '.bin';
    if (!is_file($bin)) {
        return false;
    }
    if (@copy($bin, $destDir . '/' . $safeId . '.bin') === false) {
        return false;
    }
    $meta = rtrim($srcDir, '/\\') . '/' . $safeId . '.json';
    if (is_file($meta)) {
        @copy($meta, $destDir . '/' . $safeId . '.json');
    }
    return true;
}

function history_copy_attachment_from_live(string $tabId, string $destDir, string $attachmentId): bool {
    history_attachments_lib_loaded();
    $resolved = notion_resolve_attachment_paths($tabId, $attachmentId);
    if ($resolved === null) {
        return false;
    }
    return history_copy_attachment_from_resolved($resolved['tabDir'], $destDir, $attachmentId);
}

function history_iter_task_attachment_items(array $tasks, callable $fn): void {
    history_attachments_lib_loaded();
    foreach ($tasks as $task) {
        if (!is_array($task)) {
            continue;
        }
        foreach ($task as $value) {
            if (!is_array($value) || !notion_is_attachment_field($value)) {
                continue;
            }
            foreach ($value as $item) {
                if (is_array($item)) {
                    $fn($item);
                }
            }
        }
    }
}

function history_copy_attachment_files(string $srcDir, string $destDir, string $attachmentId): bool {
    return history_copy_attachment_from_resolved($srcDir, $destDir, $attachmentId);
}

function history_save_revision_attachment_bytes(string $destDir, string $attachmentId, string $bytes, string $mime): void {
    $safeId = history_safe_id($attachmentId);
    if ($safeId === '') {
        return;
    }
    $meta = [
        'id' => $safeId,
        'type' => $mime,
        'size' => strlen($bytes),
    ];
    file_put_contents($destDir . '/' . $safeId . '.bin', $bytes, LOCK_EX);
    file_put_contents(
        $destDir . '/' . $safeId . '.json',
        json_encode($meta, JSON_UNESCAPED_UNICODE) ?: '{}',
        LOCK_EX
    );
}

function history_backup_revision_attachments(string $tabId, string $revisionId, array $tasks): void {
    history_attachments_lib_loaded();
    $destDir = history_revision_attachments_dir($tabId, $revisionId);
    $seen = [];

    history_iter_task_attachment_items($tasks, function (array $item) use ($tabId, $destDir, &$seen) {
        $id = history_safe_id((string)($item['id'] ?? ''));
        if ($id === '') {
            $id = notion_generate_attachment_id();
        }
        if (isset($seen[$id])) {
            return;
        }
        $seen[$id] = true;

        if (!empty($item['dataUrl']) && is_string($item['dataUrl'])) {
            $parsed = notion_parse_data_url($item['dataUrl']);
            if ($parsed !== null) {
                $type = !empty($item['type']) ? (string)$item['type'] : $parsed['type'];
                history_save_revision_attachment_bytes($destDir, $id, $parsed['bytes'], $type);
            }
            return;
        }

        history_copy_attachment_from_live($tabId, $destDir, $id);
    });
}

function history_restore_revision_attachments(string $tabId, string $revisionId, array $tasks): array {
    history_attachments_lib_loaded();
    $preferredDir = history_revision_attachments_dir($tabId, $revisionId);
    $destDir = notion_attachments_tab_dir($tabId, true);

    $out = [];
    foreach ($tasks as $task) {
        if (!is_array($task)) {
            $out[] = $task;
            continue;
        }
        $copy = $task;
        foreach ($copy as $key => $value) {
            if (!is_array($value) || !notion_is_attachment_field($value)) {
                continue;
            }
            $next = [];
            foreach ($value as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $id = history_safe_id((string)($item['id'] ?? ''));
                if ($id !== '') {
                    $srcDir = is_file($preferredDir . '/' . $id . '.bin')
                        ? $preferredDir
                        : (history_find_attachment_revision_dir($tabId, $id, $revisionId) ?? $preferredDir);
                    history_copy_attachment_from_resolved($srcDir, $destDir, $id);
                    if (notion_attachment_exists($tabId, $id)) {
                        notion_migrate_attachment_to_primary($tabId, $id);
                        $item['url'] = notion_attachment_public_url($tabId, $id);
                        unset($item['dataUrl']);
                    }
                }
                $next[] = $item;
            }
            $copy[$key] = $next;
        }
        $out[] = $copy;
    }
    return $out;
}

function history_delete_revision_attachments(string $tabId, string $revisionId): void {
    $dir = history_revision_attachments_dir($tabId, $revisionId);
    if (!is_dir($dir)) {
        return;
    }
    foreach (glob($dir . '/*') ?: [] as $file) {
        if (is_file($file)) {
            @unlink($file);
        }
    }
    @rmdir($dir);
}

function history_attachment_has_payload(array $item): bool {
    return !empty($item['dataUrl']) || !empty($item['url']) || !empty($item['hasData']);
}

function history_strip_attachment_item(array $item): array {
    $out = [
        'name' => $item['name'] ?? '',
        'type' => $item['type'] ?? 'application/octet-stream',
        'size' => (int)($item['size'] ?? 0),
    ];
    $id = history_safe_id((string)($item['id'] ?? ''));
    if ($id !== '') {
        $out['id'] = $id;
    }
    if (!empty($item['url']) && is_string($item['url'])) {
        $out['url'] = (string)$item['url'];
    }
    if (!empty($item['dataUrl']) && is_string($item['dataUrl'])) {
        $out['hasData'] = true;
    } elseif (!empty($item['hasData'])) {
        $out['hasData'] = true;
    }
    return $out;
}

function history_strip_tasks_for_revision(array $tasks): array {
    $out = [];
    foreach ($tasks as $task) {
        if (!is_array($task)) continue;
        $copy = $task;
        foreach ($copy as $key => $value) {
            if (!is_array($value)) continue;
            $isAttachmentField = false;
            foreach ($value as $item) {
                if (is_array($item) && (isset($item['dataUrl']) || isset($item['name']))) {
                    $isAttachmentField = true;
                    break;
                }
            }
            if ($isAttachmentField) {
                $copy[$key] = array_values(array_map(
                    fn($item) => is_array($item) ? history_strip_attachment_item($item) : $item,
                    $value
                ));
            }
        }
        $out[] = $copy;
    }
    return $out;
}

function history_content_hash(array $tasks, array $columns): string {
    $payload = json_encode([
        'tasks'   => history_strip_tasks_for_revision($tasks),
        'columns' => $columns,
    ], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    return hash('sha256', $payload ?: '');
}

function history_generate_revision_id(): string {
    return 'rev_' . (int)(microtime(true) * 1000) . '_' . substr(bin2hex(random_bytes(4)), 0, 6);
}

function history_next_revision_num(PDO $db, string $tabId): int {
    $stmt = $db->prepare('SELECT COALESCE(MAX(`revision_num`), 0) + 1 AS n FROM `notion_tab_revisions` WHERE `tab_id` = ?');
    $stmt->execute([$tabId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return (int)($row['n'] ?? 1);
}

function history_log_audit(
    PDO $db,
    string $tabId,
    string $userId,
    string $userName,
    string $action,
    string $summary,
    array $meta = []
): array {
    history_ensure_tables($db);
    $stmt = $db->prepare(
        'INSERT INTO `notion_tab_audit` (`tab_id`,`user_id`,`user_name`,`action`,`summary`,`meta_json`)
         VALUES (?,?,?,?,?,?)'
    );
    $stmt->execute([
        $tabId,
        history_safe_id($userId),
        mb_substr($userName, 0, 128),
        mb_substr($action, 0, 64),
        mb_substr($summary, 0, 255),
        $meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : null,
    ]);
    $id = (int)$db->lastInsertId();
    history_prune_audit($db, $tabId);
    return history_format_audit_row([
        'id'         => $id,
        'tab_id'     => $tabId,
        'user_id'    => $userId,
        'user_name'  => $userName,
        'action'     => $action,
        'summary'    => $summary,
        'meta_json'  => $meta ? json_encode($meta, JSON_UNESCAPED_UNICODE) : null,
        'created_at' => date('Y-m-d H:i:s'),
    ]);
}

function history_format_audit_row(array $row): array {
    $meta = null;
    if (!empty($row['meta_json'])) {
        $decoded = json_decode($row['meta_json'], true);
        $meta = is_array($decoded) ? $decoded : null;
    }
    $createdAt = history_mysql_datetime_to_iso($row['created_at'] ?? date('Y-m-d H:i:s'));
    return [
        'id'        => (int)$row['id'],
        'tabId'     => $row['tab_id'],
        'userId'    => $row['user_id'],
        'userName'  => $row['user_name'],
        'action'    => $row['action'],
        'summary'   => $row['summary'],
        'meta'      => $meta,
        'createdAt' => $createdAt,
    ];
}

function history_format_revision_summary(array $row, bool $includePayload = false): array {
    $createdAt = history_mysql_datetime_to_iso($row['created_at'] ?? date('Y-m-d H:i:s'));
    $item = [
        'id'           => $row['id'],
        'tabId'        => $row['tab_id'],
        'revisionNum'  => (int)$row['revision_num'],
        'userId'       => $row['user_id'],
        'userName'     => $row['user_name'],
        'kind'         => $row['kind'],
        'label'        => $row['label'],
        'pinned'       => (bool)$row['pinned'],
        'rowCount'     => (int)$row['row_count'],
        'contentHash'  => $row['content_hash'],
        'createdAt'    => $createdAt,
    ];
    if ($includePayload) {
        $item['tasks'] = json_decode($row['tasks_json'], true) ?: [];
        $item['columns'] = json_decode($row['columns_json'], true) ?: ['baseColumns' => [], 'customColumns' => []];
    }
    return $item;
}

function history_create_revision(
    PDO $db,
    string $tabId,
    string $userId,
    string $userName,
    string $kind,
    string $label,
    array $tasks,
    array $columns,
    bool $pinned = false,
    bool $skipDuplicateHash = true
): ?array {
    history_ensure_tables($db);
    $tabId = history_safe_id($tabId);
    if (!$tabId) return null;

    $strippedTasks = history_strip_tasks_for_revision($tasks);
    $hash = history_content_hash($tasks, $columns);

    if ($skipDuplicateHash) {
        $stmt = $db->prepare(
            'SELECT `content_hash` FROM `notion_tab_revisions` WHERE `tab_id` = ? ORDER BY `created_at` DESC LIMIT 1'
        );
        $stmt->execute([$tabId]);
        $last = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($last && ($last['content_hash'] ?? '') === $hash) {
            return null;
        }
    }

    // No guardar estado vacío como revisión (protección anti-borrado accidental)
    if (count($strippedTasks) === 0 && $kind !== 'pre_destructive') {
        return null;
    }

    $id = history_generate_revision_id();
    $num = history_next_revision_num($db, $tabId);
    $tasksJson = json_encode($strippedTasks, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    $columnsJson = json_encode($columns, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($tasksJson === false || $columnsJson === false) {
        throw new RuntimeException('No se pudo serializar la revisión.');
    }

    $stmt = $db->prepare(
        'INSERT INTO `notion_tab_revisions`
         (`id`,`tab_id`,`revision_num`,`user_id`,`user_name`,`kind`,`label`,`pinned`,`row_count`,`content_hash`,`tasks_json`,`columns_json`)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    $stmt->execute([
        $id,
        $tabId,
        $num,
        history_safe_id($userId),
        mb_substr($userName, 0, 128),
        in_array($kind, ['auto', 'manual', 'pre_destructive'], true) ? $kind : 'auto',
        mb_substr($label, 0, 255),
        $pinned ? 1 : 0,
        count($strippedTasks),
        $hash,
        $tasksJson,
        $columnsJson,
    ]);

    history_prune_revisions($db, $tabId);

    $stmt = $db->prepare('SELECT * FROM `notion_tab_revisions` WHERE `id` = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        history_backup_revision_attachments($tabId, $id, $tasks);
    }
    return $row ? history_format_revision_summary($row) : null;
}

function history_create_snapshot_from_live(
    PDO $db,
    string $tabId,
    string $userId,
    string $userName,
    string $kind,
    string $label
): ?array {
    $tasks = history_load_tasks($db, $tabId);
    $columns = history_load_columns($db, $tabId);
    return history_create_revision($db, $tabId, $userId, $userName, $kind, $label, $tasks, $columns);
}

function history_create_pre_destructive(
    PDO $db,
    string $tabId,
    string $userId,
    string $userName,
    int $beforeCount,
    int $deleteCount
): ?array {
    $label = "Antes de eliminar {$deleteCount} fila(s)";
    $revision = history_create_snapshot_from_live($db, $tabId, $userId, $userName, 'pre_destructive', $label);
    history_log_audit($db, $tabId, $userId, $userName, 'pre_bulk_delete', $label, [
        'beforeCount' => $beforeCount,
        'deleteCount' => $deleteCount,
    ]);
    return $revision;
}

function history_maybe_auto_revision(PDO $db, string $tabId, string $userId, string $userName): ?array {
    @ini_set('memory_limit', '512M');
    @set_time_limit(120);
    try {
        history_ensure_tables($db);
        $stmt = $db->prepare(
            'SELECT `created_at` FROM `notion_tab_revisions`
             WHERE `tab_id` = ? AND `kind` = "auto"
             ORDER BY `created_at` DESC LIMIT 1'
        );
        $stmt->execute([$tabId]);
        $last = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($last && !empty($last['created_at'])) {
            $lastTs = strtotime($last['created_at']);
            if ($lastTs && (time() - $lastTs) < HISTORY_AUTO_MIN_INTERVAL_SEC) {
                return null;
            }
        }
        $revision = history_create_snapshot_from_live($db, $tabId, $userId, $userName, 'auto', 'Revisión automática estable');
        if ($revision) {
            history_log_audit($db, $tabId, $userId, $userName, 'auto_revision', 'Revisión automática guardada', [
                'revisionId' => $revision['id'],
                'revisionNum' => $revision['revisionNum'],
            ]);
        }
        return $revision;
    } catch (Throwable $e) {
        error_log('notion history auto_revision: ' . $e->getMessage());
        return null;
    }
}

function history_merge_attachments_from_live(array $revisionTasks, array $liveTasks): array {
    $liveById = [];
    foreach ($liveTasks as $task) {
        if (!empty($task['id'])) {
            $liveById[$task['id']] = $task;
        }
    }

    $merged = [];
    foreach ($revisionTasks as $task) {
        if (!is_array($task)) continue;
        $copy = $task;
        $liveTask = !empty($task['id']) ? ($liveById[$task['id']] ?? null) : null;
        if (!$liveTask) {
            $merged[] = $copy;
            continue;
        }
        foreach ($copy as $key => $value) {
            if (!is_array($value)) continue;
            $liveValue = $liveTask[$key] ?? null;
            if (!is_array($liveValue)) continue;
            $liveByKey = [];
            $liveById = [];
            foreach ($liveValue as $item) {
                if (!is_array($item)) continue;
                $k = ($item['name'] ?? '') . '|' . ($item['size'] ?? 0);
                if (history_attachment_has_payload($item) || !empty($item['id'])) {
                    $liveByKey[$k] = $item;
                    if (!empty($item['id'])) {
                        $liveById[(string)$item['id']] = $item;
                    }
                }
            }
            $restored = [];
            foreach ($value as $item) {
                if (!is_array($item)) continue;
                if (!empty($item['dataUrl']) || !empty($item['url'])) {
                    $restored[] = $item;
                    continue;
                }
                $id = !empty($item['id']) ? (string)$item['id'] : '';
                if ($id !== '' && isset($liveById[$id])) {
                    $restored[] = $liveById[$id];
                    continue;
                }
                $k = ($item['name'] ?? '') . '|' . ($item['size'] ?? 0);
                if (isset($liveByKey[$k])) {
                    $restored[] = $liveByKey[$k];
                } else {
                    $restored[] = $item;
                }
            }
            $copy[$key] = $restored;
        }
        $merged[] = $copy;
    }
    return $merged;
}

function history_repair_live_attachments_for_tab(PDO $db, string $tabId): void {
    history_attachments_lib_loaded();
    $tasks = history_load_tasks($db, $tabId);
    $destDir = notion_attachments_tab_dir($tabId, true);
    $changed = false;

    foreach ($tasks as &$task) {
        if (!is_array($task)) {
            continue;
        }
        foreach ($task as $key => &$value) {
            if (!is_array($value) || !notion_is_attachment_field($value)) {
                continue;
            }
            foreach ($value as &$item) {
                if (!is_array($item)) {
                    continue;
                }
                $id = history_safe_id((string)($item['id'] ?? ''));
                if ($id === '') {
                    continue;
                }
                if (!notion_attachment_exists($tabId, $id)) {
                    $srcDir = history_find_attachment_revision_dir($tabId, $id);
                    if ($srcDir) {
                        history_copy_attachment_from_resolved($srcDir, $destDir, $id);
                    }
                    if (!notion_attachment_exists($tabId, $id)) {
                        notion_try_recover_attachment($tabId, $id);
                    }
                }
                if (notion_attachment_exists($tabId, $id)) {
                    notion_migrate_attachment_to_primary($tabId, $id);
                    $nextUrl = notion_attachment_public_url($tabId, $id);
                    if (($item['url'] ?? '') !== $nextUrl) {
                        $item['url'] = $nextUrl;
                        unset($item['dataUrl']);
                        $changed = true;
                    }
                }
            }
            unset($item);
        }
        unset($value);
    }
    unset($task);

    if ($changed) {
        history_save_tasks($db, $tabId, $tasks);
    }
}

function history_apply_revision(PDO $db, string $tabId, string $revisionId, string $userId, string $userName, bool $skipAccessCheck = false): array {
    history_ensure_tables($db);
    if (!$skipAccessCheck && !history_user_can_access_tab($db, $userId, $tabId)) {
        throw new RuntimeException('Sin acceso a esta tabla');
    }

    $stmt = $db->prepare('SELECT * FROM `notion_tab_revisions` WHERE `id` = ? AND `tab_id` = ? LIMIT 1');
    $stmt->execute([history_safe_id($revisionId), history_safe_id($tabId)]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new RuntimeException('Revisión no encontrada');
    }

    $revisionTasks = json_decode($row['tasks_json'], true) ?: [];
    $revisionColumns = json_decode($row['columns_json'], true) ?: ['baseColumns' => [], 'customColumns' => []];

    if (count($revisionTasks) === 0) {
        throw new RuntimeException('Esta revisión está vacía y no se puede aplicar (protección de datos).');
    }

    $liveTasks = history_load_tasks($db, $tabId);
    $liveCount = count($liveTasks);

    // Backup del estado actual solo si tiene filas
    if ($liveCount > 0) {
        history_create_snapshot_from_live($db, $tabId, $userId, $userName, 'manual', 'Antes de restaurar #' . $row['revision_num']);
    }
    $restoredTasks = history_merge_attachments_from_live($revisionTasks, $liveTasks);
    $restoredTasks = history_restore_revision_attachments($tabId, $revisionId, $restoredTasks);

    history_save_tasks($db, $tabId, $restoredTasks);
    history_save_columns($db, $tabId, $revisionColumns);
    history_repair_live_attachments_for_tab($db, $tabId);

    // Verificar que el guardado refleja la revisión aplicada
    $savedCount = count(history_load_tasks($db, $tabId));
    if ($savedCount !== count($restoredTasks)) {
        throw new RuntimeException('No se pudo guardar la revisión (filas guardadas: ' . $savedCount . ', esperadas: ' . count($restoredTasks) . ')');
    }

    history_log_audit($db, $tabId, $userId, $userName, 'apply_revision', 'Restauró revisión #' . $row['revision_num'], [
        'revisionId' => $revisionId,
        'revisionNum' => (int)$row['revision_num'],
    ]);

    return [
        'tasks'   => $restoredTasks,
        'columns' => $revisionColumns,
    ];
}

function history_list_revisions(PDO $db, string $userId, ?string $tabId = null, int $limit = 50): array {
    history_ensure_tables($db);
    $accessible = history_get_accessible_tab_ids($db, $userId);
    if (!$accessible) return [];

    if ($tabId) {
        $tabId = history_safe_id($tabId);
        if (!in_array($tabId, $accessible, true)) return [];
        $accessible = [$tabId];
    }

    try {
        $placeholders = implode(',', array_fill(0, count($accessible), '?'));
        $stmt = $db->prepare(
            "SELECT * FROM `notion_tab_revisions`
             WHERE `tab_id` IN ($placeholders)
             ORDER BY `created_at` DESC
             LIMIT " . (int)$limit
        );
        $stmt->execute($accessible);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        return array_map(fn($r) => history_format_revision_summary($r), $rows);
    } catch (Throwable $e) {
        error_log('notion history list_revisions: ' . $e->getMessage());
        return [];
    }
}

function history_list_audit(PDO $db, string $userId, ?string $tabId = null, int $limit = 80): array {
    history_ensure_tables($db);
    $accessible = history_get_accessible_tab_ids($db, $userId);
    if (!$accessible) return [];

    if ($tabId) {
        $tabId = history_safe_id($tabId);
        if (!in_array($tabId, $accessible, true)) return [];
        $accessible = [$tabId];
    }

    try {
        $placeholders = implode(',', array_fill(0, count($accessible), '?'));
        $stmt = $db->prepare(
            "SELECT * FROM `notion_tab_audit`
             WHERE `tab_id` IN ($placeholders)
             ORDER BY `created_at` DESC
             LIMIT " . (int)$limit
        );
        $stmt->execute($accessible);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        return array_map(fn($r) => history_format_audit_row($r), $rows);
    } catch (Throwable $e) {
        error_log('notion history list_audit: ' . $e->getMessage());
        return [];
    }
}

function history_get_revision(PDO $db, string $userId, string $tabId, string $revisionId): ?array {
    if (!history_user_can_access_tab($db, $userId, $tabId)) {
        return null;
    }
    $stmt = $db->prepare('SELECT * FROM `notion_tab_revisions` WHERE `id` = ? AND `tab_id` = ? LIMIT 1');
    $stmt->execute([history_safe_id($revisionId), history_safe_id($tabId)]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ? history_format_revision_summary($row, true) : null;
}

function history_prune_revisions(PDO $db, string $tabId): void {
    $stmt = $db->prepare(
        'SELECT `id`, `kind`, `pinned`, `created_at`
         FROM `notion_tab_revisions`
         WHERE `tab_id` = ?
         ORDER BY `created_at` DESC'
    );
    $stmt->execute([$tabId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
    if (count($rows) <= HISTORY_MAX_REVISIONS) return;

    $cutoff = time() - 7 * 86400;
    $toDelete = [];
    $kept = 0;
    foreach ($rows as $row) {
        $isProtected = ((int)$row['pinned'] === 1)
            || ($row['kind'] === 'pre_destructive' && strtotime($row['created_at']) > $cutoff)
            || ($row['kind'] === 'manual');
        if ($kept < HISTORY_MAX_REVISIONS || $isProtected) {
            $kept++;
            continue;
        }
        $toDelete[] = $row['id'];
    }

    if (!$toDelete) return;
    foreach ($toDelete as $revisionId) {
        history_delete_revision_attachments($tabId, $revisionId);
    }
    $placeholders = implode(',', array_fill(0, count($toDelete), '?'));
    $del = $db->prepare("DELETE FROM `notion_tab_revisions` WHERE `id` IN ($placeholders)");
    $del->execute($toDelete);
}

function history_prune_audit(PDO $db, string $tabId): void {
    $stmt = $db->prepare('SELECT COUNT(*) FROM `notion_tab_audit` WHERE `tab_id` = ?');
    $stmt->execute([$tabId]);
    $count = (int)$stmt->fetchColumn();
    if ($count <= HISTORY_MAX_AUDIT) return;

    $excess = $count - HISTORY_MAX_AUDIT;
    $db->prepare(
        'DELETE FROM `notion_tab_audit`
         WHERE `tab_id` = ?
         ORDER BY `created_at` ASC
         LIMIT ' . (int)$excess
    )->execute([$tabId]);
}

function history_get_tab_titles(PDO $db, string $userId): array {
    $map = [];
    foreach (history_load_user_tabs($db, $userId) as $tab) {
        if (!empty($tab['id'])) {
            $map[history_safe_id($tab['id'])] = $tab['title'] ?? 'Sin título';
        }
    }
    return $map;
}

function history_restore_latest_nonempty(PDO $db, string $tabId, string $userId, string $userName): ?array {
    history_ensure_tables($db);
    if (!history_user_can_access_tab($db, $userId, $tabId)) {
        throw new RuntimeException('Sin acceso a esta tabla');
    }

    $liveCount = count(history_load_tasks($db, $tabId));
    if ($liveCount > 0) {
        return null; // Ya tiene datos, no hace falta
    }

    $stmt = $db->prepare(
        'SELECT * FROM `notion_tab_revisions`
         WHERE `tab_id` = ? AND `row_count` > 0
         ORDER BY `created_at` DESC
         LIMIT 1'
    );
    $stmt->execute([history_safe_id($tabId)]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return null;
    }

    return history_apply_revision($db, $tabId, $row['id'], $userId, $userName);
}

function history_log_task_action(
    PDO $db,
    string $tabId,
    string $userId,
    string $userName,
    string $method,
    array $body = []
): void {
    if (!$userId) return;
    switch ($method) {
        case 'POST':
            $action = 'task_create';
            $summary = 'Creó una fila';
            break;
        case 'PUT':
            $action = 'task_update';
            $summary = 'Editó una fila';
            break;
        case 'DELETE':
            $action = 'task_delete';
            $summary = 'Eliminó una fila';
            break;
        default:
            $action = 'task_change';
            $summary = 'Cambió tareas';
            break;
    }
    $meta = [];
    if (!empty($body['id'])) {
        $meta['taskId'] = $body['id'];
    }
    history_log_audit($db, $tabId, $userId, $userName, $action, $summary, $meta);
}
