<?php
declare(strict_types=1);

function dashboard_session_secret(): string {
    $v = getenv('DASHBOARD_SESSION_SECRET');
    if ($v !== false && $v !== '') {
        return $v;
    }
    return 'dev-dashboard-session-change-me';
}

function dashboard_b64url_encode(string $raw): string {
    return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
}

function dashboard_b64url_decode(string $data): string {
    $padding = strlen($data) % 4;
    if ($padding > 0) {
        $data .= str_repeat('=', 4 - $padding);
    }
    $decoded = base64_decode(strtr($data, '-_', '+/'), true);
    return $decoded === false ? '' : $decoded;
}

/** Misma forma que Node: base64url(JSON).hexHMAC */
function dashboard_sign_session_payload(array $payload): string {
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        return '';
    }
    $data = dashboard_b64url_encode($json);
    $sig = hash_hmac('sha256', $data, dashboard_session_secret(), false);
    return $data . '.' . $sig;
}

/** @return array{id:string,username:string,displayName:string,role:string,areas:array,exp:int}|null */
function dashboard_verify_session_token(string $token): ?array {
    $dot = strpos($token, '.');
    if ($dot === false) {
        return null;
    }
    $data = substr($token, 0, $dot);
    $sig = substr($token, $dot + 1);
    if ($data === '' || $sig === '' || !preg_match('/^[0-9a-f]+$/i', $sig)) {
        return null;
    }
    $expected = hash_hmac('sha256', $data, dashboard_session_secret(), false);
    if (!hash_equals(strtolower($expected), strtolower($sig))) {
        return null;
    }
    $json = dashboard_b64url_decode($data);
    if ($json === '') {
        return null;
    }
    $payload = json_decode($json, true);
    if (!is_array($payload)) {
        return null;
    }
    $id = isset($payload['id']) ? (string) $payload['id'] : '';
    $username = isset($payload['username']) ? (string) $payload['username'] : '';
    $displayName = isset($payload['displayName']) ? (string) $payload['displayName'] : '';
    $role = isset($payload['role']) ? (string) $payload['role'] : '';
    $exp = isset($payload['exp']) ? (int) $payload['exp'] : 0;
    $areas = [];
    if (isset($payload['areas']) && is_array($payload['areas'])) {
        foreach ($payload['areas'] as $a) {
            $t = trim((string) $a);
            if ($t !== '') $areas[] = $t;
        }
    }
    if ($id === '' || $username === '' || $role === '' || $exp < time()) {
        return null;
    }
    return [
        'id' => $id,
        'username' => $username,
        'displayName' => $displayName !== '' ? $displayName : $username,
        'role' => $role,
        'areas' => array_values($areas),
        'exp' => $exp,
    ];
}

function dashboard_login_rate_limited(string $ip): bool {
    $max = 25;
    $window = 600;
    $path = sys_get_temp_dir() . '/dashboard_login_attempts.json';
    $lockPath = $path . '.lock';
    $now = time();
    $fh = fopen($lockPath, 'c');
    if ($fh === false) {
        return false;
    }
    if (!flock($fh, LOCK_EX)) {
        fclose($fh);
        return false;
    }
    $data = [];
    if (is_readable($path)) {
        $raw = file_get_contents($path);
        if ($raw !== false && $raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $data = $decoded;
            }
        }
    }
    if (!isset($data[$ip]) || !is_array($data[$ip])) {
        $data[$ip] = [];
    }
    $data[$ip] = array_values(array_filter($data[$ip], function ($t) use ($now, $window) {
        return ($now - (int) $t) < $window;
    }));
    if (count($data[$ip]) >= $max) {
        flock($fh, LOCK_UN);
        fclose($fh);
        return true;
    }
    $data[$ip][] = $now;
    file_put_contents($path, json_encode($data));
    flock($fh, LOCK_UN);
    fclose($fh);
    return false;
}

function dashboard_cookie_path(): string {
    $p = getenv('DASHBOARD_COOKIE_PATH');
    if ($p !== false && $p !== '') {
        return $p;
    }
    $sn = isset($_SERVER['SCRIPT_NAME']) ? (string) $_SERVER['SCRIPT_NAME'] : '';
    if ($sn !== '' && strpos($sn, '/out/') === 0) {
        return '/out';
    }
    return '/';
}

function dashboard_set_session_cookie(string $token, int $ttlSec): void {
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $cookiePath = dashboard_cookie_path();
    $expires = time() + $ttlSec;
    // PHP < 7.3: setcookie() no admite el array de opciones (provoca 500 en hosting antiguo).
    if (PHP_VERSION_ID >= 70300) {
        setcookie('dashboard_session', $token, [
            'expires' => $expires,
            'path' => $cookiePath,
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        return;
    }
    setcookie('dashboard_session', $token, $expires, $cookiePath, '', $secure, true);
}

function dashboard_clear_session_cookie(): void {
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    $cookiePath = dashboard_cookie_path();
    $expires = time() - 3600;
    if (PHP_VERSION_ID >= 70300) {
        setcookie('dashboard_session', '', [
            'expires' => $expires,
            'path' => $cookiePath,
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        return;
    }
    setcookie('dashboard_session', '', $expires, $cookiePath, '', $secure, true);
}
