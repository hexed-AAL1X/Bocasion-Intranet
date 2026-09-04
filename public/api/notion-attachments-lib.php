<?php
declare(strict_types=1);

/**
 * Almacenamiento persistente FUERA de out/ para sobrevivir deploys.
 * Desde out/api → ../.. = carpeta padre de out (ej. public_html/.bocasion-data)
 */
function notion_primary_data_root(): string {
    $preferred = dirname(__DIR__, 2) . '/.bocasion-data';
    if (!is_dir($preferred)) {
        mkdir($preferred, 0775, true);
    }
    $real = realpath($preferred);
    return $real !== false ? $real : $preferred;
}

/** Rutas legadas donde pueden quedar adjuntos de deploys anteriores. */
function notion_data_root_candidates(): array {
    $roots = [notion_primary_data_root()];

    $outData = dirname(__DIR__) . '/data';
    if (is_dir($outData)) {
        $real = realpath($outData);
        $roots[] = $real !== false ? $real : $outData;
    }

    $legacy = dirname(__DIR__, 2) . '/.data';
    if (is_dir($legacy)) {
        $real = realpath($legacy);
        $roots[] = $real !== false ? $real : $legacy;
    }

    return array_values(array_unique($roots));
}

function notion_attachments_root(): string {
    $dir = notion_primary_data_root() . '/notion-attachments';
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function notion_attachments_roots_for_read(): array {
    $roots = [];
    foreach (notion_data_root_candidates() as $dataRoot) {
        $dir = $dataRoot . '/notion-attachments';
        if (is_dir($dir)) {
            $real = realpath($dir);
            $roots[] = $real !== false ? $real : $dir;
        }
    }
    if (!$roots) {
        $roots[] = notion_attachments_root();
    }
    return array_values(array_unique($roots));
}

function notion_attachments_tab_dir(string $tabId, bool $forWrite = true): string {
    $safe = preg_replace('/[^a-zA-Z0-9_\-]/', '', $tabId);
    $root = $forWrite ? notion_attachments_root() : notion_attachments_roots_for_read()[0];
    $dir = $root . '/' . $safe;
    if ($forWrite && !is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function notion_resolve_attachment_paths(string $tabId, string $attachmentId): ?array {
    $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId);
    $safeTab = preg_replace('/[^a-zA-Z0-9_\-]/', '', $tabId);
    if ($safeId === '' || $safeTab === '') {
        return null;
    }
    foreach (notion_attachments_roots_for_read() as $root) {
        $tabDir = $root . '/' . $safeTab;
        $binPath = $tabDir . '/' . $safeId . '.bin';
        if (!is_file($binPath)) {
            continue;
        }
        return [
            'bin' => $binPath,
            'meta' => $tabDir . '/' . $safeId . '.json',
            'tabDir' => $tabDir,
        ];
    }
    return null;
}

function notion_attachment_exists(string $tabId, string $attachmentId): bool {
    if (notion_resolve_attachment_paths($tabId, $attachmentId) !== null) {
        return true;
    }
    return notion_db_attachment_exists($tabId, $attachmentId);
}

function notion_migrate_attachment_to_primary(string $tabId, string $attachmentId): bool {
    $resolved = notion_resolve_attachment_paths($tabId, $attachmentId);
    if ($resolved === null) {
        return false;
    }
    $primaryTabDir = notion_attachments_tab_dir($tabId, true);
    $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId);
    $destBin = $primaryTabDir . '/' . $safeId . '.bin';
    if (is_file($destBin)) {
        return true;
    }
    if (@copy($resolved['bin'], $destBin) === false) {
        return false;
    }
    if (is_file($resolved['meta'])) {
        @copy($resolved['meta'], $primaryTabDir . '/' . $safeId . '.json');
    }
    return true;
}

function notion_db_loaded(): void {
    static $loaded = false;
    if ($loaded) {
        return;
    }
    require_once __DIR__ . '/db.php';
    $loaded = true;
}

function notion_db_ensure_attachments_table(PDO $db): void {
    static $done = false;
    if ($done) {
        return;
    }
    $db->exec("CREATE TABLE IF NOT EXISTS `notion_attachment_blobs` (
        `tab_id` VARCHAR(128) NOT NULL,
        `attachment_id` VARCHAR(64) NOT NULL,
        `name` VARCHAR(255) NOT NULL DEFAULT '',
        `mime` VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
        `size` INT NOT NULL DEFAULT 0,
        `bytes` LONGBLOB NOT NULL,
        `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (`tab_id`, `attachment_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $done = true;
}

function notion_db_save_attachment(string $tabId, string $attachmentId, string $bytes, string $mime, string $name = ''): void {
    notion_db_loaded();
    $db = get_db();
    notion_db_ensure_attachments_table($db);
    $safeTab = preg_replace('/[^a-zA-Z0-9_\-]/', '', $tabId);
    $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId);
    if ($safeTab === '' || $safeId === '') {
        return;
    }
    $stmt = $db->prepare(
        'INSERT INTO `notion_attachment_blobs` (`tab_id`,`attachment_id`,`name`,`mime`,`size`,`bytes`)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`mime`=VALUES(`mime`),`size`=VALUES(`size`),`bytes`=VALUES(`bytes`)'
    );
    $stmt->bindValue(1, $safeTab);
    $stmt->bindValue(2, $safeId);
    $stmt->bindValue(3, mb_substr($name, 0, 255));
    $stmt->bindValue(4, mb_substr($mime, 0, 128));
    $stmt->bindValue(5, strlen($bytes), PDO::PARAM_INT);
    $stmt->bindValue(6, $bytes, PDO::PARAM_LOB);
    $stmt->execute();
}

function notion_db_load_attachment(string $tabId, string $attachmentId): ?array {
    notion_db_loaded();
    $db = get_db();
    notion_db_ensure_attachments_table($db);
    $safeTab = preg_replace('/[^a-zA-Z0-9_\-]/', '', $tabId);
    $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId);
    if ($safeTab === '' || $safeId === '') {
        return null;
    }
    $stmt = $db->prepare(
        'SELECT `name`,`mime`,`size`,`bytes` FROM `notion_attachment_blobs`
         WHERE `tab_id` = ? AND `attachment_id` = ? LIMIT 1'
    );
    $stmt->execute([$safeTab, $safeId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || !isset($row['bytes'])) {
        return null;
    }
    return [
        'name' => (string)($row['name'] ?? ''),
        'type' => (string)($row['mime'] ?? 'application/octet-stream'),
        'size' => (int)($row['size'] ?? 0),
        'bytes' => is_string($row['bytes']) ? $row['bytes'] : (string)$row['bytes'],
    ];
}

function notion_db_attachment_exists(string $tabId, string $attachmentId): bool {
    return notion_db_load_attachment($tabId, $attachmentId) !== null;
}

function notion_find_revision_backup_dir(string $tabId, string $attachmentId): ?string {
    $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId);
    $safeTab = preg_replace('/[^a-zA-Z0-9_\-]/', '', $tabId);
    if ($safeId === '' || $safeTab === '') {
        return null;
    }
    foreach (notion_data_root_candidates() as $root) {
        $tabBase = $root . '/notion-history-attachments/' . $safeTab;
        if (!is_dir($tabBase)) {
            continue;
        }
        foreach (scandir($tabBase) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $dir = $tabBase . '/' . $entry;
            if (is_dir($dir) && is_file($dir . '/' . $safeId . '.bin')) {
                return $dir;
            }
        }
    }
    return null;
}

function notion_copy_from_dir(string $srcDir, string $destDir, string $attachmentId): bool {
    $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId);
    if ($safeId === '') {
        return false;
    }
    $bin = rtrim($srcDir, '/\\') . '/' . $safeId . '.bin';
    if (!is_file($bin)) {
        return false;
    }
    if (!is_dir($destDir)) {
        mkdir($destDir, 0755, true);
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

function notion_find_attachment_item_in_tasks(array $tasks, string $attachmentId): ?array {
    $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId);
    if ($safeId === '') {
        return null;
    }
    foreach ($tasks as $task) {
        if (!is_array($task)) {
            continue;
        }
        foreach ($task as $value) {
            if (!is_array($value) || !notion_is_attachment_field($value)) {
                continue;
            }
            foreach ($value as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $id = preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)($item['id'] ?? ''));
                if ($id === $safeId) {
                    return $item;
                }
            }
        }
    }
    return null;
}

/** Guarda en disco un adjunto a partir de su item (dataUrl). */
function notion_hydrate_attachment_from_item(string $tabId, string $attachmentId, array $item): bool {
    $dataUrl = $item['dataUrl'] ?? '';
    if (!is_string($dataUrl) || $dataUrl === '') {
        return false;
    }
    $parsed = notion_parse_data_url($dataUrl);
    if ($parsed === null) {
        return false;
    }
    $name = trim((string)($item['name'] ?? 'archivo'));
    $type = trim((string)($item['type'] ?? $parsed['type']));
    if ($type === '') {
        $type = $parsed['type'];
    }
    return notion_save_attachment_bytes($tabId, $attachmentId, $parsed['bytes'], $type, $name);
}

function notion_hydrate_from_live_tasks(string $tabId, string $attachmentId): bool {
    notion_db_loaded();
    $db = get_db();
    $safeTab = preg_replace('/[^a-zA-Z0-9_\-]/', '', $tabId);
    if ($safeTab === '') {
        return false;
    }
    $stmt = $db->prepare('SELECT `tasks` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$safeTab]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return false;
    }
    $tasks = json_decode((string)$row['tasks'], true);
    if (!is_array($tasks)) {
        return false;
    }
    $item = notion_find_attachment_item_in_tasks($tasks, $attachmentId);
    if ($item === null) {
        return false;
    }
    return notion_hydrate_attachment_from_item($tabId, $attachmentId, $item);
}

function notion_hydrate_from_revisions(string $tabId, string $attachmentId): bool {
    notion_db_loaded();
    $db = get_db();
    $safeTab = preg_replace('/[^a-zA-Z0-9_\-]/', '', $tabId);
    $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId);
    if ($safeTab === '' || $safeId === '') {
        return false;
    }
    $stmt = $db->prepare(
        'SELECT `tasks_json` FROM `notion_tab_revisions`
         WHERE `tab_id` = ? AND `tasks_json` LIKE ?
         ORDER BY `created_at` DESC LIMIT 20'
    );
    $stmt->execute([$safeTab, '%' . $safeId . '%']);
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $tasks = json_decode((string)($row['tasks_json'] ?? ''), true);
        if (!is_array($tasks)) {
            continue;
        }
        $item = notion_find_attachment_item_in_tasks($tasks, $safeId);
        if ($item !== null && notion_hydrate_attachment_from_item($tabId, $safeId, $item)) {
            return true;
        }
    }
    return false;
}

/** Intenta recuperar un adjunto desde revisiones o MySQL antes de devolver 404. */
function notion_try_recover_attachment(string $tabId, string $attachmentId): bool {
    if (notion_attachment_exists($tabId, $attachmentId)) {
        return true;
    }

    $destDir = notion_attachments_tab_dir($tabId, true);
    $backupDir = notion_find_revision_backup_dir($tabId, $attachmentId);
    if ($backupDir !== null) {
        notion_copy_from_dir($backupDir, $destDir, $attachmentId);
    }

    if (notion_resolve_attachment_paths($tabId, $attachmentId) !== null) {
        return true;
    }

    $dbRow = notion_db_load_attachment($tabId, $attachmentId);
    if ($dbRow !== null) {
        notion_save_attachment_bytes($tabId, $attachmentId, $dbRow['bytes'], $dbRow['type'], $dbRow['name']);
        return true;
    }

    if (notion_hydrate_from_live_tasks($tabId, $attachmentId)) {
        return true;
    }

    if (notion_hydrate_from_revisions($tabId, $attachmentId)) {
        return true;
    }

    return false;
}

function notion_generate_attachment_id(): string {
    return 'att_' . (int)(microtime(true) * 1000) . '_' . substr(bin2hex(random_bytes(4)), 0, 7);
}

function notion_parse_data_url(string $dataUrl): ?array {
    if (!preg_match('#^data:([^;]+);base64,(.+)$#s', $dataUrl, $matches)) {
        return null;
    }
    $bytes = base64_decode($matches[2], true);
    if ($bytes === false) {
        return null;
    }
    return [
        'type' => $matches[1] !== '' ? $matches[1] : 'application/octet-stream',
        'bytes' => $bytes,
    ];
}

function notion_attachment_public_url(string $tabId, string $attachmentId): string {
    return '/api/notion-attachments.php?tabId=' . rawurlencode($tabId) . '&id=' . rawurlencode($attachmentId);
}

function notion_save_attachment_bytes(string $tabId, string $attachmentId, string $bytes, string $mime, string $name = ''): bool {
    $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId);
    $safeTab = preg_replace('/[^a-zA-Z0-9_\-]/', '', $tabId);
    if ($safeId === '' || $safeTab === '') {
        return false;
    }
    $meta = [
        'id' => $safeId,
        'tabId' => $tabId,
        'type' => $mime,
        'size' => strlen($bytes),
        'name' => $name,
    ];

    $dbSaved = false;
    try {
        notion_db_save_attachment($tabId, $safeId, $bytes, $mime, $name);
        $dbSaved = true;
    } catch (Throwable $e) {
        error_log('notion attachment db save: ' . $e->getMessage());
    }

    $dir = notion_attachments_tab_dir($tabId);
    $binPath = $dir . '/' . $safeId . '.bin';
    $metaPath = $dir . '/' . $safeId . '.json';
    $diskSaved = false;
    if (file_put_contents($binPath, $bytes, LOCK_EX) !== false) {
        $json = json_encode($meta, JSON_UNESCAPED_UNICODE);
        if ($json !== false && file_put_contents($metaPath, $json, LOCK_EX) !== false) {
            $diskSaved = true;
        } else {
            @unlink($binPath);
        }
    }

    return $dbSaved || $diskSaved;
}

function notion_persist_attachment_item(string $tabId, array $item): array {
    $name = trim((string)($item['name'] ?? 'archivo'));
    $type = trim((string)($item['type'] ?? 'application/octet-stream'));
    $size = (int)($item['size'] ?? 0);
    $id = trim((string)($item['id'] ?? ''));
    if ($id === '') {
        $id = notion_generate_attachment_id();
    }

    if (!empty($item['url']) && empty($item['dataUrl'])) {
        if (!notion_attachment_exists($tabId, $id)) {
            notion_try_recover_attachment($tabId, $id);
        }
        return [
            'id' => $id,
            'name' => $name,
            'type' => $type,
            'size' => $size,
            'url' => (string)$item['url'],
        ];
    }

    $dataUrl = $item['dataUrl'] ?? '';
    if (!is_string($dataUrl) || $dataUrl === '') {
        return [
            'id' => $id,
            'name' => $name,
            'type' => $type,
            'size' => $size,
            'url' => !empty($item['url']) ? (string)$item['url'] : '',
        ];
    }

    $parsed = notion_parse_data_url($dataUrl);
    if ($parsed === null) {
        throw new RuntimeException('Adjunto inválido: ' . $name);
    }
    if ($type === '' || $type === 'application/octet-stream') {
        $type = $parsed['type'];
    }
    if ($size <= 0) {
        $size = strlen($parsed['bytes']);
    }
    if (!notion_save_attachment_bytes($tabId, $id, $parsed['bytes'], $type, $name)) {
        throw new RuntimeException('No se pudo guardar el adjunto: ' . $name);
    }

    return [
        'id' => $id,
        'name' => $name,
        'type' => $type,
        'size' => $size,
        'url' => notion_attachment_public_url($tabId, $id),
    ];
}

function notion_is_attachment_item($item): bool {
    return is_array($item) && (isset($item['dataUrl']) || isset($item['url']) || isset($item['name']));
}

function notion_is_attachment_field(array $value): bool {
    if ($value === []) {
        return false;
    }
    foreach ($value as $item) {
        if (notion_is_attachment_item($item)) {
            return true;
        }
    }
    return false;
}

function notion_persist_task_attachments(array &$task, string $tabId): void {
    foreach ($task as $key => &$value) {
        if (!is_array($value) || !notion_is_attachment_field($value)) {
            continue;
        }
        $next = [];
        foreach ($value as $item) {
            if (!is_array($item)) {
                continue;
            }
            $next[] = notion_persist_attachment_item($tabId, $item);
        }
        $task[$key] = $next;
    }
    unset($value);
}

function notion_persist_all_task_attachments(array &$tasks, string $tabId): void {
    foreach ($tasks as &$task) {
        if (!is_array($task)) {
            continue;
        }
        notion_persist_task_attachments($task, $tabId);
    }
    unset($task);
}

function notion_strip_attachment_item_for_transport(array $item): array {
    $out = [
        'id' => (string)($item['id'] ?? ''),
        'name' => (string)($item['name'] ?? ''),
        'type' => (string)($item['type'] ?? 'application/octet-stream'),
        'size' => (int)($item['size'] ?? 0),
    ];
    if (!empty($item['url']) && is_string($item['url'])) {
        $out['url'] = $item['url'];
    } elseif (!empty($item['dataUrl'])) {
        $out['hasData'] = true;
    }
    return $out;
}

function notion_strip_task_for_transport(array $task): array {
    $copy = $task;
    foreach ($copy as $key => $value) {
        if (!is_array($value) || !notion_is_attachment_field($value)) {
            continue;
        }
        $copy[$key] = array_values(array_map(
            fn($item) => is_array($item) ? notion_strip_attachment_item_for_transport($item) : $item,
            $value
        ));
    }
    return $copy;
}

function notion_strip_tasks_for_transport(array $tasks): array {
    return array_values(array_map(
        fn($task) => is_array($task) ? notion_strip_task_for_transport($task) : $task,
        $tasks
    ));
}

function notion_load_attachment_meta(string $tabId, string $attachmentId): ?array {
    $resolved = notion_resolve_attachment_paths($tabId, $attachmentId);
    if ($resolved !== null && is_file($resolved['meta'])) {
        $decoded = json_decode((string)file_get_contents($resolved['meta']), true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }
    $dbRow = notion_db_load_attachment($tabId, $attachmentId);
    if ($dbRow !== null) {
        return [
            'id' => preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId),
            'tabId' => $tabId,
            'type' => $dbRow['type'],
            'size' => $dbRow['size'],
            'name' => $dbRow['name'],
        ];
    }
    return null;
}

function notion_load_attachment_bytes(string $tabId, string $attachmentId): ?string {
    notion_try_recover_attachment($tabId, $attachmentId);

    $resolved = notion_resolve_attachment_paths($tabId, $attachmentId);
    if ($resolved !== null) {
        notion_migrate_attachment_to_primary($tabId, $attachmentId);
        $bytes = file_get_contents($resolved['bin']);
        if ($bytes !== false) {
            return $bytes;
        }
    }

    $dbRow = notion_db_load_attachment($tabId, $attachmentId);
    if ($dbRow !== null) {
        return $dbRow['bytes'];
    }

    return null;
}

/** Migra adjuntos de rutas legadas (out/data, .data) a .bocasion-data */
function notion_migrate_all_attachment_roots(): int {
    $primary = notion_attachments_root();
    $count = 0;
    foreach (notion_attachments_roots_for_read() as $root) {
        if (realpath($root) === realpath($primary)) {
            continue;
        }
        foreach (scandir($root) ?: [] as $tabEntry) {
            if ($tabEntry === '.' || $tabEntry === '..') {
                continue;
            }
            $srcTab = $root . '/' . $tabEntry;
            if (!is_dir($srcTab)) {
                continue;
            }
            $destTab = $primary . '/' . $tabEntry;
            if (!is_dir($destTab)) {
                mkdir($destTab, 0755, true);
            }
            foreach (scandir($srcTab) ?: [] as $file) {
                if ($file === '.' || $file === '..' || is_dir($srcTab . '/' . $file)) {
                    continue;
                }
                $dest = $destTab . '/' . $file;
                if (!is_file($dest) && @copy($srcTab . '/' . $file, $dest)) {
                    $count++;
                }
            }
        }
    }
    return $count;
}

/** Copia adjuntos del disco a MySQL para respaldo durable. */
function notion_backfill_db_from_disk(): int {
    $count = 0;
    foreach (notion_attachments_roots_for_read() as $root) {
        foreach (scandir($root) ?: [] as $tabEntry) {
            if ($tabEntry === '.' || $tabEntry === '..') {
                continue;
            }
            $tabDir = $root . '/' . $tabEntry;
            if (!is_dir($tabDir)) {
                continue;
            }
            foreach (scandir($tabDir) ?: [] as $file) {
                if (substr($file, -4) !== '.bin') {
                    continue;
                }
                $id = substr($file, 0, -4);
                if (notion_db_attachment_exists($tabEntry, $id)) {
                    continue;
                }
                $bytes = file_get_contents($tabDir . '/' . $file);
                if ($bytes === false) {
                    continue;
                }
                $metaPath = $tabDir . '/' . $id . '.json';
                $name = '';
                $mime = 'application/octet-stream';
                if (is_file($metaPath)) {
                    $meta = json_decode((string)file_get_contents($metaPath), true);
                    if (is_array($meta)) {
                        $name = (string)($meta['name'] ?? '');
                        $mime = (string)($meta['type'] ?? $mime);
                    }
                }
                try {
                    notion_db_save_attachment($tabEntry, $id, $bytes, $mime, $name);
                    $count++;
                } catch (Throwable $e) {
                    error_log('notion backfill db: ' . $e->getMessage());
                }
            }
        }
    }
    return $count;
}

/** Intenta recuperar todos los adjuntos referenciados en tareas que no existen en disco. */
function notion_repair_missing_attachments_for_tab(string $tabId): int {
    notion_db_loaded();
    $db = get_db();
    $safeTab = preg_replace('/[^a-zA-Z0-9_\-]/', '', $tabId);
    if ($safeTab === '') {
        return 0;
    }
    $stmt = $db->prepare('SELECT `tasks` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$safeTab]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return 0;
    }
    $tasks = json_decode((string)$row['tasks'], true);
    if (!is_array($tasks)) {
        return 0;
    }
    $repaired = 0;
    $seen = [];
    foreach ($tasks as $task) {
        if (!is_array($task)) {
            continue;
        }
        foreach ($task as $value) {
            if (!is_array($value) || !notion_is_attachment_field($value)) {
                continue;
            }
            foreach ($value as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $id = preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)($item['id'] ?? ''));
                if ($id === '' || isset($seen[$id])) {
                    continue;
                }
                $seen[$id] = true;
                if (!notion_attachment_exists($tabId, $id) && notion_try_recover_attachment($tabId, $id)) {
                    $repaired++;
                }
            }
        }
    }
    return $repaired;
}

/** Diagnóstico de un adjunto concreto (dónde existe o por qué falta). */
function notion_diagnose_attachment(string $tabId, string $attachmentId): array {
    $safeTab = preg_replace('/[^a-zA-Z0-9_\-]/', '', $tabId);
    $safeId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $attachmentId);
    $paths = notion_resolve_attachment_paths($safeTab, $safeId);
    $onDisk = $paths !== null;
    $inDb = notion_db_attachment_exists($safeTab, $safeId);
    $revisionDir = notion_find_revision_backup_dir($safeTab, $safeId);
    $liveItem = null;
    $hasDataUrlInLive = false;
    $hasDataUrlInRevision = false;

    notion_db_loaded();
    $db = get_db();
    $stmt = $db->prepare('SELECT `tasks` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$safeTab]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        $tasks = json_decode((string)$row['tasks'], true);
        if (is_array($tasks)) {
            $liveItem = notion_find_attachment_item_in_tasks($tasks, $safeId);
            $hasDataUrlInLive = is_array($liveItem) && !empty($liveItem['dataUrl']);
        }
    }

    $rstmt = $db->prepare(
        'SELECT `id`, `created_at` FROM `notion_tab_revisions`
         WHERE `tab_id` = ? AND `tasks_json` LIKE ? ORDER BY `created_at` DESC LIMIT 5'
    );
    $rstmt->execute([$safeTab, '%' . $safeId . '%']);
    $revisionHits = [];
    while ($rrow = $rstmt->fetch(PDO::FETCH_ASSOC)) {
        $revisionHits[] = [
            'revisionId' => $rrow['id'] ?? '',
            'createdAt' => $rrow['created_at'] ?? '',
        ];
    }

    if ($revisionHits !== []) {
        $rstmt2 = $db->prepare('SELECT `tasks_json` FROM `notion_tab_revisions` WHERE `id` = ? LIMIT 1');
        $rstmt2->execute([$revisionHits[0]['revisionId']]);
        $rrow2 = $rstmt2->fetch(PDO::FETCH_ASSOC);
        if ($rrow2) {
            $rtasks = json_decode((string)($rrow2['tasks_json'] ?? ''), true);
            if (is_array($rtasks)) {
                $ritem = notion_find_attachment_item_in_tasks($rtasks, $safeId);
                $hasDataUrlInRevision = is_array($ritem) && !empty($ritem['dataUrl']);
            }
        }
    }

    $recoverable = $onDisk || $inDb || $revisionDir !== null || $hasDataUrlInLive || $hasDataUrlInRevision;

    return [
        'tabId' => $safeTab,
        'attachmentId' => $safeId,
        'onDisk' => $onDisk,
        'diskPath' => $paths['bin'] ?? null,
        'inMysqlBlobs' => $inDb,
        'revisionBackupDir' => $revisionDir,
        'hasDataUrlInLiveTasks' => $hasDataUrlInLive,
        'hasDataUrlInRevision' => $hasDataUrlInRevision,
        'liveItem' => $liveItem ? [
            'name' => $liveItem['name'] ?? '',
            'url' => $liveItem['url'] ?? '',
            'hasDataUrl' => $hasDataUrlInLive,
        ] : null,
        'revisionHits' => $revisionHits,
        'recoverable' => $recoverable,
        'primaryDataRoot' => notion_primary_data_root(),
    ];
}
