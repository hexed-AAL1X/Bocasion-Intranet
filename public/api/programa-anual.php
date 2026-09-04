<?php
header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/programa-anual-lib.php';

try {
    $db = get_db();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        $rows = pa_fetch_all($db);
        if (count($rows) === 0) {
            $dataDir = __DIR__ . '/../data';
            $imported = pa_import_from_json_dir($db, $dataDir, true);
            if ($imported > 0) {
                $rows = pa_fetch_all($db);
            }
        }
        if (count($rows) === 0) {
            http_response_code(503);
            echo json_encode(['error' => 'Sin actividades en BD. Ejecutar sync.php?mode=json_to_db o importar Excel.']);
            exit;
        }
        echo json_encode($rows, JSON_UNESCAPED_UNICODE);
        exit;
    }

    if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
        $user = pa_require_staff();
        $userId = $user['id'] ?? null;
        $body = json_decode(file_get_contents('php://input'), true);
        if (!is_array($body)) $body = [];
        $id = isset($body['id']) ? (string)$body['id'] : '';

        if ($method === 'POST') {
            $act = pa_create($db, $body, $userId);
            echo json_encode(['ok' => true, 'actividad' => $act], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if ($method === 'PUT') {
            $newMeta = $body['meta'] ?? null;
            if ($id === '' || !is_array($newMeta)) {
                http_response_code(400);
                echo json_encode(['error' => 'id y meta requeridos']);
                exit;
            }
            $meta = pa_update_meta($db, $id, $newMeta, $userId);
            echo json_encode(['ok' => true, 'meta' => $meta['meta']], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if ($method === 'PATCH') {
            $patch = $body['patch'] ?? null;
            if ($id === '' || !is_array($patch)) {
                http_response_code(400);
                echo json_encode(['error' => 'id y patch requeridos']);
                exit;
            }
            $act = pa_patch($db, $id, $patch, $userId);
            echo json_encode(['ok' => true, 'actividad' => $act], JSON_UNESCAPED_UNICODE);
            exit;
        }

        if ($method === 'DELETE') {
            $scope = $body['scope'] ?? '';
            if ($id === '' || !in_array($scope, ['meta', 'override', 'actividad'], true)) {
                http_response_code(400);
                echo json_encode(['error' => 'id y scope (meta|override|actividad) requeridos']);
                exit;
            }
            pa_delete_scope($db, $id, $scope, $userId);
            echo json_encode(['ok' => true], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
