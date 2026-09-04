<?php
/**
 * Restaura tabs/tasks/columns de un usuario desde public/api/recover-data/{userId}/
 *
 * GET ?secret=SYNC_SECRET_2026&userId=user_prueba_seed&mode=preview
 * GET ?secret=SYNC_SECRET_2026&userId=user_prueba_seed&mode=restore
 */
header('Content-Type: application/json; charset=UTF-8');
mb_internal_encoding('UTF-8');

define('IMPORT_SECRET', 'SYNC_SECRET_2026');

$secret = $_GET['secret'] ?? '';
$userId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['userId'] ?? '');
$mode   = $_GET['mode'] ?? 'preview';

if ($secret !== IMPORT_SECRET) {
    http_response_code(403);
    echo json_encode(['error' => 'Acceso denegado']);
    exit;
}
if (!$userId) {
    http_response_code(400);
    echo json_encode(['error' => 'userId requerido']);
    exit;
}

require_once __DIR__ . '/db.php';

$dataDir = __DIR__ . '/recover-data/' . $userId;
if (!is_dir($dataDir)) {
    http_response_code(404);
    echo json_encode(['error' => "Sin backup en recover-data/$userId"]);
    exit;
}

function read_json_file(string $path): mixed {
    if (!file_exists($path)) return null;
    return json_decode(file_get_contents($path), true);
}

function default_columns_payload(): array {
    return [
        'baseColumns' => [
            ['title' => 'Personas', 'savedTitle' => 'Usuario', 'type' => 'Personas', 'hidden' => false, 'pinned' => false, 'fit' => false, 'filter' => false, 'sort' => '', 'group' => false, 'calculate' => ''],
            ['title' => 'Relación', 'savedTitle' => 'Área',    'type' => 'Relación', 'hidden' => false, 'pinned' => false, 'fit' => false, 'filter' => false, 'sort' => '', 'group' => false, 'calculate' => ''],
            ['title' => 'Texto',    'savedTitle' => 'Texto',   'type' => 'Texto',    'hidden' => false, 'pinned' => false, 'fit' => false, 'filter' => false, 'sort' => '', 'group' => false, 'calculate' => ''],
            ['title' => 'Fecha',    'savedTitle' => 'Fecha',   'type' => 'Fecha',    'hidden' => false, 'pinned' => false, 'fit' => false, 'filter' => false, 'sort' => '', 'group' => false, 'calculate' => ''],
            ['title' => 'Casilla',  'savedTitle' => 'Casilla', 'type' => 'Casilla',  'hidden' => false, 'pinned' => false, 'fit' => false, 'filter' => false, 'sort' => '', 'group' => false, 'calculate' => ''],
            ['title' => 'Estado',   'savedTitle' => 'Estado',  'type' => 'Estado',   'hidden' => false, 'pinned' => false, 'fit' => false, 'filter' => false, 'sort' => '', 'group' => false, 'calculate' => ''],
        ],
        'customColumns' => [],
    ];
}

try {
    $db = get_db();
    $plan = ['tabs' => null, 'tasks' => [], 'columns' => []];

    // notion-tabs.json
    $tabsFile = read_json_file("$dataDir/notion-tabs.json");
    if (is_array($tabsFile)) {
        $plan['tabs'] = $tabsFile;
    }

    // tasks.*.json  (tasks.notion_prueba_tab1.json → tab_id notion_prueba_tab1)
    foreach (glob("$dataDir/tasks.*.json") ?: [] as $file) {
        $base = basename($file);
        if (!preg_match('/^tasks\.(.+)\.json$/', $base, $m)) continue;
        $tabId = $m[1];
        $tasks = read_json_file($file);
        if (!is_array($tasks)) continue;
        $plan['tasks'][$tabId] = count($tasks);
    }

    // columns.*.json
    foreach (glob("$dataDir/columns.*.json") ?: [] as $file) {
        $base = basename($file);
        if (!preg_match('/^columns\.(.+)\.json$/', $base, $m)) continue;
        $tabId = $m[1];
        $plan['columns'][$tabId] = true;
    }

    if ($mode !== 'restore') {
        echo json_encode(['ok' => true, 'mode' => 'preview', 'userId' => $userId, 'plan' => $plan], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    $imported = ['tasks' => [], 'columns' => [], 'tabs' => false];

    // Importar tasks (no pisa si el tab ya tiene MÁS filas en producción)
    foreach (glob("$dataDir/tasks.*.json") ?: [] as $file) {
        $base = basename($file);
        if (!preg_match('/^tasks\.(.+)\.json$/', $base, $m)) continue;
        $tabId = $m[1];
        $tasks = read_json_file($file);
        if (!is_array($tasks)) continue;

        $stmt = $db->prepare('SELECT `tasks` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
        $stmt->execute([$tabId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $existing = $row ? (json_decode($row['tasks'], true) ?: []) : [];
        $existingCount = is_array($existing) ? count($existing) : 0;

        if ($existingCount >= count($tasks)) {
            $imported['tasks'][$tabId] = "omitido (prod tiene $existingCount filas, backup " . count($tasks) . ")";
            continue;
        }

        $json = json_encode($tasks, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
        $db->prepare('INSERT INTO `notion_tasks` (`tab_id`,`tasks`) VALUES (?,?)
                      ON DUPLICATE KEY UPDATE `tasks`=VALUES(`tasks`)')
           ->execute([$tabId, $json]);
        $imported['tasks'][$tabId] = count($tasks) . ' filas importadas';
    }

    // Importar columns
    foreach (glob("$dataDir/columns.*.json") ?: [] as $file) {
        $base = basename($file);
        if (!preg_match('/^columns\.(.+)\.json$/', $base, $m)) continue;
        $tabId = $m[1];
        $cols = read_json_file($file);
        if (!is_array($cols)) $cols = default_columns_payload();

        $db->prepare('INSERT INTO `notion_columns` (`tab_id`,`base_columns`,`custom_columns`) VALUES (?,?,?)
                      ON DUPLICATE KEY UPDATE `base_columns`=VALUES(`base_columns`),`custom_columns`=VALUES(`custom_columns`)')
           ->execute([
               $tabId,
               json_encode($cols['baseColumns'] ?? [], JSON_UNESCAPED_UNICODE),
               json_encode($cols['customColumns'] ?? [], JSON_UNESCAPED_UNICODE),
           ]);
        $imported['columns'][$tabId] = true;
    }

    // Restaurar notion_tabs: merge backup tabs + tabs de prod que tengan data
    $stmt = $db->prepare('SELECT * FROM `notion_tabs` WHERE `user_id` = ? LIMIT 1');
    $stmt->execute([$userId]);
    $prodRow = $stmt->fetch(PDO::FETCH_ASSOC);

    $prodTabs = $prodRow ? (json_decode($prodRow['tabs'], true) ?: []) : [];
    $prodTrash = $prodRow ? (json_decode($prodRow['trash'], true) ?: []) : [];
    $backupTabs = is_array($tabsFile) ? ($tabsFile['tabs'] ?? []) : [];
    $backupTrash = is_array($tabsFile) ? ($tabsFile['trash'] ?? []) : [];

    $byId = [];
    foreach (array_merge($prodTabs, $backupTabs) as $t) {
        if (!empty($t['id'])) $byId[$t['id']] = $t;
    }
    // Asegurar tabs con data en prod
    foreach (['prueba_tab_tareas', 'prueba_tab_clientes'] as $extraId) {
        $cstmt = $db->prepare('SELECT JSON_LENGTH(`tasks`) FROM `notion_tasks` WHERE `tab_id` = ?');
        $cstmt->execute([$extraId]);
        $cnt = (int)$cstmt->fetchColumn();
        if ($cnt > 0 && !isset($byId[$extraId])) {
            $byId[$extraId] = ['id' => $extraId, 'title' => $extraId === 'prueba_tab_tareas' ? 'Mayo 2026' : 'Clientes', 'createdAt' => date('c'), 'updatedAt' => date('c')];
        }
    }

    $mergedTabs = array_values($byId);
    $mergedTrash = $backupTrash;
    $activeTab = 'prueba_tab_tareas';
    if (!isset($byId[$activeTab])) {
        $activeTab = is_array($tabsFile) ? ($tabsFile['activeTabId'] ?? ($mergedTabs[0]['id'] ?? '')) : ($mergedTabs[0]['id'] ?? '');
    }

    $db->prepare('INSERT INTO `notion_tabs` (`user_id`,`active_tab_id`,`tabs`,`trash`) VALUES (?,?,?,?)
                  ON DUPLICATE KEY UPDATE `active_tab_id`=VALUES(`active_tab_id`),`tabs`=VALUES(`tabs`),`trash`=VALUES(`trash`)')
       ->execute([
           $userId,
           $activeTab,
           json_encode($mergedTabs, JSON_UNESCAPED_UNICODE),
           json_encode($mergedTrash, JSON_UNESCAPED_UNICODE),
       ]);
    $imported['tabs'] = true;
    $imported['activeTabId'] = $activeTab;

    echo json_encode(['ok' => true, 'mode' => 'restore', 'userId' => $userId, 'imported' => $imported], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
