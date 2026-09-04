<?php
header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Cache-Control: no-store, no-cache, must-revalidate");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/notion-attachments-lib.php';

function tasks_require_history_lib(): void {
    static $loaded = false;
    if (!$loaded) {
        require_once __DIR__ . '/notion-history-lib.php';
        $loaded = true;
    }
}

function safe_tab_id(string $id): string {
    return preg_replace('/[^a-zA-Z0-9_\-]/', '', $id);
}

function generate_task_id(): string {
    return 'task_' . (int)(microtime(true) * 1000) . '_' . substr(bin2hex(random_bytes(4)), 0, 7);
}

function load_tasks_locked(PDO $db, string $tabId): array {
    $stmt = $db->prepare('SELECT `tasks` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1 FOR UPDATE');
    $stmt->execute([$tabId]);
    $row = $stmt->fetch();
    if (!$row) return [];
    $decoded = json_decode($row['tasks'], true);
    return is_array($decoded) ? $decoded : [];
}

function save_tasks(PDO $db, string $tabId, array $tasks): void {
    $json = json_encode($tasks, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($json === false) {
        throw new RuntimeException('No se pudieron serializar las tareas (JSON inválido).');
    }
    $db->prepare('INSERT INTO `notion_tasks` (`tab_id`,`tasks`) VALUES (?,?)
                  ON DUPLICATE KEY UPDATE `tasks`=VALUES(`tasks`)')
       ->execute([$tabId, $json]);
}

function with_locked_tasks(PDO $db, string $tabId, callable $mutator): array {
    tasks_prepare_write();
    $db->beginTransaction();
    try {
        $tasks = load_tasks_locked($db, $tabId);
        $next = $mutator($tasks);
        if (!is_array($next)) {
            throw new RuntimeException('Estado de tareas inválido.');
        }
        save_tasks($db, $tabId, $next);
        $db->commit();
        return $next;
    } catch (Throwable $e) {
        if ($db->inTransaction()) {
            $db->rollBack();
        }
        throw $e;
    }
}

function tasks_prepare_write(): void {
    @ini_set('memory_limit', '512M');
    @set_time_limit(120);
}

function load_tasks_unlocked(PDO $db, string $tabId): array {
    $stmt = $db->prepare('SELECT `tasks`, JSON_VALID(`tasks`) AS `json_ok` FROM `notion_tasks` WHERE `tab_id` = ? LIMIT 1');
    $stmt->execute([$tabId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || !(int)($row['json_ok'] ?? 0)) {
        return [];
    }
    $decoded = json_decode((string)$row['tasks'], true);
    return is_array($decoded) ? $decoded : [];
}

function tasks_maybe_migrate_attachments(PDO $db, string $tabId, array $tasks): array {
    $before = json_encode($tasks, JSON_UNESCAPED_UNICODE);
    notion_persist_all_task_attachments($tasks, $tabId);
    $after = json_encode($tasks, JSON_UNESCAPED_UNICODE);
    if ($before !== $after) {
        save_tasks($db, $tabId, $tasks);
    }
    return $tasks;
}

function tasks_echo_transport(PDO $db, string $tabId, ?string $updatedTaskId = null): void {
    @ini_set('memory_limit', '512M');
    @set_time_limit(120);
    $tasks = load_tasks_unlocked($db, $tabId);
    $tasks = tasks_maybe_migrate_attachments($db, $tabId, $tasks);
    $transport = notion_strip_tasks_for_transport($tasks);
    if ($updatedTaskId !== null) {
        $updated = null;
        foreach ($transport as $task) {
            if (($task['id'] ?? '') === $updatedTaskId) {
                $updated = $task;
                break;
            }
        }
        echo json_encode([
            'ok' => true,
            'task' => $updated,
            'tasks' => $transport,
        ], JSON_UNESCAPED_UNICODE);
        return;
    }
    echo json_encode($transport, JSON_UNESCAPED_UNICODE);
}

function tasks_echo_raw(PDO $db, string $tabId): void {
    tasks_echo_transport($db, $tabId);
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
        tasks_echo_transport($db, $tabId);
        exit;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $now  = date('c');
    $historyUserId   = safe_tab_id($body['_historyUserId'] ?? $_GET['userId'] ?? '');
    $historyUserName = trim($body['_historyUserName'] ?? '');

    // ── POST — crear tarea ────────────────────────────────────────────────────
    if ($method === 'POST') {
        with_locked_tasks($db, $tabId, function (array $tasks) use ($body, $now, $tabId) {
            $payload = $body;
            unset($payload['_historyUserId'], $payload['_historyUserName']);
            $newTask = array_merge(
                ['id' => generate_task_id(), 'createdAt' => $now, 'updatedAt' => $now],
                $payload
            );
            $newTask['id']        = $newTask['id'] ?: generate_task_id();
            $newTask['createdAt'] = $newTask['createdAt'] ?: $now;
            $newTask['updatedAt'] = $now;
            notion_persist_task_attachments($newTask, $tabId);
            $tasks[] = $newTask;
            return $tasks;
        });
        if ($historyUserId) {
            try {
                tasks_require_history_lib();
                history_log_task_action($db, $tabId, $historyUserId, $historyUserName, 'POST', $body);
            } catch (Throwable $e) {
                error_log('notion history log: ' . $e->getMessage());
            }
        }
        tasks_echo_raw($db, $tabId);
        exit;
    }

    // ── PUT — actualizar tarea o reordenar filas ─────────────────────────────
    if ($method === 'PUT') {
        if (isset($body['_reorder']) && is_array($body['_reorder'])) {
            $order = array_values(array_filter($body['_reorder'], fn($id) => is_string($id) && $id !== ''));
            with_locked_tasks($db, $tabId, function (array $tasks) use ($order) {
                $byId = [];
                foreach ($tasks as $task) {
                    $tid = $task['id'] ?? '';
                    if ($tid !== '') $byId[$tid] = $task;
                }
                $reordered = [];
                foreach ($order as $id) {
                    if (isset($byId[$id])) {
                        $reordered[] = $byId[$id];
                        unset($byId[$id]);
                    }
                }
                foreach ($byId as $task) {
                    $reordered[] = $task;
                }
                return $reordered;
            });
            if ($historyUserId) {
                try {
                    tasks_require_history_lib();
                    history_log_task_action($db, $tabId, $historyUserId, $historyUserName, 'PUT', ['_reorder' => true, 'count' => count($order)]);
                } catch (Throwable $e) {
                    error_log('notion history log: ' . $e->getMessage());
                }
            }
            tasks_echo_raw($db, $tabId);
            exit;
        }

        $id = $body['id'] ?? '';
        if (!$id) { http_response_code(400); echo json_encode(['error' => 'id requerido']); exit; }

        with_locked_tasks($db, $tabId, function (array $tasks) use ($body, $id, $now, $tabId) {
            $payload = $body;
            unset($payload['_historyUserId'], $payload['_historyUserName']);
            $found = false;
            foreach ($tasks as &$task) {
                if (($task['id'] ?? '') === $id) {
                    foreach ($payload as $k => $v) {
                        if ($k !== 'id' && $k !== 'createdAt') {
                            $task[$k] = $v;
                        }
                    }
                    notion_persist_task_attachments($task, $tabId);
                    $task['updatedAt'] = $now;
                    $found = true;
                    break;
                }
            }
            unset($task);
            if (!$found) {
                throw new RuntimeException('Tarea no encontrada');
            }
            return $tasks;
        });
        if ($historyUserId) {
            try {
                tasks_require_history_lib();
                history_log_task_action($db, $tabId, $historyUserId, $historyUserName, 'PUT', $body);
            } catch (Throwable $e) {
                error_log('notion history log: ' . $e->getMessage());
            }
        }
        tasks_echo_transport($db, $tabId, (string)$id);
        exit;
    }

    // ── DELETE — eliminar tarea ───────────────────────────────────────────────
    if ($method === 'DELETE') {
        $id = $body['id'] ?? '';
        if (!$id) { http_response_code(400); echo json_encode(['error' => 'id requerido']); exit; }

        with_locked_tasks($db, $tabId, function (array $tasks) use ($id) {
            $safeId = (string)$id;
            $filtered = array_values(array_filter(
                $tasks,
                fn($t) => (string)($t['id'] ?? '') !== $safeId
            ));
            return $filtered;
        });
        if ($historyUserId) {
            try {
                tasks_require_history_lib();
                history_log_task_action($db, $tabId, $historyUserId, $historyUserName, 'DELETE', $body);
            } catch (Throwable $e) {
                error_log('notion history log: ' . $e->getMessage());
            }
        }
        tasks_echo_raw($db, $tabId);
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);

} catch (RuntimeException $e) {
    $msg = $e->getMessage();
    $code = str_contains($msg, 'no encontrada') ? 404 : 500;
    http_response_code($code);
    echo json_encode(['error' => $msg]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
