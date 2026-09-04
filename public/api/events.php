<?php
header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';

function get_user_id(): string {
    $raw = $_GET['userId'] ?? 'default';
    return preg_replace('/[^a-zA-Z0-9_\-]/', '', $raw) ?: 'default';
}

function load_events(PDO $db, string $userId): array {
    $stmt = $db->prepare('SELECT `events` FROM `cal_events` WHERE `user_id` = ? LIMIT 1');
    $stmt->execute([$userId]);
    $row = $stmt->fetch();
    if (!$row) return [];
    return json_decode($row['events'], true) ?: [];
}

function save_events(PDO $db, string $userId, array $events): void {
    $db->prepare('INSERT INTO `cal_events` (`user_id`,`events`) VALUES (?,?)
                  ON DUPLICATE KEY UPDATE `events`=VALUES(`events`)')
       ->execute([$userId, json_encode($events, JSON_UNESCAPED_UNICODE)]);
}

try {
    $db     = get_db();
    $method = $_SERVER['REQUEST_METHOD'];
    $userId = get_user_id();
    $events = load_events($db, $userId);

    // ── GET ───────────────────────────────────────────────────────────────────
    if ($method === 'GET') {
        echo json_encode($events);
        exit;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    // ── POST — crear evento ───────────────────────────────────────────────────
    if ($method === 'POST') {
        $id    = $body['id']    ?? ('event_' . time() . '_' . substr(bin2hex(random_bytes(3)), 0, 6));
        $title = trim($body['title'] ?? '');
        $date  = $body['date']  ?? '';
        if (!$title || !$date) {
            http_response_code(400);
            echo json_encode(['error' => 'title y date son requeridos']);
            exit;
        }
        $events[] = ['id' => $id, 'title' => $title, 'date' => $date];
        save_events($db, $userId, $events);
        echo json_encode($events);
        exit;
    }

    // ── PUT — actualizar evento ───────────────────────────────────────────────
    if ($method === 'PUT') {
        $id = $body['id'] ?? '';
        if (!$id) { http_response_code(400); echo json_encode(['error' => 'id requerido']); exit; }

        $found = false;
        foreach ($events as &$ev) {
            if ($ev['id'] === $id) {
                if (isset($body['title'])) $ev['title'] = trim($body['title']);
                if (isset($body['date']))  $ev['date']  = $body['date'];
                $found = true;
                break;
            }
        }
        unset($ev);
        if (!$found) { http_response_code(404); echo json_encode(['error' => 'Evento no encontrado']); exit; }
        save_events($db, $userId, $events);
        echo json_encode($events);
        exit;
    }

    // ── DELETE — eliminar evento ──────────────────────────────────────────────
    if ($method === 'DELETE') {
        $id = $body['id'] ?? '';
        if (!$id) { http_response_code(400); echo json_encode(['error' => 'id requerido']); exit; }

        $filtered = array_values(array_filter($events, fn($e) => $e['id'] !== $id));
        if (count($filtered) === count($events)) {
            http_response_code(404); echo json_encode(['error' => 'Evento no encontrado']); exit;
        }
        save_events($db, $userId, $filtered);
        echo json_encode($filtered);
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
