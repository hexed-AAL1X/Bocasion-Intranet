<?php
/**
 * it-equipos.php — Inventario de equipos IT (Excel OneDrive → JSON)
 *
 * GET  ?action=data   → Lee cache public/data/it-equipos.json
 * POST ?action=sync   → Descarga el Excel compartido, parsea y actualiza el JSON
 * GET  ?action=meta   → Solo lastUpdated / source
 */

header('Content-Type: application/json; charset=UTF-8');
mb_internal_encoding('UTF-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

define('IT_DATA_FILE', __DIR__ . '/../data/it-equipos.json');
define('IT_SHARE_URL', getenv('IT_ONEDRIVE_SHARE') ?: 'https://1drv.ms/x/c/83b330b7dec9e4be/IQCdkBXRi7QuS4G4FZmQZKgNATRZ9Qo974fUIXpbWF6fyrk?e=wcWCEJ');
define('IT_SOURCE_NAME', 'Inventario Equipos IT.xlsx');

$action = $_GET['action'] ?? $_POST['action'] ?? 'data';

try {
    if ($action === 'meta') {
        $data = it_read_cache();
        echo json_encode([
            'ok' => true,
            'lastUpdated' => $data['lastUpdated'] ?? null,
            'source' => $data['source'] ?? IT_SOURCE_NAME,
            'counts' => [
                'equipos' => isset($data['equipos']) && is_array($data['equipos']) ? count($data['equipos']) : 0,
                'visitasLocales' => isset($data['visitasLocales']) && is_array($data['visitasLocales']) ? count($data['visitasLocales']) : 0,
                'infraLocales' => isset($data['infraLocales']) && is_array($data['infraLocales']) ? count($data['infraLocales']) : 0,
            ],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'sync') {
        $data = it_sync();
        echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $data = it_read_cache();
    if ($data === null) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Sin datos de equipos. Ejecuta sync.'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    echo json_encode(['ok' => true, 'data' => $data], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}

function it_read_cache(): ?array
{
    if (!is_file(IT_DATA_FILE)) {
        return null;
    }
    $data = json_decode(file_get_contents(IT_DATA_FILE) ?: 'null', true);
    return is_array($data) ? $data : null;
}

function it_write_cache(array $data): void
{
    $dir = dirname(IT_DATA_FILE);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE);
    if ($json === false || file_put_contents(IT_DATA_FILE, $json) === false) {
        throw new RuntimeException('No se pudo escribir ' . IT_DATA_FILE);
    }
}

function it_sync(): array
{
    $tmpXlsx = tempnam(sys_get_temp_dir(), 'it_eq_') . '.xlsx';
    try {
        it_download_onedrive_xlsx(IT_SHARE_URL, $tmpXlsx);
        $parsed = it_parse_xlsx($tmpXlsx);
        $parsed['lastUpdated'] = gmdate('c');
        $parsed['source'] = IT_SOURCE_NAME;
        $parsed['shareUrl'] = IT_SHARE_URL;
        it_write_cache($parsed);
        return $parsed;
    } finally {
        if (is_file($tmpXlsx)) {
            @unlink($tmpXlsx);
        }
    }
}

function it_download_onedrive_xlsx(string $shareUrl, string $destPath): void
{
    if (!function_exists('curl_init')) {
        throw new RuntimeException('PHP curl no disponible');
    }

    $cookieFile = tempnam(sys_get_temp_dir(), 'it_cj_');
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

        $base = 'https://onedrive.live.com/personal/83b330b7dec9e4be';
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

function it_parse_xlsx(string $path): array
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

    if (!isset($byName['BD-EQUIPOS TECNOLOGICOS'])) {
        throw new RuntimeException('Falta la hoja "BD-EQUIPOS TECNOLOGICOS"');
    }

    $equipos = it_sheet_table($xlsx, $byName['BD-EQUIPOS TECNOLOGICOS'], 0);
    $visitas = isset($byName['VISITA LOCALES'])
        ? it_sheet_table($xlsx, $byName['VISITA LOCALES'], 0)
        : [];
    $infra = isset($byName['Hoja2'])
        ? it_infra_locales($xlsx, $byName['Hoja2'])
        : [];

    return [
        'equipos' => $equipos,
        'visitasLocales' => $visitas,
        'infraLocales' => $infra,
        'resumen' => it_build_resumen($equipos),
    ];
}

function it_norm_header(string $h): string
{
    $h = trim($h);
    $h = rtrim($h, ':');
    return trim($h);
}

/** Encabezado en $headerRow (0-based). */
function it_sheet_table(\Shuchkin\SimpleXLSX $xlsx, int $sheetIndex, int $headerRow = 0): array
{
    $rows = $xlsx->rows($sheetIndex);
    if (count($rows) <= $headerRow) {
        return [];
    }
    $headers = [];
    foreach ($rows[$headerRow] as $i => $h) {
        $label = it_norm_header((string) $h);
        if ($label === '') {
            $label = 'col_' . $i;
        }
        $headers[$i] = $label;
    }

    $out = [];
    for ($r = $headerRow + 1; $r < count($rows); $r++) {
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

function it_infra_locales(\Shuchkin\SimpleXLSX $xlsx, int $sheetIndex): array
{
    $rows = $xlsx->rows($sheetIndex);
    $headerRow = null;
    foreach ($rows as $i => $row) {
        foreach ($row as $cell) {
            if (strcasecmp(trim((string) $cell), 'LOCAL') === 0) {
                $headerRow = $i;
                break 2;
            }
        }
    }
    if ($headerRow === null) {
        return [];
    }

    $headers = [];
    foreach ($rows[$headerRow] as $i => $h) {
        $label = trim((string) $h);
        $headers[$i] = $label !== '' ? $label : 'col_' . $i;
    }

    $localIdx = null;
    $routerIdx = null;
    $telIdx = null;
    foreach ($headers as $i => $h) {
        $u = strtoupper($h);
        if ($u === 'LOCAL') {
            $localIdx = $i;
        } elseif ($u === 'ROUTER') {
            $routerIdx = $i;
        } elseif ($u === 'TELEFONO' || $u === 'TELÉFONO') {
            $telIdx = $i;
        }
    }
    if ($localIdx === null) {
        return [];
    }

    $out = [];
    for ($r = $headerRow + 1; $r < count($rows); $r++) {
        $row = $rows[$r];
        $local = isset($row[$localIdx]) ? trim((string) $row[$localIdx]) : '';
        if ($local === '') {
            continue;
        }
        $out[] = [
            'LOCAL' => $local,
            'ROUTER' => $routerIdx !== null ? ($row[$routerIdx] ?? null) : null,
            'TELEFONO' => $telIdx !== null ? ($row[$telIdx] ?? null) : null,
        ];
    }
    return $out;
}

function it_build_resumen(array $equipos): array
{
    $tipos = [];
    $locales = [];
    $marcas = [];
    $bajas = 0;
    $conCodigo = 0;

    foreach ($equipos as $e) {
        if (!empty($e['CÓDIGO AF'])) {
            $conCodigo++;
        }
        $tipo = strtoupper(trim((string) ($e['TIPO EQUIPO'] ?? 'Sin tipo')));
        if ($tipo === '') {
            $tipo = 'SIN TIPO';
        }
        $tipos[$tipo] = ($tipos[$tipo] ?? 0) + 1;

        $local = trim((string) ($e['LOCAL O ÁREA'] ?? 'Sin local'));
        if ($local === '') {
            $local = 'Sin local';
        }
        $locales[$local] = ($locales[$local] ?? 0) + 1;

        $marca = strtoupper(trim((string) ($e['MARCA'] ?? 'Sin marca')));
        if ($marca === '') {
            $marca = 'SIN MARCA';
        }
        $marcas[$marca] = ($marcas[$marca] ?? 0) + 1;

        $obs = strtoupper((string) ($e['OBSERVACIONES'] ?? ''));
        if (strpos($obs, 'BAJA') !== false) {
            $bajas++;
        }
    }

    arsort($tipos);
    arsort($locales);
    arsort($marcas);

    return [
        'totalEquipos' => count($equipos),
        'conCodigo' => $conCodigo,
        'bajas' => $bajas,
        'tipos' => $tipos,
        'locales' => $locales,
        'marcas' => array_slice($marcas, 0, 25, true),
    ];
}
