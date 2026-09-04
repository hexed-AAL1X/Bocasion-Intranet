<?php
/**
 * RECUPERACIÓN DE EMERGENCIA — Notion
 *
 * Restaura notion_tasks y notion_columns desde notion_tab_revisions
 * para TODOS los tabs que tengan al menos una revisión con filas.
 *
 * Uso web:
 *   GET /out/api/notion-recover.php?secret=SYNC_SECRET_2026&mode=preview
 *   GET /out/api/notion-recover.php?secret=SYNC_SECRET_2026&mode=restore_all
 *
 * Uso CLI:
 *   php notion-recover.php preview
 *   php notion-recover.php restore_all
 */
header('Content-Type: application/json; charset=UTF-8');
mb_internal_encoding('UTF-8');

define('RECOVER_SECRET', 'SYNC_SECRET_2026');

$isCli = (php_sapi_name() === 'cli');

if (!$isCli) {
    $secret = $_GET['secret'] ?? '';
    if ($secret !== RECOVER_SECRET) {
        http_response_code(403);
        echo json_encode(['error' => 'Acceso denegado']);
        exit;
    }
    $mode = $_GET['mode'] ?? 'preview';
} else {
    $mode = $argv[1] ?? 'preview';
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/notion-history-lib.php';

function recover_list_candidates(PDO $db): array {
    history_ensure_tables($db);

    $stmt = $db->query(
        'SELECT r.*
         FROM notion_tab_revisions r
         INNER JOIN (
             SELECT tab_id, MAX(created_at) AS max_created
             FROM notion_tab_revisions
             WHERE row_count > 0
             GROUP BY tab_id
         ) latest ON latest.tab_id = r.tab_id AND latest.max_created = r.created_at
         WHERE r.row_count > 0
         ORDER BY r.tab_id'
    );
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $out = [];
    foreach ($rows as $row) {
        $tabId = $row['tab_id'];
        $liveTasks = history_load_tasks($db, $tabId);
        $out[] = [
            'tabId'       => $tabId,
            'revisionId'  => $row['id'],
            'revisionNum' => (int)$row['revision_num'],
            'rowCount'    => (int)$row['row_count'],
            'kind'        => $row['kind'],
            'label'       => $row['label'],
            'createdAt'   => $row['created_at'],
            'liveRows'    => count($liveTasks),
        ];
    }
    return $out;
}

function recover_restore_all(PDO $db): array {
    $candidates = recover_list_candidates($db);
    $restored = [];
    $skipped = [];

    foreach ($candidates as $c) {
        $tabId = $c['tabId'];
        if ($c['liveRows'] > 0) {
            $skipped[] = ['tabId' => $tabId, 'reason' => 'already_has_data', 'liveRows' => $c['liveRows']];
            continue;
        }
        try {
            history_apply_revision($db, $tabId, $c['revisionId'], 'system', 'Recuperación de emergencia', true);
            $restored[] = $tabId;
        } catch (Throwable $e) {
            $skipped[] = ['tabId' => $tabId, 'reason' => $e->getMessage()];
        }
    }

    return [
        'restored' => $restored,
        'skipped'  => $skipped,
        'totalCandidates' => count($candidates),
    ];
}

function recover_db_status(PDO $db): array {
    $taskRows = (int)$db->query('SELECT COUNT(*) FROM notion_tasks')->fetchColumn();
    $emptyTasks = (int)$db->query(
        "SELECT COUNT(*) FROM notion_tasks WHERE tasks IS NULL OR tasks = '[]' OR tasks = '' OR JSON_LENGTH(tasks) = 0"
    )->fetchColumn();
    $revisionRows = 0;
    $revisionsWithData = 0;
    try {
        history_ensure_tables($db);
        $revisionRows = (int)$db->query('SELECT COUNT(*) FROM notion_tab_revisions')->fetchColumn();
        $revisionsWithData = (int)$db->query('SELECT COUNT(*) FROM notion_tab_revisions WHERE row_count > 0')->fetchColumn();
    } catch (Throwable $e) {
        /* tablas pueden no existir */
    }
    return [
        'notion_tasks_rows'      => $taskRows,
        'notion_tasks_empty'     => $emptyTasks,
        'revision_rows'          => $revisionRows,
        'revisions_with_data'    => $revisionsWithData,
    ];
}

try {
    $db = get_db();
    $status = recover_db_status($db);

    switch ($mode) {
        case 'restore_all':
            $result = recover_restore_all($db);
            echo json_encode([
                'ok'     => true,
                'mode'   => 'restore_all',
                'status' => recover_db_status($db),
                'result' => $result,
            ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            break;

        case 'preview':
        default:
            echo json_encode([
                'ok'         => true,
                'mode'       => 'preview',
                'status'     => $status,
                'candidates' => recover_list_candidates($db),
                'help'       => [
                    'restore' => 'GET ?secret=...&mode=restore_all',
                    'note'    => 'Si candidates está vacío, necesitas backup MySQL del hosting.',
                ],
            ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            break;
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
