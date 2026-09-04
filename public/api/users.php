<?php
header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/session_config.php';

function dashboard_client_ip(): string {
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        return trim($parts[0]);
    }
    return isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : 'unknown';
}

function hash_password(string $password): string {
    return hash('sha256', $password);
}

/** Áreas oficiales del menú (mismas secciones del sidebar, sin Inicio). */
function allowed_department_areas(): array {
    return [
        'Administrativo',
        'Tecnología e Informática',
        'Calidad',
        'Contabilidad y Finanzas',
        'Recursos Humanos',
        'Logística',
        'Operaciones',
    ];
}

/** @param mixed $areasRaw */
function sanitize_department_areas($areasRaw): array {
    if (!is_array($areasRaw)) return [];
    $allowed = allowed_department_areas();
    $out = [];
    $seen = [];
    foreach ($areasRaw as $raw) {
        $area = trim((string) $raw);
        if ($area === '' || isset($seen[$area]) || !in_array($area, $allowed, true)) continue;
        $seen[$area] = true;
        $out[] = $area;
    }
    return $out;
}

function safe_user(array $user): array {
    unset($user['password_hash'], $user['passwordHash']);
    return $user;
}

function row_to_user(array $row): array {
    $rawAreas = $row['areas'] ?? '[]';
    $areas = is_string($rawAreas) ? (json_decode($rawAreas, true) ?: []) : [];
    return [
        'id'          => $row['id'],
        'username'    => $row['username'],
        'passwordHash'=> $row['password_hash'],
        'displayName' => $row['display_name'],
        'role'        => $row['role'],
        'areas'       => $areas,
        'createdAt'   => $row['created_at'],
        'updatedAt'   => $row['updated_at'],
    ];
}

function generate_id(): string {
    return 'user_' . time() . '_' . substr(bin2hex(random_bytes(3)), 0, 6);
}

try {
    $db     = get_db();
    $method = $_SERVER['REQUEST_METHOD'];

    // ── GET ───────────────────────────────────────────────────────────────────
    if ($method === 'GET') {
        $action = $_GET['action'] ?? '';

        if ($action === 'session') {
            $tok = $_COOKIE['dashboard_session'] ?? '';
            $payload = dashboard_verify_session_token($tok);
            if (!$payload) {
                // 200 evita ruido en consola del navegador (401 se muestra como error aunque sea esperado)
                echo json_encode(['authenticated' => false]);
                exit;
            }
            // Áreas frescas desde MySQL
            $areas = $payload['areas'] ?? [];
            try {
                $stmt = $db->prepare('SELECT `areas` FROM `users` WHERE `id` = ? LIMIT 1');
                $stmt->execute([$payload['id']]);
                $urow = $stmt->fetch();
                if ($urow) {
                    $raw = $urow['areas'] ?? '[]';
                    $decoded = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
                    $areas = sanitize_department_areas($decoded);
                }
            } catch (Throwable $e) {
                $areas = sanitize_department_areas($areas);
            }
            echo json_encode([
                'authenticated' => true,
                'id' => $payload['id'],
                'username' => $payload['username'],
                'displayName' => $payload['displayName'],
                'role' => $payload['role'],
                'areas' => $areas,
            ]);
            exit;
        }

        if ($action === 'login') {
            $ip = dashboard_client_ip();
            if (dashboard_login_rate_limited($ip)) {
                http_response_code(429);
                echo json_encode(['error' => 'Demasiados intentos. Espera unos minutos.']);
                exit;
            }
            $username = $_GET['username'] ?? '';
            $password = $_GET['password'] ?? '';
            $hash     = hash_password($password);

            $stmt = $db->prepare('SELECT * FROM `users` WHERE `username` = ? AND `password_hash` = ? LIMIT 1');
            $stmt->execute([$username, $hash]);
            $row = $stmt->fetch();

            if (!$row) {
                http_response_code(401);
                echo json_encode(['error' => 'Credenciales incorrectas']);
                exit;
            }
            $public = safe_user(row_to_user($row));
            $ttl = 86400 * 7;
            $tok = dashboard_sign_session_payload([
                'id' => $public['id'],
                'username' => $public['username'],
                'displayName' => $public['displayName'],
                'role' => $public['role'],
                'areas' => sanitize_department_areas($public['areas'] ?? []),
                'exp' => time() + $ttl,
            ]);
            if ($tok !== '') {
                dashboard_set_session_cookie($tok, $ttl);
            }
            echo json_encode($public);
            exit;
        }

        // Listar usuarios (sin passwordHash)
        $rows  = $db->query('SELECT * FROM `users` ORDER BY `created_at`')->fetchAll();
        $users = array_map(fn($r) => safe_user(row_to_user($r)), $rows);
        echo json_encode(array_values($users));
        exit;
    }

    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    // ── POST — login JSON / crear usuario ─────────────────────────────────────
    if ($method === 'POST') {
        if (($body['action'] ?? '') === 'logout') {
            dashboard_clear_session_cookie();
            echo json_encode(['ok' => true]);
            exit;
        }

        if (($body['action'] ?? '') === 'login') {
            $ip = dashboard_client_ip();
            if (dashboard_login_rate_limited($ip)) {
                http_response_code(429);
                echo json_encode(['error' => 'Demasiados intentos. Espera unos minutos.']);
                exit;
            }
            $username = trim($body['username'] ?? '');
            $password  = $body['password'] ?? '';
            if ($username === '' || $password === '') {
                http_response_code(400);
                echo json_encode(['error' => 'username y password requeridos']);
                exit;
            }
            $hash = hash_password($password);
            $stmt = $db->prepare('SELECT * FROM `users` WHERE `username` = ? AND `password_hash` = ? LIMIT 1');
            $stmt->execute([$username, $hash]);
            $row = $stmt->fetch();
            if (!$row) {
                http_response_code(401);
                echo json_encode(['error' => 'Credenciales incorrectas']);
                exit;
            }
            $public = safe_user(row_to_user($row));
            $ttl = 86400 * 7;
            $tok = dashboard_sign_session_payload([
                'id' => $public['id'],
                'username' => $public['username'],
                'displayName' => $public['displayName'],
                'role' => $public['role'],
                'areas' => sanitize_department_areas($public['areas'] ?? []),
                'exp' => time() + $ttl,
            ]);
            if ($tok !== '') {
                dashboard_set_session_cookie($tok, $ttl);
            }
            echo json_encode($public);
            exit;
        }

        // update se maneja más abajo (también vía PUT)
        if (($body['action'] ?? '') !== 'update') {
        $username    = trim($body['username']    ?? '');
        $password    = $body['password']         ?? '';
        $displayName = trim($body['displayName'] ?? $username);
        $role        = $body['role']             ?? 'user';

        if (!$username || !$password) {
            http_response_code(400);
            echo json_encode(['error' => 'username y password requeridos']);
            exit;
        }
        if (!in_array($role, ['user', 'admin', 'dev'])) $role = 'user';

        $check = $db->prepare('SELECT id FROM `users` WHERE `username` = ? LIMIT 1');
        $check->execute([$username]);
        if ($check->fetch()) {
            http_response_code(409);
            echo json_encode(['error' => 'El nombre de usuario ya existe']);
            exit;
        }

        $areasRaw = $body['areas'] ?? [];
        $areas    = sanitize_department_areas($areasRaw);

        $now = date('Y-m-d H:i:s');
        $id  = generate_id();
        try {
            $db->prepare('INSERT INTO `users` (`id`,`username`,`password_hash`,`display_name`,`role`,`areas`,`created_at`,`updated_at`) VALUES (?,?,?,?,?,?,?,?)')
               ->execute([$id, $username, hash_password($password), $displayName, $role, json_encode($areas, JSON_UNESCAPED_UNICODE), $now, $now]);
        } catch (Throwable $insertErr) {
            // Compatibilidad si la columna areas aún no existe en el hosting
            $db->prepare('INSERT INTO `users` (`id`,`username`,`password_hash`,`display_name`,`role`,`created_at`,`updated_at`) VALUES (?,?,?,?,?,?,?)')
               ->execute([$id, $username, hash_password($password), $displayName, $role, $now, $now]);
        }

        echo json_encode(safe_user([
            'id' => $id, 'username' => $username, 'displayName' => $displayName,
            'role' => $role, 'areas' => $areas, 'createdAt' => $now, 'updatedAt' => $now,
        ]));
        exit;
        }
    }

    // ── Actualizar usuario (PUT o POST action=update) ─────────────────────────
    $isUpdate = $method === 'PUT' || ($method === 'POST' && (($body['action'] ?? '') === 'update'));
    if ($isUpdate) {
        $id = $body['id'] ?? '';
        if (!$id) { http_response_code(400); echo json_encode(['error' => 'id requerido']); exit; }

        $stmt = $db->prepare('SELECT * FROM `users` WHERE `id` = ? LIMIT 1');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) { http_response_code(404); echo json_encode(['error' => 'Usuario no encontrado']); exit; }

        $displayName = isset($body['displayName']) ? trim($body['displayName']) : $row['display_name'];
        $role        = (isset($body['role']) && in_array($body['role'], ['user','admin','dev'])) ? $body['role'] : $row['role'];
        $hash        = !empty($body['password']) ? hash_password($body['password']) : $row['password_hash'];
        $username    = $row['username'];
        $rawAreasCol = $row['areas'] ?? null;
        $currentAreas = is_string($rawAreasCol) ? (json_decode($rawAreasCol, true) ?: []) : (is_array($rawAreasCol) ? $rawAreasCol : []);
        $areas        = array_key_exists('areas', $body) ? sanitize_department_areas($body['areas']) : sanitize_department_areas($currentAreas);

        if (!empty($body['username'])) {
            $newUsername = trim($body['username']);
            $conflict = $db->prepare('SELECT id FROM `users` WHERE `username` = ? AND `id` != ? LIMIT 1');
            $conflict->execute([$newUsername, $id]);
            if ($conflict->fetch()) {
                http_response_code(409); echo json_encode(['error' => 'Nombre de usuario en uso']); exit;
            }
            $username = $newUsername;
        }

        $now = date('Y-m-d H:i:s');
        $areasJson = json_encode($areas, JSON_UNESCAPED_UNICODE);
        try {
            $db->prepare('UPDATE `users` SET `username`=?,`password_hash`=?,`display_name`=?,`role`=?,`areas`=?,`updated_at`=? WHERE `id`=?')
               ->execute([$username, $hash, $displayName, $role, $areasJson, $now, $id]);
        } catch (Throwable $updateErr) {
            // Fallback sin columna areas
            $db->prepare('UPDATE `users` SET `username`=?,`password_hash`=?,`display_name`=?,`role`=?,`updated_at`=? WHERE `id`=?')
               ->execute([$username, $hash, $displayName, $role, $now, $id]);
        }

        echo json_encode(safe_user([
            'id' => $id, 'username' => $username, 'displayName' => $displayName,
            'role' => $role, 'areas' => $areas, 'createdAt' => $row['created_at'], 'updatedAt' => $now,
        ]));
        exit;
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if ($method === 'DELETE') {
        $id = $_GET['id'] ?? $body['id'] ?? '';
        if (!$id) { http_response_code(400); echo json_encode(['error' => 'id requerido']); exit; }

        // El usuario "dev" es protegido y nunca puede eliminarse
        $target = $db->prepare('SELECT `username` FROM `users` WHERE `id` = ? LIMIT 1');
        $target->execute([$id]);
        $targetRow = $target->fetch();
        if ($targetRow && $targetRow['username'] === 'dev') {
            http_response_code(403);
            echo json_encode(['error' => 'El usuario dev es obligatorio y no puede eliminarse']);
            exit;
        }

        $stmt = $db->prepare('DELETE FROM `users` WHERE `id` = ?');
        $stmt->execute([$id]);
        if ($stmt->rowCount() === 0) {
            http_response_code(404); echo json_encode(['error' => 'Usuario no encontrado']); exit;
        }
        echo json_encode(['success' => true]);
        exit;
    }

    http_response_code(405);
    echo json_encode(['error' => 'Método no permitido']);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
