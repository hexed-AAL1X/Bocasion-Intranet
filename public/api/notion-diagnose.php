<?php
/**
 * Diagnóstico rápido Notion — sin dependencias extra.
 *
 * GET /out/api/notion-diagnose.php?secret=SYNC_SECRET_2026
 * GET /out/api/notion-diagnose.php?secret=SYNC_SECRET_2026&tabId=prueba_tab_tareas
 * GET /out/api/notion-diagnose.php?secret=SYNC_SECRET_2026&userId=user_prueba_seed
 */
header('Content-Type: application/json; charset=UTF-8');
mb_internal_encoding('UTF-8');

define('DIAG_SECRET', 'SYNC_SECRET_2026');

$secret = $_GET['secret'] ?? '';
if ($secret !== DIAG_SECRET) {
    http_response_code(403);
    echo json_encode(['error' => 'Acceso denegado']);
    exit;
}

require_once __DIR__ . '/db.php';

$tabId  = preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['tabId'] ?? '');
$userId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['userId'] ?? '');
$attId  = preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['attId'] ?? $_GET['id'] ?? '');

function diag_analyze_tasks(?string $raw): array {
    if ($raw === null || $raw === '') {
        return ['exists' => false, 'bytes' => 0, 'mysqlRows' => 0, 'phpRows' => 0, 'jsonValid' => false, 'jsonError' => 'sin fila'];
    }
    $bytes = strlen($raw);
    $decoded = json_decode($raw, true);
    $valid = is_array($decoded);
    return [
        'exists'    => true,
        'bytes'     => $bytes,
        'mysqlRows' => $valid ? count($decoded) : null,
        'phpRows'   => $valid ? count($decoded) : 0,
        'jsonValid' => $valid,
        'jsonError' => $valid ? null : json_last_error_msg(),
        'preview'   => substr($raw, 0, 120),
        'endsWith'  => substr($raw, -40),
    ];
}

function diag_tab(PDO $db, string $tabId): array {
    $stmt = $db->prepare('SELECT `tasks` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $tasks = diag_analyze_tasks($row ? (string)$row['tasks'] : null);

    $cstmt = $db->prepare('SELECT 1 FROM `notion_columns` WHERE `tab_id` = ? LIMIT 1');
    $cstmt->execute([$tabId]);
    $hasCols = (bool)$cstmt->fetch();

    return [
        'tabId'      => $tabId,
        'tasks'      => $tasks,
        'hasColumns' => $hasCols,
        'apiFiles'   => [
            'tasks.php'            => file_exists(__DIR__ . '/tasks.php'),
            'columns.php'          => file_exists(__DIR__ . '/columns.php'),
            'notion-history-lib.php' => file_exists(__DIR__ . '/notion-history-lib.php'),
        ],
    ];
}

try {
    $db = get_db();
    $out = ['ok' => true, 'generatedAt' => date('c')];

    if ($tabId && $attId) {
        require_once __DIR__ . '/notion-attachments-lib.php';
        $diag = notion_diagnose_attachment($tabId, $attId);
        if (!$diag['onDisk'] && $diag['recoverable']) {
            $diag['recoveredNow'] = notion_try_recover_attachment($tabId, $attId);
            $diag['onDiskAfterRecover'] = notion_attachment_exists($tabId, $attId);
        }
        $out['attachment'] = $diag;
        echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    if ($tabId) {
        $out['tab'] = diag_tab($db, $tabId);
        echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    if ($userId) {
        $stmt = $db->prepare('SELECT * FROM `notion_tabs` WHERE `user_id` = ? LIMIT 1');
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            http_response_code(404);
            echo json_encode(['ok' => false, 'error' => 'Usuario sin notion_tabs', 'userId' => $userId]);
            exit;
        }
        $tabs = json_decode($row['tabs'], true) ?: [];
        $out['user'] = [
            'userId'       => $userId,
            'activeTabId'  => $row['active_tab_id'],
            'tabs'         => array_map(fn($t) => ['id' => $t['id'] ?? '', 'title' => $t['title'] ?? ''], $tabs),
        ];
        $out['tabsDetail'] = [];
        foreach ($tabs as $t) {
            $id = $t['id'] ?? '';
            if ($id) $out['tabsDetail'][] = diag_tab($db, $id);
        }
        $out['activeTab'] = diag_tab($db, (string)$row['active_tab_id']);
        echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    // Resumen global
    $rows = $db->query('SELECT tab_id, LENGTH(tasks) AS bytes FROM notion_tasks ORDER BY bytes DESC')->fetchAll(PDO::FETCH_ASSOC);
    $out['summary'] = [];
    foreach ($rows as $r) {
        $detail = diag_tab($db, $r['tab_id']);
        $out['summary'][] = [
            'tabId'     => $r['tab_id'],
            'bytes'     => (int)$r['bytes'],
            'jsonValid' => $detail['tasks']['jsonValid'],
            'rows'      => $detail['tasks']['mysqlRows'],
            'jsonError' => $detail['tasks']['jsonError'],
        ];
    }
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
