<?php
/**
 * navasoft.php — Cola de sincronización de tickets Navasoft.
 *
 * Cualquier navegador puede solicitar una sincronización; un agente
 * (la PC con acceso a la intranet Navasoft) atiende la cola, ejecuta el
 * exportador y sube los resultados. El navegador hace polling del estado
 * y al terminar importa las filas con su propio flujo.
 *
 * Navegador:
 *   POST {action:"request"}                → crea/reutiliza un trabajo
 *   GET  ?action=status&id=N               → estado + log del trabajo
 *   GET  ?action=result&id=N               → filas JSON del trabajo terminado
 *
 * Agente (requiere clave):
 *   GET  ?action=poll&key=K                → reclama el trabajo pendiente más antiguo
 *   POST {action:"log", key, id, lines[]}  → agrega líneas de log
 *   POST {action:"complete", key, id, ok, rows?|error?} → cierra el trabajo
 */

header("Content-Type: application/json; charset=UTF-8");
mb_internal_encoding("UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

require_once __DIR__ . '/db.php';

// Clave compartida con el agente (misma filosofía que sync.php)
define('NAVASOFT_WORKER_KEY', 'NAV_AGENT_2026_8oca5ion');
// Los tickets se guardan en archivo (algunos hostings truncan LONGTEXT a 1MB al leer)
define('NAVASOFT_ROWS_DIR', __DIR__ . '/../data');
// Un trabajo "pending" sin reclamar más viejo que esto se marca expirado
define('PENDING_TTL_SECONDS', 120);
// Un trabajo "running" sin actividad más viejo que esto se marca error
define('RUNNING_TTL_SECONDS', 180);

function ensure_table(PDO $db): void {
    $db->exec('CREATE TABLE IF NOT EXISTS `navasoft_jobs` (
        `id` INT AUTO_INCREMENT PRIMARY KEY,
        `status` VARCHAR(16) NOT NULL DEFAULT "pending",
        `log` MEDIUMTEXT NULL,
        `rows_json` LONGTEXT NULL,
        `error` TEXT NULL,
        `created_at` DATETIME NOT NULL,
        `claimed_at` DATETIME NULL,
        `updated_at` DATETIME NOT NULL,
        `finished_at` DATETIME NULL,
        INDEX (`status`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
}

function expire_stale(PDO $db): void {
    $db->prepare('UPDATE `navasoft_jobs`
        SET `status` = "error", `error` = "Ninguna computadora sincronizadora respondió. Verifica que el equipo con acceso a Navasoft esté encendido.", `finished_at` = NOW()
        WHERE `status` = "pending" AND `created_at` < (NOW() - INTERVAL ' . PENDING_TTL_SECONDS . ' SECOND)')->execute();
    $db->prepare('UPDATE `navasoft_jobs`
        SET `status` = "error", `error` = "La sincronización se interrumpió (el agente dejó de responder).", `finished_at` = NOW()
        WHERE `status` = "running" AND `updated_at` < (NOW() - INTERVAL ' . RUNNING_TTL_SECONDS . ' SECOND)')->execute();
}

function job_public(array $row): array {
    return [
        'id'       => (int)$row['id'],
        'status'   => $row['status'],
        'log'      => $row['log'] !== null && $row['log'] !== '' ? explode("\n", $row['log']) : [],
        'error'    => $row['error'],
        'hasRows'  => is_file(rows_file((int)$row['id'])),
        'createdAt'=> $row['created_at'],
    ];
}

function rows_file(int $id): string {
    return NAVASOFT_ROWS_DIR . '/navasoft-job-' . $id . '.json';
}

function require_key(array $payload): void {
    $key = $payload['key'] ?? ($_GET['key'] ?? '');
    if ($key !== NAVASOFT_WORKER_KEY) {
        http_response_code(403);
        echo json_encode(['error' => 'Clave de agente inválida']);
        exit;
    }
}

try {
    $db = get_db();
    ensure_table($db);
    expire_stale($db);

    $method  = $_SERVER['REQUEST_METHOD'];
    $payload = [];
    if ($method === 'POST') {
        $payload = json_decode(file_get_contents('php://input'), true) ?: [];
    }
    $action = $payload['action'] ?? ($_GET['action'] ?? '');

    // ── Navegador: solicitar sincronización ────────────────────────────────
    if ($method === 'POST' && $action === 'request') {
        // Limpieza: archivos de resultados de hace más de un día
        foreach (glob(NAVASOFT_ROWS_DIR . '/navasoft-job-*.json') ?: [] as $old) {
            if (filemtime($old) < time() - 86400) @unlink($old);
        }
        $stmt = $db->query('SELECT * FROM `navasoft_jobs` WHERE `status` IN ("pending","running") ORDER BY `id` ASC LIMIT 1');
        $existing = $stmt->fetch();
        if ($existing) {
            echo json_encode(['job' => job_public($existing), 'reused' => true]);
            exit;
        }
        $db->prepare('INSERT INTO `navasoft_jobs` (`status`,`log`,`created_at`,`updated_at`) VALUES ("pending","",NOW(),NOW())')->execute();
        $id = (int)$db->lastInsertId();
        $stmt = $db->prepare('SELECT * FROM `navasoft_jobs` WHERE `id` = ?');
        $stmt->execute([$id]);
        echo json_encode(['job' => job_public($stmt->fetch()), 'reused' => false]);
        exit;
    }

    // ── Navegador: estado del trabajo ──────────────────────────────────────
    if ($method === 'GET' && $action === 'status') {
        $id = (int)($_GET['id'] ?? 0);
        $stmt = $db->prepare('SELECT `id`,`status`,`log`,`error`,`created_at` FROM `navasoft_jobs` WHERE `id` = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) { http_response_code(404); echo json_encode(['error' => 'Trabajo no encontrado']); exit; }
        echo json_encode(['job' => job_public($row)]);
        exit;
    }

    // ── Navegador: filas resultantes ───────────────────────────────────────
    if ($method === 'GET' && $action === 'result') {
        $id = (int)($_GET['id'] ?? 0);
        $stmt = $db->prepare('SELECT `status` FROM `navasoft_jobs` WHERE `id` = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) { http_response_code(404); echo json_encode(['error' => 'Trabajo no encontrado']); exit; }
        $file = rows_file($id);
        if ($row['status'] !== 'done' || !is_file($file)) {
            http_response_code(409);
            echo json_encode(['error' => 'El trabajo aún no tiene resultados']);
            exit;
        }
        header('Content-Type: application/json; charset=UTF-8');
        header('Content-Length: ' . filesize($file));
        readfile($file);
        exit;
    }

    // ── Agente: reclamar trabajo pendiente ─────────────────────────────────
    if ($method === 'GET' && $action === 'poll') {
        require_key($payload);
        $db->beginTransaction();
        $stmt = $db->query('SELECT `id` FROM `navasoft_jobs` WHERE `status` = "pending" ORDER BY `id` ASC LIMIT 1 FOR UPDATE');
        $row = $stmt->fetch();
        if (!$row) {
            $db->commit();
            echo json_encode(['job' => null]);
            exit;
        }
        $id = (int)$row['id'];
        $db->prepare('UPDATE `navasoft_jobs` SET `status` = "running", `claimed_at` = NOW(), `updated_at` = NOW() WHERE `id` = ?')->execute([$id]);
        $db->commit();
        echo json_encode(['job' => ['id' => $id]]);
        exit;
    }

    // ── Agente: agregar log ────────────────────────────────────────────────
    if ($method === 'POST' && $action === 'log') {
        require_key($payload);
        $id    = (int)($payload['id'] ?? 0);
        $lines = $payload['lines'] ?? [];
        if (!is_array($lines)) $lines = [(string)$lines];
        $chunk = implode("\n", array_map('strval', $lines));
        $stmt = $db->prepare('SELECT `log` FROM `navasoft_jobs` WHERE `id` = ? AND `status` = "running"');
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if (!$row) { http_response_code(404); echo json_encode(['error' => 'Trabajo no activo']); exit; }
        $log = $row['log'] !== null && $row['log'] !== '' ? $row['log'] . "\n" . $chunk : $chunk;
        // Evita crecer sin límite: conserva las últimas ~800 líneas
        $parts = explode("\n", $log);
        if (count($parts) > 800) {
            $parts = array_slice($parts, -800);
            $log = implode("\n", $parts);
        }
        $db->prepare('UPDATE `navasoft_jobs` SET `log` = ?, `updated_at` = NOW() WHERE `id` = ?')->execute([$log, $id]);
        echo json_encode(['ok' => true]);
        exit;
    }

    // ── Agente: subir resultados por partes (evita límites de POST/MySQL) ──
    if ($method === 'POST' && $action === 'rows') {
        require_key($payload);
        $id    = (int)($payload['id'] ?? 0);
        $seq   = (int)($payload['seq'] ?? 0);
        $chunk = (string)($payload['chunk'] ?? '');
        if (!is_dir(NAVASOFT_ROWS_DIR)) mkdir(NAVASOFT_ROWS_DIR, 0775, true);
        $file = rows_file($id);
        if ($seq === 0) @unlink($file);
        if (file_put_contents($file, $chunk, $seq === 0 ? 0 : FILE_APPEND) === false) {
            http_response_code(500);
            echo json_encode(['error' => 'No se pudo escribir el resultado en el servidor']);
            exit;
        }
        $db->prepare('UPDATE `navasoft_jobs` SET `updated_at` = NOW() WHERE `id` = ?')->execute([$id]);
        echo json_encode(['ok' => true, 'bytes' => filesize($file)]);
        exit;
    }

    // ── Agente: finalizar trabajo ──────────────────────────────────────────
    if ($method === 'POST' && $action === 'complete') {
        require_key($payload);
        $id = (int)($payload['id'] ?? 0);
        $ok = !empty($payload['ok']);
        if ($ok) {
            // Compatibilidad: filas pequeñas pueden venir en el mismo POST
            if (isset($payload['rows']) && is_array($payload['rows'])) {
                if (!is_dir(NAVASOFT_ROWS_DIR)) mkdir(NAVASOFT_ROWS_DIR, 0775, true);
                file_put_contents(rows_file($id), json_encode($payload['rows'], JSON_UNESCAPED_UNICODE));
            }
            $file = rows_file($id);
            $head = is_file($file) ? trim((string)file_get_contents($file, false, null, 0, 32)) : '';
            if ($head === '' || $head[0] !== '[') {
                $db->prepare('UPDATE `navasoft_jobs` SET `status` = "error", `error` = "El agente no entregó resultados completos.", `updated_at` = NOW(), `finished_at` = NOW() WHERE `id` = ?')
                   ->execute([$id]);
                http_response_code(422);
                echo json_encode(['error' => 'Resultados vacíos o inválidos']);
                exit;
            }
            $db->prepare('UPDATE `navasoft_jobs` SET `status` = "done", `updated_at` = NOW(), `finished_at` = NOW() WHERE `id` = ?')
               ->execute([$id]);
        } else {
            $error = (string)($payload['error'] ?? 'La sincronización falló');
            @unlink(rows_file($id));
            $db->prepare('UPDATE `navasoft_jobs` SET `status` = "error", `error` = ?, `updated_at` = NOW(), `finished_at` = NOW() WHERE `id` = ?')
               ->execute([$error, $id]);
        }
        echo json_encode(['ok' => true]);
        exit;
    }

    http_response_code(400);
    echo json_encode(['error' => 'Acción no reconocida']);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
