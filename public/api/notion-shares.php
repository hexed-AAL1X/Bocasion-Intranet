<?php
header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'];
$db     = get_db();

// -------------------------------------------------------
// GET — obtener shares relacionados con un usuario
//   ?userId=X           → shares donde es owner o shared_with
//   ?tabId=T&userId=X   → shares de un tab específico
// -------------------------------------------------------
if ($method === 'GET') {
    $userId = $_GET['userId'] ?? '';
    $tabId  = $_GET['tabId']  ?? '';

    if (!$userId) {
        http_response_code(400);
        echo json_encode(['error' => 'userId requerido']);
        exit;
    }

    $received = isset($_GET['received']) && $_GET['received'] === '1';

    if ($tabId) {
        $stmt = $db->prepare(
            'SELECT ns.*, u.display_name AS shared_with_name
             FROM notion_shares ns
             JOIN users u ON u.id = ns.shared_with_id
             WHERE ns.tab_id = ? AND ns.owner_id = ?'
        );
        $stmt->execute([$tabId, $userId]);
    } elseif ($received) {
        // Solo shares recibidos (compartidos conmigo) con estado accepted
        $stmt = $db->prepare(
            'SELECT ns.*,
                    ow.display_name AS owner_name
             FROM notion_shares ns
             JOIN users ow ON ow.id = ns.owner_id
             WHERE ns.shared_with_id = ? AND ns.status = "accepted"
             ORDER BY ns.created_at DESC'
        );
        $stmt->execute([$userId]);
    } else {
        $stmt = $db->prepare(
            'SELECT ns.*,
                    ow.display_name AS owner_name,
                    sw.display_name AS shared_with_name
             FROM notion_shares ns
             JOIN users ow ON ow.id = ns.owner_id
             JOIN users sw ON sw.id = ns.shared_with_id
             WHERE ns.owner_id = ? OR ns.shared_with_id = ?
             ORDER BY ns.created_at DESC'
        );
        $stmt->execute([$userId, $userId]);
    }

    echo json_encode($stmt->fetchAll());
    exit;
}

// -------------------------------------------------------
// POST — crear un share e inyectar el tab en notion_tabs
//   body: { tabId, tabTitle, ownerId, sharedWithId, ownerDisplayName }
// -------------------------------------------------------
if ($method === 'POST') {
    $body            = json_decode(file_get_contents('php://input'), true) ?? [];
    $tabId           = $body['tabId']           ?? '';
    $tabTitle        = $body['tabTitle']         ?? 'Sin título';
    $ownerId         = $body['ownerId']          ?? '';
    $sharedWithId    = $body['sharedWithId']     ?? '';
    $ownerName       = $body['ownerDisplayName'] ?? '';

    if (!$tabId || !$ownerId || !$sharedWithId) {
        http_response_code(400);
        echo json_encode(['error' => 'tabId, ownerId y sharedWithId requeridos']);
        exit;
    }

    if ($ownerId === $sharedWithId) {
        http_response_code(400);
        echo json_encode(['error' => 'No puedes compartir contigo mismo']);
        exit;
    }

    // Verificar que no exista ya un share pendiente/aceptado para esta combinación
    $check = $db->prepare(
        'SELECT id FROM notion_shares WHERE tab_id=? AND owner_id=? AND shared_with_id=? AND status != "declined"'
    );
    $check->execute([$tabId, $ownerId, $sharedWithId]);
    if ($check->fetch()) {
        http_response_code(409);
        echo json_encode(['error' => 'Ya existe un share activo para este tab y usuario']);
        exit;
    }

    $shareId = uniqid('share_', true);
    $now     = date('Y-m-d H:i:s');

    $db->prepare(
        'INSERT INTO notion_shares (id, tab_id, tab_title, owner_id, shared_with_id, status, created_at)
         VALUES (?,?,?,?,?,?,?)'
    )->execute([$shareId, $tabId, $tabTitle, $ownerId, $sharedWithId, 'pending', $now]);

    // Obtener nombre del shared_with para el mensaje
    $userStmt = $db->prepare('SELECT display_name FROM users WHERE id = ?');
    $userStmt->execute([$sharedWithId]);
    $guestName = $userStmt->fetch()['display_name'] ?? 'usuario';

    // Auto-enviar mensaje de invitación
    $msgId      = uniqid('msg_', true);
    $msgContent = "Te he compartido el Notion \"$tabTitle\". Puedes aceptar la invitación para verlo en tu espacio.";
    $db->prepare(
        'INSERT INTO messages (id, from_id, to_id, content, msg_type, ref_id, created_at)
         VALUES (?,?,?,?,?,?,?)'
    )->execute([$msgId, $ownerId, $sharedWithId, $msgContent, 'notion_invite', $shareId, $now]);

    echo json_encode([
        'shareId' => $shareId,
        'msgId'   => $msgId,
        'status'  => 'pending',
    ]);
    exit;
}

// -------------------------------------------------------
// PATCH — aceptar o rechazar un share
//   body: { shareId, userId, action: 'accept'|'decline' }
//   Al aceptar: agrega el tab al notion_tabs del usuario
// -------------------------------------------------------
if ($method === 'PATCH') {
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $shareId = $body['shareId'] ?? '';
    $userId  = $body['userId']  ?? '';
    $action  = $body['action']  ?? '';

    if (!$shareId || !$userId || !in_array($action, ['accept', 'decline', 'reopen'])) {
        http_response_code(400);
        echo json_encode(['error' => 'shareId, userId y action (accept|decline|reopen) requeridos']);
        exit;
    }

    // Verificar que el share existe y pertenece al usuario
    $shareStmt = $db->prepare('SELECT * FROM notion_shares WHERE id = ? AND shared_with_id = ?');
    $shareStmt->execute([$shareId, $userId]);
    $share = $shareStmt->fetch();

    if (!$share) {
        http_response_code(404);
        echo json_encode(['error' => 'Share no encontrado']);
        exit;
    }

    $isReopen = ($action === 'reopen');
    $newStatus = null;
    if ($isReopen) {
        // Reopen no cambia el status en DB; solo vuelve a inyectar la pestaña en notion_tabs
        $action = 'accept';
    } else {
        $newStatus = $action === 'accept' ? 'accepted' : 'declined';
        $db->prepare('UPDATE notion_shares SET status = ? WHERE id = ?')
           ->execute([$newStatus, $shareId]);
    }

    if ($action === 'accept') {
        // Obtener nombre del dueño
        $ownerStmt = $db->prepare('SELECT display_name FROM users WHERE id = ?');
        $ownerStmt->execute([$share['owner_id']]);
        $ownerName = $ownerStmt->fetch()['display_name'] ?? 'Desconocido';

        // Obtener o crear notion_tabs del aceptante
        $tabsStmt = $db->prepare('SELECT * FROM notion_tabs WHERE user_id = ?');
        $tabsStmt->execute([$userId]);
        $userTabs = $tabsStmt->fetch();

        $now       = date('Y-m-d H:i:s');
        $sharedTabEntry = [
            'id'         => $share['tab_id'],
            'title'      => $share['tab_title'],
            'sharedFrom' => $ownerName,
            'isShared'   => true,
            'createdAt'  => $now,
            'updatedAt'  => $now,
        ];

        if ($userTabs) {
            $tabs = json_decode($userTabs['tabs'], true) ?? [];
            // Evitar duplicados
            $alreadyExists = false;
            foreach ($tabs as $t) {
                if ($t['id'] === $share['tab_id']) { $alreadyExists = true; break; }
            }
            if (!$alreadyExists) {
                $tabs[] = $sharedTabEntry;
            }
            $db->prepare('UPDATE notion_tabs SET tabs = ?, updated_at = ? WHERE user_id = ?')
               ->execute([json_encode($tabs, JSON_UNESCAPED_UNICODE), $now, $userId]);
        } else {
            $defaultTabId = 'notion_default_' . $userId;
            $tabs = [
                ['id' => $defaultTabId, 'title' => 'Nueva tabla', 'createdAt' => $now, 'updatedAt' => $now],
                $sharedTabEntry,
            ];
            $db->prepare(
                'INSERT INTO notion_tabs (user_id, active_tab_id, tabs, trash, updated_at)
                 VALUES (?,?,?,?,?)'
            )->execute([$userId, $defaultTabId, json_encode($tabs, JSON_UNESCAPED_UNICODE), '[]', $now]);
        }

        // Solo notificar al dueño la primera vez (pending → accepted), no en cada reopen
        if (!$isReopen && ($share['status'] ?? '') === 'pending') {
            $confirmId = uniqid('msg_', true);
            $db->prepare(
                'INSERT INTO messages (id, from_id, to_id, content, msg_type, created_at)
                 VALUES (?,?,?,?,?,?)'
            )->execute([
                $confirmId, $userId, $share['owner_id'],
                "He aceptado tu invitación al Notion \"{$share['tab_title']}\".",
                'text', $now
            ]);
        }
    }

    $responseStatus = $newStatus ?? 'accepted';
    echo json_encode(['ok' => true, 'status' => $responseStatus]);
    exit;
}

// -------------------------------------------------------
// DELETE — dejar de compartir una pestaña (revoca todos los shares del dueño)
//   body: { tabId, ownerId }
// -------------------------------------------------------
if ($method === 'DELETE') {
    $body    = json_decode(file_get_contents('php://input'), true) ?? [];
    $tabId   = $body['tabId']   ?? '';
    $ownerId = $body['ownerId'] ?? '';

    if (!$tabId || !$ownerId) {
        http_response_code(400);
        echo json_encode(['error' => 'tabId y ownerId requeridos']);
        exit;
    }

    $stmt = $db->prepare('SELECT * FROM notion_shares WHERE tab_id = ? AND owner_id = ?');
    $stmt->execute([$tabId, $ownerId]);
    $toRemove = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (empty($toRemove)) {
        http_response_code(404);
        echo json_encode(['error' => 'No hay shares activos para esta pestaña']);
        exit;
    }

    foreach ($toRemove as $share) {
        $recipientId = $share['shared_with_id'] ?? '';
        if (!$recipientId) {
            continue;
        }

        $tabsStmt = $db->prepare('SELECT * FROM notion_tabs WHERE user_id = ? LIMIT 1');
        $tabsStmt->execute([$recipientId]);
        $userTabs = $tabsStmt->fetch(PDO::FETCH_ASSOC);
        if (!$userTabs) {
            continue;
        }

        $tabs = json_decode($userTabs['tabs'], true) ?? [];
        if (!is_array($tabs)) {
            $tabs = [];
        }

        $filtered = array_values(array_filter($tabs, function ($t) use ($tabId) {
            return is_array($t) && (($t['id'] ?? '') !== $tabId);
        }));

        if (count($filtered) === count($tabs)) {
            continue;
        }

        $activeTabId = $userTabs['active_tab_id'] ?? '';
        if ($activeTabId === $tabId) {
            $activeTabId = $filtered[0]['id'] ?? '';
        }

        $now = date('c');
        $db->prepare('UPDATE notion_tabs SET active_tab_id = ?, tabs = ?, updated_at = ? WHERE user_id = ?')
           ->execute([$activeTabId, json_encode($filtered, JSON_UNESCAPED_UNICODE), $now, $recipientId]);
    }

    $db->prepare('DELETE FROM notion_shares WHERE tab_id = ? AND owner_id = ?')
       ->execute([$tabId, $ownerId]);

    echo json_encode(['ok' => true, 'removed' => count($toRemove)]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Método no permitido']);
