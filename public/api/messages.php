<?php
header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = get_db();

// -------------------------------------------------------
// GET — obtener conversaciones o mensajes entre dos usuarios
//   ?userId=X            → lista de conversaciones del usuario X
//   ?userId=X&withId=Y   → mensajes entre X e Y (también marca como leídos)
//   ?userId=X&unread=1   → solo conteo de no leídos
// -------------------------------------------------------
if ($method === 'GET') {
    $userId = $_GET['userId'] ?? '';
    $withId = $_GET['withId'] ?? '';
    $unread = $_GET['unread'] ?? '';

    if (!$userId) {
        http_response_code(400);
        echo json_encode(['error' => 'userId requerido']);
        exit;
    }

    if ($unread === '1') {
        $stmt = $db->prepare(
            'SELECT COUNT(*) AS cnt FROM messages WHERE to_id = ? AND read_at IS NULL'
        );
        $stmt->execute([$userId]);
        echo json_encode(['unread' => (int)$stmt->fetch()['cnt']]);
        exit;
    }

    if ($withId) {
        // Obtener todos los mensajes entre los dos usuarios
        $stmt = $db->prepare(
            'SELECT * FROM messages
             WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
             ORDER BY created_at ASC'
        );
        $stmt->execute([$userId, $withId, $withId, $userId]);
        $messages = $stmt->fetchAll();

        // Marcar como leídos los mensajes del otro usuario hacia este
        $db->prepare(
            'UPDATE messages SET read_at = NOW() WHERE to_id = ? AND from_id = ? AND read_at IS NULL'
        )->execute([$userId, $withId]);

        echo json_encode($messages);
        exit;
    }

    // Lista de conversaciones: último mensaje por interlocutor
    $stmt = $db->prepare(
        'SELECT m.*, u.display_name AS other_name
         FROM messages m
         JOIN users u ON u.id = CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END
         WHERE m.from_id = ? OR m.to_id = ?
         ORDER BY m.created_at DESC'
    );
    $stmt->execute([$userId, $userId, $userId]);
    $rows = $stmt->fetchAll();

    // Agrupar por interlocutor, quedarnos con el último mensaje
    $convs = [];
    foreach ($rows as $row) {
        $otherId = $row['from_id'] === $userId ? $row['to_id'] : $row['from_id'];
        if (!isset($convs[$otherId])) {
            $convs[$otherId] = $row;
        }
    }

    // Conteo de no leídos por interlocutor
    $unreadStmt = $db->prepare(
        'SELECT from_id, COUNT(*) AS cnt FROM messages
         WHERE to_id = ? AND read_at IS NULL GROUP BY from_id'
    );
    $unreadStmt->execute([$userId]);
    $unreadByUser = [];
    foreach ($unreadStmt->fetchAll() as $r) {
        $unreadByUser[$r['from_id']] = (int)$r['cnt'];
    }

    $result = [];
    foreach ($convs as $otherId => $conv) {
        $conv['unread'] = $unreadByUser[$otherId] ?? 0;
        $result[] = $conv;
    }

    echo json_encode(array_values($result));
    exit;
}

// -------------------------------------------------------
// POST — enviar un mensaje
//   body: { fromId, toId, content, msgType?, refId? }
// -------------------------------------------------------
if ($method === 'POST') {
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $fromId  = $body['fromId']  ?? '';
    $toId    = $body['toId']    ?? '';
    $content = trim($body['content'] ?? '');
    $msgType = $body['msgType'] ?? 'text';
    $refId   = $body['refId']   ?? null;

    if (!$fromId || !$toId || $content === '') {
        http_response_code(400);
        echo json_encode(['error' => 'fromId, toId y content requeridos']);
        exit;
    }

    $id  = uniqid('msg_', true);
    $now = date('Y-m-d H:i:s');

    $db->prepare(
        'INSERT INTO messages (id, from_id, to_id, content, msg_type, ref_id, created_at)
         VALUES (?,?,?,?,?,?,?)'
    )->execute([$id, $fromId, $toId, $content, $msgType, $refId, $now]);

    echo json_encode([
        'id'         => $id,
        'from_id'    => $fromId,
        'to_id'      => $toId,
        'content'    => $content,
        'msg_type'   => $msgType,
        'ref_id'     => $refId,
        'read_at'    => null,
        'created_at' => $now,
    ]);
    exit;
}

// -------------------------------------------------------
// PATCH — marcar mensajes como leídos
//   body: { userId, fromId }  → marca leídos los de fromId hacia userId
// -------------------------------------------------------
if ($method === 'PATCH') {
    $body   = json_decode(file_get_contents('php://input'), true) ?? [];
    $userId = $body['userId'] ?? '';
    $fromId = $body['fromId'] ?? '';

    if (!$userId || !$fromId) {
        http_response_code(400);
        echo json_encode(['error' => 'userId y fromId requeridos']);
        exit;
    }

    $db->prepare(
        'UPDATE messages SET read_at = NOW()
         WHERE to_id = ? AND from_id = ? AND read_at IS NULL'
    )->execute([$userId, $fromId]);

    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Método no permitido']);
