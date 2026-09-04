<?php
/**
 * Repara tabs Notion: apunta active_tab_id a un tab con data y crea filas faltantes.
 *
 * GET /out/api/notion-repair-tabs.php?secret=SYNC_SECRET_2026&mode=preview
 * GET /out/api/notion-repair-tabs.php?secret=SYNC_SECRET_2026&mode=repair
 */
header('Content-Type: application/json; charset=UTF-8');
mb_internal_encoding('UTF-8');

define('REPAIR_SECRET', 'SYNC_SECRET_2026');

$isCli = (php_sapi_name() === 'cli');
if (!$isCli) {
    $secret = $_GET['secret'] ?? '';
    if ($secret !== REPAIR_SECRET) {
        http_response_code(403);
        echo json_encode(['error' => 'Acceso denegado']);
        exit;
    }
    $mode = $_GET['mode'] ?? 'preview';
} else {
    $mode = $argv[1] ?? 'preview';
}

require_once __DIR__ . '/db.php';
function repair_default_columns(): array {
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

function repair_task_count(PDO $db, string $tabId): int {
    $stmt = $db->prepare('SELECT `tasks` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return -1; // no existe fila
    $tasks = json_decode($row['tasks'], true);
    return is_array($tasks) ? count($tasks) : 0;
}

function repair_ensure_tab_files(PDO $db, string $tabId, bool $apply): void {
    if (repair_task_count($db, $tabId) === -1) {
        if ($apply) {
            $db->prepare('INSERT INTO `notion_tasks` (`tab_id`,`tasks`) VALUES (?,?)')
               ->execute([$tabId, '[]']);
        }
    }
    $stmt = $db->prepare('SELECT 1 FROM `notion_columns` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    if (!$stmt->fetch() && $apply) {
        $defaults = repair_default_columns();
        $db->prepare('INSERT INTO `notion_columns` (`tab_id`,`base_columns`,`custom_columns`) VALUES (?,?,?)')
           ->execute([
               $tabId,
               json_encode($defaults['baseColumns'], JSON_UNESCAPED_UNICODE),
               json_encode($defaults['customColumns'], JSON_UNESCAPED_UNICODE),
           ]);
    }
}

function repair_find_best_tab(PDO $db, array $tabs): ?string {
    $bestId = null;
    $bestCount = -1;
    foreach ($tabs as $tab) {
        $id = $tab['id'] ?? '';
        if (!$id) continue;
        $count = repair_task_count($db, $id);
        if ($count > $bestCount) {
            $bestCount = $count;
            $bestId = $id;
        }
    }
    return $bestCount > 0 ? $bestId : null;
}

function repair_analyze(PDO $db): array {
    $rows = $db->query('SELECT * FROM `notion_tabs`')->fetchAll(PDO::FETCH_ASSOC);
    $plan = [];

    foreach ($rows as $row) {
        $userId = $row['user_id'];
        $active = $row['active_tab_id'];
        $tabs = json_decode($row['tabs'], true) ?: [];
        $activeCount = repair_task_count($db, $active);
        $bestTab = repair_find_best_tab($db, $tabs);

        $action = null;
        $newActive = $active;

        if ($activeCount <= 0 && $bestTab && $bestTab !== $active) {
            $action = 'switch_active_tab';
            $newActive = $bestTab;
        }

        $missingRows = [];
        foreach ($tabs as $tab) {
            $tid = $tab['id'] ?? '';
            if ($tid && repair_task_count($db, $tid) === -1) {
                $missingRows[] = $tid;
            }
        }

        if ($missingRows) {
            $action = ($action ? $action . '+' : '') . 'init_missing_rows';
        }

        if ($action) {
            $plan[] = [
                'userId'        => $userId,
                'currentActive' => $active,
                'currentRows'   => max(0, $activeCount),
                'newActive'     => $newActive,
                'bestTabRows'   => $bestTab ? max(0, repair_task_count($db, $bestTab)) : 0,
                'missingTabIds' => $missingRows,
                'action'        => $action,
            ];
        }
    }

    return $plan;
}

function repair_apply(PDO $db, array $plan): array {
    $done = [];
    foreach ($plan as $item) {
        $stmt = $db->prepare('SELECT * FROM `notion_tabs` WHERE `user_id` = ? LIMIT 1');
        $stmt->execute([$item['userId']]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) continue;

        $data = [
            'activeTabId' => $row['active_tab_id'],
            'tabs'        => json_decode($row['tabs'], true) ?: [],
            'trash'       => json_decode($row['trash'], true) ?: [],
        ];

        foreach ($item['missingTabIds'] as $tid) {
            repair_ensure_tab_files($db, $tid, true);
        }

        if (str_contains($item['action'], 'switch_active_tab')) {
            $data['activeTabId'] = $item['newActive'];
        }

        $db->prepare('INSERT INTO `notion_tabs` (`user_id`,`active_tab_id`,`tabs`,`trash`) VALUES (?,?,?,?)
                      ON DUPLICATE KEY UPDATE `active_tab_id`=VALUES(`active_tab_id`),`tabs`=VALUES(`tabs`),`trash`=VALUES(`trash`)')
           ->execute([
               $item['userId'],
               $data['activeTabId'],
               json_encode($data['tabs'], JSON_UNESCAPED_UNICODE),
               json_encode($data['trash'], JSON_UNESCAPED_UNICODE),
           ]);

        $done[] = $item;
    }
    return $done;
}

try {
    $db = get_db();
    $plan = repair_analyze($db);

    if ($mode === 'repair') {
        $applied = repair_apply($db, $plan);
        echo json_encode(['ok' => true, 'mode' => 'repair', 'applied' => $applied], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    } else {
        echo json_encode(['ok' => true, 'mode' => 'preview', 'plan' => $plan], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
