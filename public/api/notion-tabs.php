<?php
header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Cache-Control: no-store, no-cache, must-revalidate");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';

const TRASH_RETENTION_DAYS = 15;

function safe_id(string $id): string {
    return preg_replace('/[^a-zA-Z0-9_\-]/', '', $id);
}

function generate_tab_id(): string {
    return 'notion_' . (int)(microtime(true) * 1000) . '_' . substr(bin2hex(random_bytes(3)), 0, 6);
}

/** Copiar columnas entre pestañas (MySQL) */
function notion_dup_load_cols(PDO $db, string $tabId): array {
    $stmt = $db->prepare('SELECT `base_columns`,`custom_columns` FROM `notion_columns` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return ['baseColumns' => [], 'customColumns' => []];
    }
    return [
        'baseColumns' => json_decode($row['base_columns'], true) ?: [],
        'customColumns' => json_decode($row['custom_columns'], true) ?: [],
    ];
}

function notion_dup_save_cols(PDO $db, string $tabId, array $data): void {
    $db->prepare('INSERT INTO `notion_columns` (`tab_id`,`base_columns`,`custom_columns`) VALUES (?,?,?)
                  ON DUPLICATE KEY UPDATE `base_columns`=VALUES(`base_columns`),`custom_columns`=VALUES(`custom_columns`)')
       ->execute([
           $tabId,
           json_encode($data['baseColumns'] ?? [], JSON_UNESCAPED_UNICODE),
           json_encode($data['customColumns'] ?? [], JSON_UNESCAPED_UNICODE),
       ]);
}

function notion_dup_load_tasks(PDO $db, string $tabId): array {
    $stmt = $db->prepare('SELECT `tasks` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return [];
    }
    return json_decode($row['tasks'], true) ?: [];
}

function notion_dup_save_tasks(PDO $db, string $tabId, array $tasks): void {
    $db->prepare('INSERT INTO `notion_tasks` (`tab_id`,`tasks`) VALUES (?,?)
                  ON DUPLICATE KEY UPDATE `tasks`=VALUES(`tasks`)')
       ->execute([$tabId, json_encode($tasks, JSON_UNESCAPED_UNICODE)]);
}

function notion_ensure_tab_storage(PDO $db, string $tabId): void {
    $stmt = $db->prepare('SELECT 1 FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    if (!$stmt->fetch()) {
        notion_dup_save_tasks($db, $tabId, []);
    }
    $stmt = $db->prepare('SELECT 1 FROM `notion_columns` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    if (!$stmt->fetch()) {
        $defaults = [
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
        notion_dup_save_cols($db, $tabId, $defaults);
    }
}

function get_user_id(): string {
    $raw = $_GET['userId'] ?? '';
    return safe_id($raw);
}

function load_tabs(PDO $db, string $userId, bool $seedIfMissing = true): array {
    $data = notion_load_tabs($db, $userId, false);
    if (!empty($data['_missing'])) {
        unset($data['_missing']);
        if (!$seedIfMissing) {
            return ['activeTabId' => '', 'tabs' => [], 'trash' => []];
        }
        $defaultTabId = 'notion_default_' . $userId;
        $now = date('c');
        $defaultTab = [['id' => $defaultTabId, 'title' => 'Nueva tabla', 'createdAt' => $now, 'updatedAt' => $now]];
        $data = ['activeTabId' => $defaultTabId, 'tabs' => $defaultTab, 'trash' => []];
        notion_save_tabs_data($db, $userId, $data);
        notion_ensure_tab_storage($db, $defaultTabId);
        return $data;
    }
    unset($data['_missing']);
    // Auto-reparar JSON con ids duplicados (persistir deduplicación).
    $stmt = $db->prepare('SELECT `tabs`,`trash` FROM `notion_tabs` WHERE `user_id` = ? LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        $rawTabs = json_decode($row['tabs'], true) ?: [];
        $rawTrash = json_decode($row['trash'], true) ?: [];
        if (count($rawTabs) !== count($data['tabs']) || count($rawTrash) !== count($data['trash'])) {
            notion_save_tabs_data($db, $userId, $data);
        }
    }
    return $data;
}

function save_tabs(PDO $db, string $userId, array $data): void {
    notion_save_tabs_data($db, $userId, $data);
}

function prune_trash(array $trash): array {
    $cutoff = time() - TRASH_RETENTION_DAYS * 86400;
    return array_values(array_filter($trash, function($t) use ($cutoff) {
        if (empty($t['trashedAt'])) return true;
        return strtotime($t['trashedAt']) > $cutoff;
    }));
}

function notion_normalize_tabs_order(array $tabs): array {
    $pinned = [];
    $unpinned = [];
    foreach ($tabs as $t) {
        if (!empty($t['pinned'])) {
            $pinned[] = $t;
        } else {
            $unpinned[] = $t;
        }
    }
    return array_merge($pinned, $unpinned);
}

/** Elimina pestañas repetidas por id (corrige estados corruptos en JSON). */
function notion_dedupe_tabs(array $tabs): array {
    $seen = [];
    $out = [];
    foreach ($tabs as $t) {
        if (!is_array($t)) continue;
        $id = safe_id($t['id'] ?? '');
        if (!$id || isset($seen[$id])) continue;
        $seen[$id] = true;
        $t['id'] = $id;
        $out[] = $t;
    }
    return $out;
}

function notion_unique_tab_title(array $tabs, string $base = 'Nueva tabla'): string {
    $base = trim($base) ?: 'Nueva tabla';
    $existing = [];
    foreach ($tabs as $t) {
        if (!empty($t['title'])) {
            $existing[mb_strtolower(trim($t['title']))] = true;
        }
    }
    if (!isset($existing[mb_strtolower($base)])) {
        return $base;
    }
    $n = 2;
    while (isset($existing[mb_strtolower($base . ' ' . $n)])) {
        $n++;
    }
    return $base . ' ' . $n;
}

function notion_parse_tabs_row(?array $row): array {
    if (!$row) {
        return ['activeTabId' => '', 'tabs' => [], 'trash' => []];
    }
    $tabs = notion_dedupe_tabs(json_decode($row['tabs'], true) ?: []);
    $trash = notion_dedupe_tabs(json_decode($row['trash'], true) ?: []);
    $active = safe_id($row['active_tab_id'] ?? '');
    if ($active && !in_array($active, array_column($tabs, 'id'), true)) {
        $active = $tabs[0]['id'] ?? '';
    }
    return [
        'activeTabId' => $active,
        'tabs'        => notion_normalize_tabs_order($tabs),
        'trash'       => $trash,
    ];
}

function notion_load_tabs(PDO $db, string $userId, bool $forUpdate = false): array {
    $sql = 'SELECT * FROM `notion_tabs` WHERE `user_id` = ? LIMIT 1';
    if ($forUpdate) {
        $sql .= ' FOR UPDATE';
    }
    $stmt = $db->prepare($sql);
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return ['activeTabId' => '', 'tabs' => [], 'trash' => [], '_missing' => true];
    }
    return notion_parse_tabs_row($row);
}

function notion_save_tabs_data(PDO $db, string $userId, array $data): array {
    $data['tabs'] = notion_normalize_tabs_order(notion_dedupe_tabs($data['tabs'] ?? []));
    $data['trash'] = notion_dedupe_tabs($data['trash'] ?? []);
    if (!empty($data['activeTabId'])) {
        $data['activeTabId'] = safe_id($data['activeTabId']);
    }
    if (empty($data['activeTabId']) && !empty($data['tabs'])) {
        $data['activeTabId'] = $data['tabs'][0]['id'];
    }
    $db->prepare('INSERT INTO `notion_tabs` (`user_id`,`active_tab_id`,`tabs`,`trash`) VALUES (?,?,?,?)
                  ON DUPLICATE KEY UPDATE `active_tab_id`=VALUES(`active_tab_id`),`tabs`=VALUES(`tabs`),`trash`=VALUES(`trash`)')
       ->execute([
           $userId,
           $data['activeTabId'] ?? '',
           json_encode($data['tabs'], JSON_UNESCAPED_UNICODE),
           json_encode($data['trash'], JSON_UNESCAPED_UNICODE),
       ]);
    return $data;
}

function notion_respond_tabs(PDO $db, string $userId, array $data): void {
    $saved = notion_save_tabs_data($db, $userId, $data);
    if ($db->inTransaction()) {
        $db->commit();
    }
    echo json_encode($saved, JSON_UNESCAPED_UNICODE);
    exit;
}

function notion_abort(PDO $db, int $code, string $message): void {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    http_response_code($code);
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

function notion_reorder_respects_pins(array $tabs, array $order): bool {
    $pCount = 0;
    foreach ($tabs as $t) {
        if (!empty($t['pinned'])) {
            $pCount++;
        }
    }
    $pinnedIds = [];
    $unpinnedIds = [];
    foreach ($tabs as $t) {
        if (!empty($t['pinned'])) {
            $pinnedIds[$t['id']] = true;
        } else {
            $unpinnedIds[$t['id']] = true;
        }
    }
    $prefix = array_slice($order, 0, $pCount);
    $suffix = array_slice($order, $pCount);
    foreach ($prefix as $id) {
        if (!isset($pinnedIds[$id])) {
            return false;
        }
    }
    foreach ($suffix as $id) {
        if (!isset($unpinnedIds[$id])) {
            return false;
        }
    }
    return true;
}

try {
    $db     = get_db();
    $userId = get_user_id() ?: 'default';
    $method = $_SERVER['REQUEST_METHOD'];

    // ── GET ───────────────────────────────────────────────────────────────────
    if ($method === 'GET') {
        $data = load_tabs($db, $userId, true);
        $data['trash'] = prune_trash($data['trash']);
        echo json_encode($data);
        exit;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    $db->beginTransaction();
    try {
        $data = notion_load_tabs($db, $userId, true);
        if (!empty($data['_missing'])) {
            unset($data['_missing']);
            $data = ['activeTabId' => '', 'tabs' => [], 'trash' => []];
        } else {
            unset($data['_missing']);
        }
        $data['trash'] = prune_trash($data['trash']);

    // ── POST — crear tab ──────────────────────────────────────────────────────
    if ($method === 'POST') {
        $action = $body['action'] ?? 'create';

        if ($action === 'restore') {
            $tabId = safe_id($body['tabId'] ?? $body['id'] ?? '');
            $idx   = array_search($tabId, array_column($data['trash'], 'id'));
            if ($idx === false) {
                notion_abort($db, 404, 'Tab no encontrado en papelera');
            }
            $tab = $data['trash'][$idx];
            unset($tab['trashedAt']);
            $tab['updatedAt'] = date('c');
            $existingIds = array_column($data['tabs'], 'id');
            if (!in_array($tabId, $existingIds, true)) {
                $data['tabs'][] = $tab;
            }
            array_splice($data['trash'], $idx, 1);
            $data['activeTabId'] = $tabId;
            notion_respond_tabs($db, $userId, $data);
        }

        if ($action === 'permanentDelete') {
            $tabId = safe_id($body['tabId'] ?? $body['id'] ?? '');
            $data['trash'] = array_values(array_filter($data['trash'], fn($t) => $t['id'] !== $tabId));
            notion_respond_tabs($db, $userId, $data);
        }

        if ($action === 'reorder') {
            $order = $body['tabIds'] ?? [];
            if (!is_array($order)) {
                notion_abort($db, 400, 'tabIds inválido');
            }
            $ids = array_column($data['tabs'], 'id');
            if (count($order) !== count($ids)) {
                notion_abort($db, 400, 'orden inválido');
            }
            $order = array_map('safe_id', $order);
            $sortedIds = $ids;
            $sortedOrder = $order;
            sort($sortedIds);
            sort($sortedOrder);
            if ($sortedIds !== $sortedOrder) {
                notion_abort($db, 400, 'orden inválido');
            }
            if (!notion_reorder_respects_pins($data['tabs'], $order)) {
                notion_abort($db, 400, 'Las pestañas fijadas deben ir antes que el resto');
            }
            $map = [];
            foreach ($data['tabs'] as $t) {
                $map[$t['id']] = $t;
            }
            $reordered = [];
            foreach ($order as $oid) {
                $reordered[] = $map[$oid];
            }
            $data['tabs'] = $reordered;
            notion_respond_tabs($db, $userId, $data);
        }

        if ($action === 'setPinned') {
            $tabId = safe_id($body['id'] ?? $body['tabId'] ?? '');
            if (!$tabId) {
                notion_abort($db, 400, 'id requerido');
            }
            $pinned = !empty($body['pinned']);
            $found = false;
            foreach ($data['tabs'] as &$tab) {
                if ($tab['id'] === $tabId) {
                    if ($pinned) {
                        $tab['pinned'] = true;
                    } else {
                        unset($tab['pinned']);
                    }
                    $tab['updatedAt'] = date('c');
                    $found = true;
                    break;
                }
            }
            unset($tab);
            if (!$found) {
                notion_abort($db, 404, 'Tab no encontrada');
            }
            notion_respond_tabs($db, $userId, $data);
        }

        if ($action === 'duplicate') {
            $sourceId = safe_id($body['sourceTabId'] ?? '');
            $src = null;
            foreach ($data['tabs'] as $t) {
                if ($t['id'] === $sourceId) {
                    $src = $t;
                    break;
                }
            }
            if (!$src) {
                notion_abort($db, 404, 'Tab no encontrada');
            }
            $newId = generate_tab_id();
            $now = date('c');
            $cols = notion_dup_load_cols($db, $sourceId);
            notion_dup_save_cols($db, $newId, $cols);
            $tasksCopy = notion_dup_load_tasks($db, $sourceId);
            notion_dup_save_tasks($db, $newId, $tasksCopy);
            $baseTitle = trim($src['title'] ?? 'Sin título');
            $newTab = [
                'id' => $newId,
                'title' => mb_substr(notion_unique_tab_title($data['tabs'], $baseTitle . ' (copia)'), 0, 200),
                'createdAt' => $now,
                'updatedAt' => $now,
            ];
            $idx = array_search($sourceId, array_column($data['tabs'], 'id'), true);
            if ($idx === false) {
                $data['tabs'][] = $newTab;
            } else {
                array_splice($data['tabs'], $idx + 1, 0, [$newTab]);
            }
            $data['activeTabId'] = $newId;
            notion_respond_tabs($db, $userId, $data);
        }

        // Crear nuevo tab
        $requestedTitle = trim($body['title'] ?? '');
        $title = notion_unique_tab_title($data['tabs'], $requestedTitle !== '' ? $requestedTitle : 'Nueva tabla');
        $now   = date('c');
        $newId = generate_tab_id();
        $newTab = ['id' => $newId, 'title' => $title, 'createdAt' => $now, 'updatedAt' => $now];
        $data['tabs'][]      = $newTab;
        $data['activeTabId'] = $newId;
        notion_ensure_tab_storage($db, $newId);
        notion_respond_tabs($db, $userId, $data);
    }

    // ── PUT — renombrar / cambiar tab activo ──────────────────────────────────
    if ($method === 'PUT') {
        $tabId = safe_id($body['tabId'] ?? $body['id'] ?? '');
        if (!$tabId) {
            notion_abort($db, 400, 'tabId requerido');
        }

        if (isset($body['activeTabId'])) {
            $data['activeTabId'] = safe_id($body['activeTabId']);
            notion_respond_tabs($db, $userId, $data);
        }

        $found = false;
        foreach ($data['tabs'] as &$tab) {
            if ($tab['id'] === $tabId) {
                if (isset($body['title'])) {
                    $tab['title'] = trim($body['title']);
                }
                $tab['updatedAt'] = date('c');
                $found = true;
                break;
            }
        }
        unset($tab);
        if (!$found) {
            notion_abort($db, 404, 'Tab no encontrado');
        }
        notion_respond_tabs($db, $userId, $data);
    }

    // ── DELETE — mover a papelera o eliminar permanente ───────────────────────
    if ($method === 'DELETE') {
        $tabId    = safe_id($_GET['tabId'] ?? $_GET['id'] ?? $body['tabId'] ?? $body['id'] ?? '');
        $permanent = !empty($_GET['permanent']) || !empty($body['permanent']);
        if (!$tabId) {
            notion_abort($db, 400, 'tabId requerido');
        }

        if ($permanent) {
            $data['trash'] = array_values(array_filter($data['trash'], fn($t) => $t['id'] !== $tabId));
        } else {
            $idx = array_search($tabId, array_column($data['tabs'], 'id'));
            if ($idx === false) {
                notion_abort($db, 404, 'Tab no encontrado');
            }
            $tab = $data['tabs'][$idx];
            $tab['trashedAt'] = date('c');
            $data['trash'][]  = $tab;
            array_splice($data['tabs'], $idx, 1);
            if ($data['activeTabId'] === $tabId) {
                $data['activeTabId'] = !empty($data['tabs']) ? $data['tabs'][0]['id'] : '';
            }
        }
        notion_respond_tabs($db, $userId, $data);
    }

    notion_abort($db, 405, 'Método no permitido');

    } catch (Exception $inner) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $inner;
    }

} catch (Exception $e) {
    if (isset($db) && $db->inTransaction()) {
        $db->rollBack();
    }
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
