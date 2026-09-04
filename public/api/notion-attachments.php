<?php
header('Content-Type: application/json; charset=UTF-8');
mb_internal_encoding('UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

require_once __DIR__ . '/notion-attachments-lib.php';

$tabId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['tabId'] ?? $_POST['tabId'] ?? '');

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    if ($tabId === '') {
        $tabId = preg_replace('/[^a-zA-Z0-9_\-]/', '', $body['tabId'] ?? '');
    }
    if ($tabId === '') {
        http_response_code(400);
        echo json_encode(['error' => 'tabId requerido']);
        exit;
    }
    $file = $body['file'] ?? $body;
    if (!is_array($file)) {
        http_response_code(400);
        echo json_encode(['error' => 'file requerido']);
        exit;
    }
    try {
        $saved = notion_persist_attachment_item($tabId, $file);
        echo json_encode(['ok' => true, 'attachment' => $saved], JSON_UNESCAPED_UNICODE);
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['error' => $e->getMessage()]);
    }
    exit;
}

header('Cache-Control: private, max-age=86400');
header('Access-Control-Allow-Methods: GET, OPTIONS');

$id = preg_replace('/[^a-zA-Z0-9_\-]/', '', $_GET['id'] ?? '');

if ($tabId === '' || $id === '') {
    http_response_code(400);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode(['error' => 'tabId e id requeridos']);
    exit;
}

notion_try_recover_attachment($tabId, $id);

$meta = notion_load_attachment_meta($tabId, $id);
if ($meta === null) {
    http_response_code(404);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode(['error' => 'Adjunto no encontrado']);
    exit;
}

$bytes = notion_load_attachment_bytes($tabId, $id);
if ($bytes === null) {
    http_response_code(404);
    header('Content-Type: application/json; charset=UTF-8');
    echo json_encode(['error' => 'Archivo no encontrado']);
    exit;
}

$mime = (string)($meta['type'] ?? 'application/octet-stream');
header('Content-Type: ' . $mime);
header('Content-Length: ' . strlen($bytes));
header('Content-Disposition: inline; filename="' . str_replace('"', '', (string)($meta['name'] ?? 'archivo')) . '"');
echo $bytes;
