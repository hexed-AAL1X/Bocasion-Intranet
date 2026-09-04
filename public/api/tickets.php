<?php
header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';

/**
 * El id en MySQL es el "Nº ticket" (como string) para que coincida
 * con lo que el frontend manda en DELETE: { id: ticket["Nº ticket"] }
 */
function ticket_id(array $ticket): string {
    $nro = $ticket['Nº ticket'] ?? $ticket['id'] ?? null;
    if ($nro !== null && $nro !== '') return (string)$nro;
    return 'ticket_' . (int)(microtime(true) * 1000) . '_' . substr(bin2hex(random_bytes(3)), 0, 6);
}

function load_tickets(PDO $db): array {
    $rows = $db->query('SELECT `id`, `data` FROM `tickets` ORDER BY CAST(`id` AS UNSIGNED) DESC, `created_at` DESC')->fetchAll();
    return array_values(array_filter(array_map(function($r) {
        $ticket = json_decode($r['data'], true);
        if (!is_array($ticket)) return null;
        // Siempre inyectamos el id de MySQL para que el frontend pueda eliminar
        // incluso si el ticket no tiene "Nº ticket" en su data JSON
        $ticket['_dbId'] = $r['id'];
        return $ticket;
    }, $rows)));
}

function upsert_ticket(PDO $db, array $ticket): void {
    $id  = ticket_id($ticket);
    $now = date('Y-m-d H:i:s');
    $created = isset($ticket['createdAt'])
        ? date('Y-m-d H:i:s', strtotime($ticket['createdAt']))
        : $now;
    $db->prepare(
        'INSERT INTO `tickets` (`id`,`data`,`created_at`,`updated_at`) VALUES (?,?,?,?)
         ON DUPLICATE KEY UPDATE `data`=VALUES(`data`),`updated_at`=VALUES(`updated_at`)'
    )->execute([$id, json_encode($ticket, JSON_UNESCAPED_UNICODE), $created, $now]);
}

try {
    $db     = get_db();
    $method = $_SERVER['REQUEST_METHOD'];

    // ── GET ───────────────────────────────────────────────────────────────────
    if ($method === 'GET') {
        echo json_encode(load_tickets($db));
        exit;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    // ── POST — crear / importar ticket ────────────────────────────────────────
    if ($method === 'POST') {
        if (!isset($body['createdAt'])) $body['createdAt'] = date('c');
        $body['updatedAt'] = date('c');

        // Detectar importación masiva (array de tickets)
        if (isset($body[0]) || (is_array($body) && array_keys($body) === range(0, count($body) - 1))) {
            $imported = 0;
            $list = array_values($body);
            if (!empty($list) && is_array($list[0])) {
                foreach ($list as $t) {
                    if (!is_array($t)) continue;
                    if (!isset($t['createdAt'])) $t['createdAt'] = date('c');
                    $t['updatedAt'] = date('c');
                    upsert_ticket($db, $t);
                    $imported++;
                }
                echo json_encode(load_tickets($db));
                exit;
            }
        }

        // Ticket individual — verificar duplicado por Nº ticket
        $nro = $body['Nº ticket'] ?? null;
        if ($nro !== null) {
            $check = $db->prepare('SELECT id FROM `tickets` WHERE `id` = ? LIMIT 1');
            $check->execute([(string)$nro]);
            if ($check->fetch()) {
                http_response_code(409);
                echo json_encode(['error' => 'El Nº ticket ' . $nro . ' ya existe']);
                exit;
            }
        }

        upsert_ticket($db, $body);
        echo json_encode(load_tickets($db));
        exit;
    }

    // ── PUT — actualizar ticket ───────────────────────────────────────────────
    if ($method === 'PUT') {
        $id = (string)($body['id'] ?? $body['Nº ticket'] ?? '');
        if ($id === '') { http_response_code(400); echo json_encode(['error' => 'id requerido']); exit; }

        $stmt = $db->prepare('SELECT `data` FROM `tickets` WHERE `id` = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) { http_response_code(404); echo json_encode(['error' => 'Ticket no encontrado']); exit; }

        $existing = json_decode($row['data'], true) ?: [];
        $updated  = array_merge($existing, $body, ['updatedAt' => date('c')]);
        upsert_ticket($db, $updated);
        echo json_encode(load_tickets($db));
        exit;
    }

    // ── DELETE — eliminar ticket ──────────────────────────────────────────────
    if ($method === 'DELETE') {
        // Prioridad: query string → _dbId → id → Nº ticket
        $id = (string)($_GET['id'] ?? $body['_dbId'] ?? $body['id'] ?? $body['Nº ticket'] ?? '');
        if ($id === '') { http_response_code(400); echo json_encode(['error' => 'id requerido']); exit; }

        $stmt = $db->prepare('DELETE FROM `tickets` WHERE `id` = ?');
        $stmt->execute([$id]);

        if ($stmt->rowCount() === 0) {
            http_response_code(404);
            echo json_encode(['error' => 'Ticket no encontrado (id: ' . $id . ')']);
            exit;
        }
        echo json_encode(load_tickets($db));
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
