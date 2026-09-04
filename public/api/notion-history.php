<?php
header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Cache-Control: no-store, no-cache, must-revalidate");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/notion-history-lib.php';

try {
    $db     = get_db();
    $method = $_SERVER['REQUEST_METHOD'];
    $userId = history_safe_id($_GET['userId'] ?? '');
    $tabId  = history_safe_id($_GET['tabId'] ?? '');

    if (!$userId) {
        http_response_code(400);
        echo json_encode(['error' => 'userId requerido']);
        exit;
    }

    history_ensure_tables($db);

    // ── GET ───────────────────────────────────────────────────────────────────
    if ($method === 'GET') {
        $revisionId = history_safe_id($_GET['revisionId'] ?? '');

        if ($revisionId && $tabId) {
            if (!history_user_can_access_tab($db, $userId, $tabId)) {
                http_response_code(403);
                echo json_encode(['error' => 'Sin acceso']);
                exit;
            }
            $revision = history_get_revision($db, $userId, $tabId, $revisionId);
            if (!$revision) {
                http_response_code(404);
                echo json_encode(['error' => 'Revisión no encontrada']);
                exit;
            }
            echo json_encode($revision);
            exit;
        }

        echo json_encode([
            'tabTitles' => history_get_tab_titles($db, $userId),
            'revisions' => history_list_revisions($db, $userId, $tabId ?: null),
            'audit'     => history_list_audit($db, $userId, $tabId ?: null),
        ]);
        exit;
    }

    // ── POST ──────────────────────────────────────────────────────────────────
    if ($method === 'POST') {
        $body     = json_decode(file_get_contents('php://input'), true) ?? [];
        $action   = $body['action'] ?? '';
        $tabId    = history_safe_id($body['tabId'] ?? $tabId);
        $userName = trim($body['userName'] ?? '');

        if (!$tabId) {
            http_response_code(400);
            echo json_encode(['error' => 'tabId requerido']);
            exit;
        }
        if (!history_user_can_access_tab($db, $userId, $tabId)) {
            http_response_code(403);
            echo json_encode(['error' => 'Sin acceso a esta tabla']);
            exit;
        }

        switch ($action) {
            case 'create_revision': {
                $label = trim($body['label'] ?? 'Revisión manual');
                $revision = history_create_snapshot_from_live($db, $tabId, $userId, $userName, 'manual', $label);
                if (!$revision) {
                    echo json_encode(['ok' => true, 'skipped' => true, 'message' => 'Sin cambios respecto a la última revisión']);
                    exit;
                }
                history_log_audit($db, $tabId, $userId, $userName, 'manual_revision', $label, [
                    'revisionId'  => $revision['id'],
                    'revisionNum' => $revision['revisionNum'],
                ]);
                echo json_encode(['ok' => true, 'revision' => $revision]);
                exit;
            }

            case 'stable_checkpoint': {
                $revision = history_maybe_auto_revision($db, $tabId, $userId, $userName);
                echo json_encode(['ok' => true, 'revision' => $revision, 'skipped' => $revision === null]);
                exit;
            }

            case 'pre_bulk_delete': {
                $beforeCount  = (int)($body['beforeCount'] ?? 0);
                $deleteCount  = (int)($body['deleteCount'] ?? 0);
                $revision = history_create_pre_destructive($db, $tabId, $userId, $userName, $beforeCount, $deleteCount);
                echo json_encode(['ok' => true, 'revision' => $revision]);
                exit;
            }

            case 'apply_revision': {
                $revisionId = history_safe_id($body['revisionId'] ?? '');
                if (!$revisionId) {
                    http_response_code(400);
                    echo json_encode(['error' => 'revisionId requerido']);
                    exit;
                }
                $result = history_apply_revision($db, $tabId, $revisionId, $userId, $userName);
                echo json_encode(array_merge(['ok' => true], $result));
                exit;
            }

            case 'pin_revision': {
                $revisionId = history_safe_id($body['revisionId'] ?? '');
                $pinned = !empty($body['pinned']);
                $stmt = $db->prepare('UPDATE `notion_tab_revisions` SET `pinned` = ? WHERE `id` = ? AND `tab_id` = ?');
                $stmt->execute([$pinned ? 1 : 0, $revisionId, $tabId]);
                echo json_encode(['ok' => true]);
                exit;
            }

            case 'restore_latest': {
                $result = history_restore_latest_nonempty($db, $tabId, $userId, $userName);
                if (!$result) {
                    echo json_encode(['ok' => true, 'restored' => false, 'message' => 'No hay revisión recuperable o la tabla ya tiene datos']);
                    exit;
                }
                echo json_encode(array_merge(['ok' => true, 'restored' => true], $result));
                exit;
            }

            default:
                http_response_code(400);
                echo json_encode(['error' => 'action inválida']);
                exit;
        }
    }

    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);

} catch (RuntimeException $e) {
    $msg = $e->getMessage();
    $code = str_contains($msg, 'no encontrada') || str_contains($msg, 'Sin acceso') ? 404 : 500;
    if (str_contains($msg, 'Sin acceso')) $code = 403;
    http_response_code($code);
    echo json_encode(['error' => $msg]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
