<?php
/**
 * rrhh.php — Dashboard Recursos Humanos (Excel OneDrive → JSON)
 *
 * GET  ?action=data   → Lee cache public/data/rrhh.json
 * POST ?action=sync   → Descarga el Excel compartido, parsea y actualiza el JSON
 * GET  ?action=meta   → Solo lastUpdated / source (ligero)
 */

header('Content-Type: application/json; charset=UTF-8');
mb_internal_encoding('UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

define('RRHH_DATA_FILE', __DIR__ . '/../data/rrhh.json');
define('RRHH_SHARE_URL', getenv('RRHH_ONEDRIVE_SHARE') ?: 'https://1drv.ms/x/c/2244DF84B1EE0E79/IQC_rV8gf0tQSaricLI9c70DAasEXcJQYRfqzYo_sz9x-YU?e=hONCc7');
define('RRHH_SOURCE_NAME', 'BUK_RRHH 1.xlsx');

$action = $_GET['action'] ?? $_POST['action'] ?? 'data';

try {
    if ($action === 'meta') {
        $data = rrhh_read_cache();
        echo json_encode([
            'ok' => true,
            'lastUpdated' => $data['lastUpdated'] ?? null,
            'source' => $data['source'] ?? RRHH_SOURCE_NAME,
            'counts' => rrhh_counts($data),
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'sync') {
        $data = rrhh_sync();
        echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // default: data
    $data = rrhh_read_cache();
    if ($data === null) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Sin datos RRHH. Ejecuta sync.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}

// ── Cache ────────────────────────────────────────────────────────────────────

function rrhh_read_cache(): ?array
{
    if (!is_file(RRHH_DATA_FILE)) {
        return null;
    }
    $raw = file_get_contents(RRHH_DATA_FILE);
    $data = json_decode($raw ?: 'null', true);
    return is_array($data) ? $data : null;
}

function rrhh_write_cache(array $data): void
{
    $dir = dirname(RRHH_DATA_FILE);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    if ($json === false) {
        throw new RuntimeException('No se pudo serializar JSON RRHH');
    }
    if (file_put_contents(RRHH_DATA_FILE, $json) === false) {
        throw new RuntimeException('No se pudo escribir ' . RRHH_DATA_FILE);
    }
}

function rrhh_counts(?array $data): array
{
    if (!$data) {
        return [];
    }
    $keys = ['colaboradores', 'directorio', 'cargos', 'puestos', 'areas', 'licencias', 'comprobantes', 'itemsRemuneracion', 'procesosNomina'];
    $out = [];
    foreach ($keys as $k) {
        $out[$k] = isset($data[$k]) && is_array($data[$k]) ? count($data[$k]) : 0;
    }
    return $out;
}

// ── Sync ─────────────────────────────────────────────────────────────────────

function rrhh_sync(): array
{
    $tmpXlsx = tempnam(sys_get_temp_dir(), 'rrhh_') . '.xlsx';
    try {
        rrhh_download_onedrive_xlsx(RRHH_SHARE_URL, $tmpXlsx);
        $parsed = rrhh_parse_xlsx($tmpXlsx);
        $parsed['lastUpdated'] = gmdate('c');
        $parsed['source'] = RRHH_SOURCE_NAME;
        $parsed['shareUrl'] = RRHH_SHARE_URL;
        rrhh_write_cache($parsed);
        return $parsed;
    } finally {
        if (is_file($tmpXlsx)) {
            @unlink($tmpXlsx);
        }
    }
}

/**
 * Abre el enlace 1drv.ms (obtiene cookies FedAuth) y descarga via download.aspx?UniqueId=
 */
function rrhh_download_onedrive_xlsx(string $shareUrl, string $destPath): void
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHP curl no disponible');
    }

    $cookieFile = tempnam(sys_get_temp_dir(), 'rrhh_cj_');
    $ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    try {
        $ch = curl_init($shareUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 10,
            CURLOPT_TIMEOUT => 90,
            CURLOPT_USERAGENT => $ua,
            CURLOPT_COOKIEJAR => $cookieFile,
            CURLOPT_COOKIEFILE => $cookieFile,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $html = curl_exec($ch);
        $finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($html === false || $code >= 400) {
            throw new RuntimeException("No se pudo abrir el enlace compartido (HTTP $code). $err");
        }

        $uniqueId = null;
        if (preg_match('/download\.aspx\?UniqueId=([a-f0-9\-]{36})/i', $html, $m)) {
            $uniqueId = $m[1];
        } elseif (preg_match('/sourcedoc=%7B([a-f0-9\-]{36})%7D/i', $finalUrl, $m)) {
            $uniqueId = $m[1];
        } elseif (preg_match('/sourcedoc=\{([a-f0-9\-]{36})\}/i', $finalUrl, $m)) {
            $uniqueId = $m[1];
        }

        if (!$uniqueId) {
            throw new RuntimeException('No se encontró UniqueId del Excel. ¿El enlace sigue siendo público?');
        }

        $base = 'https://onedrive.live.com/personal/2244DF84B1EE0E79';
        if (preg_match('#(https://onedrive\.live\.com/personal/[A-Fa-f0-9]+)#', $finalUrl, $bm)) {
            $base = $bm[1];
        } elseif (preg_match('#(https://[^/]+/personal/[A-Fa-f0-9]+)#', $html, $bm)) {
            $base = $bm[1];
        }

        $downloadUrl = $base . '/_layouts/15/download.aspx?UniqueId=' . rawurlencode($uniqueId);

        $ch = curl_init($downloadUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 10,
            CURLOPT_TIMEOUT => 120,
            CURLOPT_USERAGENT => $ua,
            CURLOPT_COOKIEJAR => $cookieFile,
            CURLOPT_COOKIEFILE => $cookieFile,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $bin = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $ctype = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($bin === false || $code >= 400) {
            throw new RuntimeException("Descarga falló (HTTP $code). $err");
        }
        if (substr($bin, 0, 2) !== 'PK') {
            throw new RuntimeException('La descarga no es un XLSX válido (¿permisos del enlace?). Content-Type: ' . $ctype);
        }
        if (file_put_contents($destPath, $bin) === false) {
            throw new RuntimeException('No se pudo guardar el Excel temporal');
        }
    } finally {
        if (is_file($cookieFile)) {
            @unlink($cookieFile);
        }
    }
}

function rrhh_parse_xlsx(string $path): array
{
    if (!class_exists('Shuchkin\\SimpleXLSX', false)) {
        require_once __DIR__ . '/SimpleXLSX.php';
    }
    if (!function_exists('simplexml_load_string')) {
        throw new RuntimeException('Extensión PHP simplexml requerida para parsear el Excel');
    }

    $xlsx = \Shuchkin\SimpleXLSX::parse($path);
    if (!$xlsx) {
        throw new RuntimeException('Error al leer Excel: ' . \Shuchkin\SimpleXLSX::parseError());
    }

    $byName = [];
    foreach ($xlsx->sheetNames() as $idx => $name) {
        $byName[$name] = $idx;
    }

    $need = [
        'Resumen RRHH',
        'Parámetros Legales',
        'Colaboradores',
        'Directorio',
        'Cargos',
        'Puestos de Trabajo',
        'Áreas',
        'Licencias',
        'Comprobantes de Pago',
        'Ítems Remuneración',
        'Procesos Nómina',
    ];
    foreach ($need as $n) {
        if (!isset($byName[$n])) {
            throw new RuntimeException("Falta la hoja \"$n\" en el Excel");
        }
    }

    return [
        'resumen' => rrhh_sheet_kv($xlsx, $byName['Resumen RRHH']),
        'parametrosLegales' => rrhh_sheet_table($xlsx, $byName['Parámetros Legales']),
        'colaboradores' => rrhh_sheet_table($xlsx, $byName['Colaboradores']),
        'directorio' => rrhh_sheet_table($xlsx, $byName['Directorio']),
        'cargos' => rrhh_sheet_table($xlsx, $byName['Cargos']),
        'puestos' => rrhh_sheet_table($xlsx, $byName['Puestos de Trabajo']),
        'areas' => rrhh_sheet_table($xlsx, $byName['Áreas']),
        'licencias' => rrhh_sheet_table($xlsx, $byName['Licencias']),
        'comprobantes' => rrhh_sheet_table($xlsx, $byName['Comprobantes de Pago']),
        'itemsRemuneracion' => rrhh_sheet_table($xlsx, $byName['Ítems Remuneración']),
        'procesosNomina' => rrhh_sheet_table($xlsx, $byName['Procesos Nómina']),
    ];
}

/** Filas con encabezado en la fila índice 2 (0-based), como el export BUK. */
function rrhh_sheet_table(\Shuchkin\SimpleXLSX $xlsx, int $sheetIndex): array
{
    $rows = $xlsx->rows($sheetIndex);
    if (count($rows) < 3) {
        return [];
    }
    $headers = [];
    foreach ($rows[2] as $i => $h) {
        $label = trim((string) $h);
        if ($label === '') {
            $label = 'col_' . $i;
        }
        $headers[$i] = $label;
    }

    $out = [];
    for ($r = 3; $r < count($rows); $r++) {
        $row = $rows[$r];
        $allEmpty = true;
        $rec = [];
        foreach ($headers as $i => $key) {
            $val = $row[$i] ?? null;
            if ($val === null || $val === '') {
                $rec[$key] = null;
                continue;
            }
            $allEmpty = false;
            if (is_string($val)) {
                $val = trim($val);
            }
            $rec[$key] = $val;
        }
        if (!$allEmpty) {
            $out[] = $rec;
        }
    }
    return $out;
}

/** Resumen: pares Indicador / Valor a partir de la fila de encabezado. */
function rrhh_sheet_kv(\Shuchkin\SimpleXLSX $xlsx, int $sheetIndex): array
{
    $rows = $xlsx->rows($sheetIndex);
    $out = [];
    $started = false;
    foreach ($rows as $row) {
        $k = isset($row[0]) ? trim((string) $row[0]) : '';
        $v = $row[1] ?? null;
        if (!$started) {
            if (strcasecmp($k, 'Indicador') === 0) {
                $started = true;
            }
            continue;
        }
        if ($k === '') {
            continue;
        }
        if ($v === null || $v === '') {
            $out[$k] = null;
        } else {
            $out[$k] = is_string($v) ? trim($v) : $v;
        }
    }
    return $out;
}
