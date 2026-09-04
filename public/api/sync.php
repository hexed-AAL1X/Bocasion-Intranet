<?php
/**
 * sync.php — Sincronización bidireccional entre MySQL y archivos JSON
 *
 * Uso vía web (con clave de seguridad):
 *   GET /out/api/sync.php?secret=SYNC_SECRET_2026&mode=db_to_json   → Vuelca MySQL → JSON
 *   GET /out/api/sync.php?secret=SYNC_SECRET_2026&mode=json_to_db   → Importa JSON → MySQL
 *   GET /out/api/sync.php?secret=SYNC_SECRET_2026&mode=status       → Muestra estado de ambos lados
 *   GET /out/api/sync.php?secret=SYNC_SECRET_2026&mode=repair_attachments → Repara adjuntos Notion
 *
 * Uso vía CLI:
 *   php sync.php db_to_json
 *   php sync.php json_to_db
 *   php sync.php status
 */

// ── Seguridad ────────────────────────────────────────────────────────────────
define('SYNC_SECRET', 'SYNC_SECRET_2026');
define('DATA_DIR',    __DIR__ . '/../data');

require_once __DIR__ . '/notion-attachments-lib.php';
define('ATTACHMENTS_SRC', notion_attachments_root());
define('ATTACHMENTS_EXPORT', DATA_DIR . '/notion-attachments');

$isCli = (php_sapi_name() === 'cli');

if (!$isCli) {
    header('Content-Type: application/json');
    $secret = $_GET['secret'] ?? '';
    if ($secret !== SYNC_SECRET) {
        http_response_code(403);
        echo json_encode(['error' => 'Acceso denegado. Falta o es incorrecta la clave.']);
        exit;
    }
    $mode = $_GET['mode'] ?? 'status';
} else {
    $mode = $argv[1] ?? 'status';
}

require_once __DIR__ . '/db.php';

// ── Helpers ──────────────────────────────────────────────────────────────────
function read_json(string $path): mixed {
    if (!file_exists($path)) return null;
    return json_decode(file_get_contents($path), true);
}

function write_json(string $path, mixed $data): void {
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function log_msg(string $msg): void {
    global $isCli, $log;
    if ($isCli) echo $msg . PHP_EOL;
    $log[] = $msg;
}

function sync_delete_dir(string $dir): void {
    if (!is_dir($dir)) return;
    foreach (scandir($dir) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $path = $dir . '/' . $entry;
        if (is_dir($path)) {
            sync_delete_dir($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($dir);
}

function sync_copy_dir(string $src, string $dest): int {
    if (!is_dir($src)) return 0;
    if (!is_dir($dest)) mkdir($dest, 0775, true);
    $count = 0;
    foreach (scandir($src) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $from = $src . '/' . $entry;
        $to = $dest . '/' . $entry;
        if (is_dir($from)) {
            $count += sync_copy_dir($from, $to);
        } elseif (@copy($from, $to)) {
            $count++;
        }
    }
    return $count;
}

function sync_export_attachments(): void {
    if (!is_dir(ATTACHMENTS_SRC)) {
        log_msg('⚠ notion-attachments — sin carpeta origen');
        return;
    }
    sync_delete_dir(ATTACHMENTS_EXPORT);
    $count = sync_copy_dir(ATTACHMENTS_SRC, ATTACHMENTS_EXPORT);
    log_msg("✓ notion-attachments — $count archivos exportados");
}

function sync_import_attachments(): void {
    if (!is_dir(ATTACHMENTS_EXPORT)) {
        log_msg('⚠ notion-attachments — sin backup JSON para importar');
        return;
    }
    if (!is_dir(dirname(ATTACHMENTS_SRC))) {
        mkdir(dirname(ATTACHMENTS_SRC), 0775, true);
    }
    sync_delete_dir(ATTACHMENTS_SRC);
    $count = sync_copy_dir(ATTACHMENTS_EXPORT, ATTACHMENTS_SRC);
    log_msg("✓ notion-attachments — $count archivos importados");
}

$log = [];

// ════════════════════════════════════════════════════════════════════════════
// MODE: db_to_json  — MySQL ► JSON
// ════════════════════════════════════════════════════════════════════════════
function db_to_json(PDO $db): void {
    $dataDir = DATA_DIR;
    if (!is_dir($dataDir)) mkdir($dataDir, 0775, true);

    // ── users ────────────────────────────────────────────────────────────────
    $users = $db->query('SELECT * FROM `users` ORDER BY `created_at`')->fetchAll();
    $usersJson = array_map(fn($r) => [
        'id'           => $r['id'],
        'username'     => $r['username'],
        'passwordHash' => $r['password_hash'],
        'displayName'  => $r['display_name'],
        'role'         => $r['role'],
        'createdAt'    => $r['created_at'],
        'updatedAt'    => $r['updated_at'],
    ], $users);
    write_json("$dataDir/users.json", $usersJson);
    log_msg("✓ users.json — " . count($usersJson) . " registros");

    // ── notion_tabs ──────────────────────────────────────────────────────────
    $rows = $db->query('SELECT * FROM `notion_tabs`')->fetchAll();
    foreach ($rows as $row) {
        $userId = $row['user_id'];
        $data   = [
            'activeTabId' => $row['active_tab_id'],
            'tabs'        => json_decode($row['tabs'],  true) ?: [],
            'trash'       => json_decode($row['trash'], true) ?: [],
        ];
        $fname = $userId === 'default' ? 'notion-tabs.json' : "notion-tabs.{$userId}.json";
        write_json("$dataDir/$fname", $data);
        log_msg("✓ $fname");
    }

    // ── notion_columns ───────────────────────────────────────────────────────
    $rows = $db->query('SELECT * FROM `notion_columns`')->fetchAll();
    foreach ($rows as $row) {
        $tabId = $row['tab_id'];
        $data  = [
            'baseColumns'   => json_decode($row['base_columns'],   true) ?: [],
            'customColumns' => json_decode($row['custom_columns'], true) ?: [],
        ];
        write_json("$dataDir/columns.{$tabId}.json", $data);
        log_msg("✓ columns.{$tabId}.json");
    }

    // ── notion_tasks ─────────────────────────────────────────────────────────
    $rows = $db->query('SELECT * FROM `notion_tasks`')->fetchAll();
    foreach ($rows as $row) {
        $tabId = $row['tab_id'];
        $tasks = json_decode($row['tasks'], true) ?: [];
        write_json("$dataDir/tasks.{$tabId}.json", $tasks);
        log_msg("✓ tasks.{$tabId}.json — " . count($tasks) . " tareas");
    }

    // ── cal_events ───────────────────────────────────────────────────────────
    $rows = $db->query('SELECT * FROM `cal_events`')->fetchAll();
    foreach ($rows as $row) {
        $events = json_decode($row['events'], true) ?: [];
        write_json("$dataDir/events.json", $events);
        log_msg("✓ events.json — " . count($events) . " eventos");
    }

    // ── tickets ──────────────────────────────────────────────────────────────
    $rows    = $db->query('SELECT `data` FROM `tickets` ORDER BY `created_at` DESC')->fetchAll();
    $tickets = array_map(fn($r) => json_decode($r['data'], true), $rows);
    write_json("$dataDir/tickets.json", $tickets);
    log_msg("✓ tickets.json — " . count($tickets) . " tickets");

    // ── programa_anual ───────────────────────────────────────────────────────
    require_once __DIR__ . '/programa-anual-lib.php';
    pa_ensure_table($db);
    $rows = $db->query('SELECT * FROM `programa_anual_actividades` ORDER BY `programa_label`, `actividad`')->fetchAll();
    $exportRows = array_map(function ($row) {
        $act = pa_row_to_actividad($row);
        unset($act['alertas'], $act['vidaAlcanzada'], $act['depreciacionPct'], $act['valorResidual'], $act['aniosRestantes']);
        return $act;
    }, $rows);
    write_json("$dataDir/programa-anual-db-export.json", $exportRows);
    log_msg("✓ programa-anual-db-export.json — " . count($exportRows) . " actividades (backup desde MySQL)");

    sync_export_attachments();
}

// ════════════════════════════════════════════════════════════════════════════
// MODE: json_to_db  — JSON ► MySQL
// ════════════════════════════════════════════════════════════════════════════
function json_to_db(PDO $db): void {
    $dataDir = DATA_DIR;

    // ── users ────────────────────────────────────────────────────────────────
    $users = read_json("$dataDir/users.json") ?? [];
    foreach ($users as $u) {
        $db->prepare('INSERT INTO `users` (`id`,`username`,`password_hash`,`display_name`,`role`,`created_at`,`updated_at`)
                      VALUES (?,?,?,?,?,?,?)
                      ON DUPLICATE KEY UPDATE
                        `username`=VALUES(`username`),`password_hash`=VALUES(`password_hash`),
                        `display_name`=VALUES(`display_name`),`role`=VALUES(`role`),`updated_at`=VALUES(`updated_at`)')
           ->execute([$u['id'], $u['username'], $u['passwordHash'], $u['displayName'] ?? '', $u['role'] ?? 'user',
                      date('Y-m-d H:i:s', strtotime($u['createdAt'] ?? 'now')),
                      date('Y-m-d H:i:s', strtotime($u['updatedAt'] ?? 'now'))]);
    }
    log_msg("✓ users — " . count($users) . " registros importados");

    // ── notion_tabs ──────────────────────────────────────────────────────────
    $count = 0;
    foreach (glob("$dataDir/notion-tabs*.json") as $file) {
        $fname  = basename($file);
        $userId = preg_replace('/^notion-tabs\.?|\.json$/', '', $fname) ?: 'default';
        $data   = read_json($file) ?? [];
        $db->prepare('INSERT INTO `notion_tabs` (`user_id`,`active_tab_id`,`tabs`,`trash`) VALUES (?,?,?,?)
                      ON DUPLICATE KEY UPDATE `active_tab_id`=VALUES(`active_tab_id`),`tabs`=VALUES(`tabs`),`trash`=VALUES(`trash`)')
           ->execute([$userId, $data['activeTabId'] ?? '',
                      json_encode($data['tabs']  ?? [], JSON_UNESCAPED_UNICODE),
                      json_encode($data['trash'] ?? [], JSON_UNESCAPED_UNICODE)]);
        $count++;
    }
    log_msg("✓ notion_tabs — $count archivos importados");

    // ── notion_columns ───────────────────────────────────────────────────────
    $count = 0;
    foreach (glob("$dataDir/columns.*.json") as $file) {
        $tabId = preg_replace('/^columns\.|\.json$/', '', basename($file));
        $data  = read_json($file) ?? [];
        $db->prepare('INSERT INTO `notion_columns` (`tab_id`,`base_columns`,`custom_columns`) VALUES (?,?,?)
                      ON DUPLICATE KEY UPDATE `base_columns`=VALUES(`base_columns`),`custom_columns`=VALUES(`custom_columns`)')
           ->execute([$tabId,
                      json_encode($data['baseColumns']   ?? [], JSON_UNESCAPED_UNICODE),
                      json_encode($data['customColumns'] ?? [], JSON_UNESCAPED_UNICODE)]);
        $count++;
    }
    log_msg("✓ notion_columns — $count archivos importados");

    // ── notion_tasks ─────────────────────────────────────────────────────────
    $count = 0;
    $skippedEmpty = 0;
    foreach (glob("$dataDir/tasks.*.json") as $file) {
        $tabId = preg_replace('/^tasks\.|\.json$/', '', basename($file));
        $tasks = read_json($file) ?? [];
        if (!is_array($tasks)) $tasks = [];

        // PROTECCIÓN: no pisar MySQL con JSON vacío si ya hay filas guardadas
        if (count($tasks) === 0) {
            $stmt = $db->prepare('SELECT `tasks` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
            $stmt->execute([$tabId]);
            $existing = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                $existingTasks = json_decode($existing['tasks'], true) ?: [];
                if (count($existingTasks) > 0) {
                    $skippedEmpty++;
                    log_msg("⚠ tasks.{$tabId}.json vacío — se conserva MySQL (" . count($existingTasks) . " filas)");
                    continue;
                }
            }
        }

        $db->prepare('INSERT INTO `notion_tasks` (`tab_id`,`tasks`) VALUES (?,?)
                      ON DUPLICATE KEY UPDATE `tasks`=VALUES(`tasks`)')
           ->execute([$tabId, json_encode($tasks, JSON_UNESCAPED_UNICODE)]);
        $count++;
    }
    log_msg("✓ notion_tasks — $count archivos importados" . ($skippedEmpty ? " ($skippedEmpty vacíos omitidos)" : ""));

    // ── cal_events ───────────────────────────────────────────────────────────
    $events = read_json("$dataDir/events.json") ?? [];
    $db->prepare('INSERT INTO `cal_events` (`user_id`,`events`) VALUES (?,?)
                  ON DUPLICATE KEY UPDATE `events`=VALUES(`events`)')
       ->execute(['default', json_encode($events, JSON_UNESCAPED_UNICODE)]);
    log_msg("✓ cal_events — " . count($events) . " eventos importados");

    // ── tickets ──────────────────────────────────────────────────────────────
    $tickets = read_json("$dataDir/tickets.json") ?? [];
    if (!is_array($tickets)) $tickets = [];
    foreach ($tickets as $t) {
        // Usar "Nº ticket" como id (igual que tickets.php)
        $nro = $t['Nº ticket'] ?? $t['id'] ?? null;
        $id  = ($nro !== null && $nro !== '') ? (string)$nro : ('ticket_' . time() . '_' . rand(1000, 9999));
        $now = date('Y-m-d H:i:s');
        $created = isset($t['createdAt']) ? date('Y-m-d H:i:s', strtotime($t['createdAt'])) : $now;
        $db->prepare('INSERT INTO `tickets` (`id`,`data`,`created_at`,`updated_at`) VALUES (?,?,?,?)
                      ON DUPLICATE KEY UPDATE `data`=VALUES(`data`),`updated_at`=VALUES(`updated_at`)')
           ->execute([$id, json_encode($t, JSON_UNESCAPED_UNICODE), $created, $now]);
    }
    log_msg("✓ tickets — " . count($tickets) . " registros importados");

    // ── programa_anual ───────────────────────────────────────────────────────
    require_once __DIR__ . '/programa-anual-lib.php';
    try {
        $imported = pa_import_from_json_dir($db, $dataDir, true);
        if ($imported > 0) {
            log_msg("✓ programa_anual — $imported actividades importadas (tabla estaba vacía)");
        } else {
            $count = (int)$db->query('SELECT COUNT(*) FROM `programa_anual_actividades`')->fetchColumn();
            log_msg("✓ programa_anual — omitido ($count filas ya en MySQL; no se pisan ediciones de producción)");
        }
    } catch (Throwable $e) {
        log_msg("⚠ programa_anual — " . $e->getMessage());
    }

    sync_import_attachments();
}

// ════════════════════════════════════════════════════════════════════════════
// MODE: repair_attachments — Migra adjuntos legados y repara desde revisiones
// ════════════════════════════════════════════════════════════════════════════
function repair_attachments(PDO $db): void {
    $migrated = notion_migrate_all_attachment_roots();
    log_msg("✓ migración a .bocasion-data — $migrated archivos");

    $backfilled = notion_backfill_db_from_disk();
    log_msg("✓ respaldo MySQL de adjuntos — $backfilled archivos");

    $legacy = dirname(__DIR__, 2) . '/.data/notion-attachments';
    if (is_dir($legacy)) {
        $count = sync_copy_dir($legacy, ATTACHMENTS_SRC);
        log_msg("✓ migración legada .data → .bocasion-data ($count archivos)");
    }

    $outData = dirname(__DIR__) . '/data/notion-attachments';
    if (is_dir($outData)) {
        $count = sync_copy_dir($outData, ATTACHMENTS_SRC);
        log_msg("✓ migración out/data → .bocasion-data ($count archivos)");
    }

    require_once __DIR__ . '/notion-history-lib.php';
    $tabs = $db->query('SELECT DISTINCT `tab_id` FROM `notion_tasks`')->fetchAll(PDO::FETCH_COLUMN);
    $repairedTabs = 0;
    $recovered = 0;
    foreach ($tabs as $tabId) {
        if (!is_string($tabId) || $tabId === '') {
            continue;
        }
        history_repair_live_attachments_for_tab($db, $tabId);
        $recovered += notion_repair_missing_attachments_for_tab($tabId);
        $repairedTabs++;
    }
    log_msg("✓ reparación de adjuntos — $repairedTabs tablas, $recovered recuperados");
}

// ════════════════════════════════════════════════════════════════════════════
// MODE: status  — Muestra conteos de ambos lados
// ════════════════════════════════════════════════════════════════════════════
function show_status(PDO $db): void {
    $dataDir = DATA_DIR;
    require_once __DIR__ . '/programa-anual-lib.php';
    pa_ensure_table($db);

    $dbCounts = [
        'users'         => (int)$db->query('SELECT COUNT(*) FROM `users`')->fetchColumn(),
        'notion_tabs'   => (int)$db->query('SELECT COUNT(*) FROM `notion_tabs`')->fetchColumn(),
        'notion_columns'=> (int)$db->query('SELECT COUNT(*) FROM `notion_columns`')->fetchColumn(),
        'notion_tasks'  => (int)$db->query('SELECT COUNT(*) FROM `notion_tasks`')->fetchColumn(),
        'cal_events'    => (int)$db->query('SELECT COUNT(*) FROM `cal_events`')->fetchColumn(),
        'tickets'       => (int)$db->query('SELECT COUNT(*) FROM `tickets`')->fetchColumn(),
        'programa_anual'  => (int)$db->query('SELECT COUNT(*) FROM `programa_anual_actividades`')->fetchColumn(),
    ];

    $jsonCounts = [
        'users'         => count(read_json("$dataDir/users.json")         ?? []),
        'notion_tabs'   => count(glob("$dataDir/notion-tabs*.json")       ?: []),
        'notion_columns'=> count(glob("$dataDir/columns.*.json")          ?: []),
        'notion_tasks'  => count(glob("$dataDir/tasks.*.json")            ?: []),
        'cal_events'    => count(read_json("$dataDir/events.json")        ?? []),
        'tickets'       => count(read_json("$dataDir/tickets.json")       ?? []),
        'programa_anual'  => count(read_json("$dataDir/programa-anual-activities.json") ?? []),
    ];

    log_msg("=== ESTADO DE SINCRONIZACIÓN ===");
    log_msg(sprintf("%-20s %10s %10s %10s", "Tabla/Archivo", "DB (filas)", "JSON", "¿OK?"));
    log_msg(str_repeat("-", 54));
    foreach ($dbCounts as $key => $dbVal) {
        $jsonVal = $jsonCounts[$key];
        $ok      = ($dbVal === $jsonVal) ? "✓" : "⚠ DIFF";
        log_msg(sprintf("%-20s %10d %10d %10s", $key, $dbVal, $jsonVal, $ok));
    }
}

// ── Ejecutar modo ─────────────────────────────────────────────────────────────
try {
    $db = get_db();

    switch ($mode) {
        case 'db_to_json':
            log_msg("=== DB → JSON (MySQL ► archivos) ===");
            db_to_json($db);
            log_msg("✅ Sincronización completada: DB → JSON");
            break;

        case 'json_to_db':
            log_msg("=== JSON → DB (archivos ► MySQL) ===");
            json_to_db($db);
            log_msg("✅ Sincronización completada: JSON → DB");
            break;

        case 'repair_attachments':
            log_msg("=== Reparar adjuntos Notion ===");
            repair_attachments($db);
            log_msg("✅ Reparación de adjuntos completada");
            break;

        case 'status':
        default:
            show_status($db);
            break;
    }

    if (!$isCli) {
        echo json_encode(['success' => true, 'mode' => $mode, 'log' => $log], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    }

} catch (Exception $e) {
    $msg = "❌ Error: " . $e->getMessage();
    log_msg($msg);
    if (!$isCli) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $e->getMessage(), 'log' => $log]);
    }
}
