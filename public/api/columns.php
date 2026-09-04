<?php
header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Cache-Control: no-store, no-cache, must-revalidate");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';

function columns_require_history_lib(): void {
    static $loaded = false;
    if (!$loaded) {
        require_once __DIR__ . '/notion-history-lib.php';
        $loaded = true;
    }
}

function safe_tab_id(string $id): string {
    return preg_replace('/[^a-zA-Z0-9_\-]/', '', $id);
}

function default_columns(): array {
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

function load_columns(PDO $db, string $tabId): array {
    $stmt = $db->prepare('SELECT * FROM `notion_columns` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    $row = $stmt->fetch();
    $defaults = default_columns();

    if (!$row) {
        save_columns($db, $tabId, $defaults);
        return $defaults;
    }

    $baseColumns   = json_decode($row['base_columns'],   true) ?: [];
    $customColumns = json_decode($row['custom_columns'], true) ?: [];

    // Si no hay columnas base guardadas, aplicar defaults y guardar
    if (empty($baseColumns)) {
        $baseColumns = $defaults['baseColumns'];
        save_columns($db, $tabId, ['baseColumns' => $baseColumns, 'customColumns' => $customColumns]);
    }

    return ['baseColumns' => $baseColumns, 'customColumns' => $customColumns];
}

function save_columns(PDO $db, string $tabId, array $data): void {
    $db->prepare('INSERT INTO `notion_columns` (`tab_id`,`base_columns`,`custom_columns`) VALUES (?,?,?)
                  ON DUPLICATE KEY UPDATE `base_columns`=VALUES(`base_columns`),`custom_columns`=VALUES(`custom_columns`)')
       ->execute([
           $tabId,
           json_encode($data['baseColumns']   ?? [], JSON_UNESCAPED_UNICODE),
           json_encode($data['customColumns'] ?? [], JSON_UNESCAPED_UNICODE),
       ]);
}

try {
    $db     = get_db();
    $method = $_SERVER['REQUEST_METHOD'];
    $tabId  = safe_tab_id($_GET['tabId'] ?? '');

    if (!$tabId) {
        http_response_code(400);
        echo json_encode(['error' => 'tabId requerido']);
        exit;
    }

    // ── GET ───────────────────────────────────────────────────────────────────
    if ($method === 'GET') {
        echo json_encode(load_columns($db, $tabId));
        exit;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    columns_require_history_lib();
    $historyUserId   = history_safe_id($body['_historyUserId'] ?? $_GET['userId'] ?? '');
    $historyUserName = trim($body['_historyUserName'] ?? '');

    // ── PUT — guardar columnas ────────────────────────────────────────────────
    if ($method === 'PUT') {
        $data = [
            'baseColumns'   => $body['baseColumns']   ?? [],
            'customColumns' => $body['customColumns'] ?? [],
        ];
        save_columns($db, $tabId, $data);
        if ($historyUserId) {
            try {
                history_log_audit($db, $tabId, $historyUserId, $historyUserName, 'columns_update', 'Actualizó columnas');
            } catch (Throwable $e) {
                error_log('notion history log: ' . $e->getMessage());
            }
        }
        echo json_encode(load_columns($db, $tabId));
        exit;
    }

    // ── POST — guardar columnas (alias de PUT) ────────────────────────────────
    if ($method === 'POST') {
        $data = [
            'baseColumns'   => $body['baseColumns']   ?? [],
            'customColumns' => $body['customColumns'] ?? [],
        ];
        save_columns($db, $tabId, $data);
        if ($historyUserId) {
            try {
                history_log_audit($db, $tabId, $historyUserId, $historyUserName, 'columns_update', 'Actualizó columnas');
            } catch (Throwable $e) {
                error_log('notion history log: ' . $e->getMessage());
            }
        }
        echo json_encode(load_columns($db, $tabId));
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
