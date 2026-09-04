<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

const PA_MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];

function pa_ensure_table(PDO $db): void {
    $db->exec("CREATE TABLE IF NOT EXISTS `programa_anual_actividades` (
        `id`              VARCHAR(80)  NOT NULL,
        `actividad`       VARCHAR(500) NOT NULL,
        `frecuencia`      VARCHAR(120) NOT NULL DEFAULT '',
        `responsable`     VARCHAR(200) NOT NULL DEFAULT '',
        `presupuesto`     VARCHAR(120) NULL,
        `programa`        VARCHAR(120) NOT NULL,
        `programa_label`  VARCHAR(200) NOT NULL,
        `planeado`        JSON         NOT NULL,
        `realizado`       JSON         NOT NULL,
        `excel_planeado`  JSON         NOT NULL,
        `excel_realizado` JSON         NOT NULL,
        `excel_frecuencia`     VARCHAR(120) NOT NULL DEFAULT '',
        `excel_responsable`    VARCHAR(200) NOT NULL DEFAULT '',
        `excel_presupuesto`    VARCHAR(120) NULL,
        `meta`            JSON         NULL,
        `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        `updated_by`      VARCHAR(64)  NULL,
        PRIMARY KEY (`id`),
        KEY `idx_programa_anual_programa` (`programa_label`),
        KEY `idx_programa_anual_updated` (`updated_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function pa_decode_json(?string $raw, $default = []) {
    if ($raw === null || $raw === '') return $default;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : $default;
}

function pa_encode_json($data): string {
    return json_encode($data, JSON_UNESCAPED_UNICODE);
}

function pa_empty_months(): array {
    $m = [];
    foreach (PA_MONTHS as $month) {
        $m[$month] = false;
    }
    return $m;
}

function pa_normalize_months(array $src): array {
    $out = pa_empty_months();
    foreach (PA_MONTHS as $month) {
        if (array_key_exists($month, $src)) {
            $out[$month] = (bool)$src[$month];
        }
    }
    return $out;
}

function pa_recalc_totals(array $planeado, array $realizado): array {
    $totalPlaneado = 0;
    $totalRealizado = 0;
    foreach (PA_MONTHS as $month) {
        if (!empty($planeado[$month])) $totalPlaneado++;
        if (!empty($realizado[$month])) $totalRealizado++;
    }
    $cumplimiento = $totalPlaneado > 0 ? (int)round(($totalRealizado / $totalPlaneado) * 100) : null;
    return [
        'totalPlaneado' => $totalPlaneado,
        'totalRealizado' => $totalRealizado,
        'cumplimiento' => $cumplimiento,
    ];
}

function pa_calc_depreciation(array $meta, int $currentYear = 2026): array {
    $vidaAlcanzada = null;
    $depreciacionPct = null;
    $valorResidual = null;
    $aniosRestantes = null;

    if (!empty($meta['fechaCompra']) && !empty($meta['vidaUtilAnios'])) {
        $compraYear = (int)date('Y', strtotime((string)$meta['fechaCompra']));
        $vidaAlcanzada = $currentYear - $compraYear;
        $vidaUtil = (int)$meta['vidaUtilAnios'];
        $depreciacionPct = min(100, (int)round($vidaAlcanzada / max(1, $vidaUtil) * 100));
        $aniosRestantes = $vidaUtil - $vidaAlcanzada;
        if (!empty($meta['costoCompra'])) {
            $valorResidual = max(0, (float)$meta['costoCompra'] * (1 - $depreciacionPct / 100));
        }
    }

    return [
        'vidaAlcanzada' => $vidaAlcanzada,
        'depreciacionPct' => $depreciacionPct,
        'valorResidual' => $valorResidual,
        'aniosRestantes' => $aniosRestantes,
    ];
}

function pa_calc_alertas(array $act, array $depr): array {
    $alerts = [];
    $cm = (int)date('n') - 1;
    $currentMonth = PA_MONTHS[$cm];
    $prevMonth = $cm > 0 ? PA_MONTHS[$cm - 1] : null;
    $nextMonth = $cm < 11 ? PA_MONTHS[$cm + 1] : null;

    $p = $act['planeado'] ?? [];
    $r = $act['realizado'] ?? [];

    if (!empty($p[$currentMonth]) && empty($r[$currentMonth])) {
        $alerts[] = 'pendiente_mes_actual';
    }
    if ($prevMonth && !empty($p[$prevMonth]) && empty($r[$prevMonth])) {
        $alerts[] = 'no_ejecutado_mes_anterior';
    }
    if ($nextMonth && !empty($p[$nextMonth])) {
        $alerts[] = 'programado_proximo_mes';
    }

    $totalP = (int)($act['totalPlaneado'] ?? 0);
    $totalR = (int)($act['totalRealizado'] ?? 0);
    $cumpl = $act['cumplimiento'] ?? null;

    if ($totalP > 0 && $cumpl !== null && $cumpl < 50) {
        $alerts[] = 'bajo_cumplimiento';
    }
    if ($totalP > 0 && $totalR === 0) {
        $alerts[] = 'sin_ejecucion';
    }

    $dep = $depr['depreciacionPct'] ?? null;
    if ($dep !== null) {
        if ($dep >= 100) $alerts[] = 'equipo_vida_vencida';
        elseif ($dep >= 80) $alerts[] = 'equipo_vida_critica';
        elseif ($dep >= 60) $alerts[] = 'equipo_vida_proxima';
    }

    return $alerts;
}

function pa_row_to_actividad(array $row): array {
    $planeado = pa_normalize_months(pa_decode_json($row['planeado'] ?? null));
    $realizado = pa_normalize_months(pa_decode_json($row['realizado'] ?? null));
    $meta = pa_decode_json($row['meta'] ?? null, []);
    $totals = pa_recalc_totals($planeado, $realizado);
    $depr = pa_calc_depreciation($meta);

    $act = [
        'id' => $row['id'],
        'actividad' => $row['actividad'],
        'frecuencia' => $row['frecuencia'] ?? '',
        'responsable' => $row['responsable'] ?? '',
        'presupuesto' => $row['presupuesto'],
        'programa' => $row['programa'],
        'programaLabel' => $row['programa_label'],
        'planeado' => $planeado,
        'realizado' => $realizado,
        'totalPlaneado' => $totals['totalPlaneado'],
        'totalRealizado' => $totals['totalRealizado'],
        'cumplimiento' => $totals['cumplimiento'],
        'meta' => $meta ?: (object)[],
        'vidaAlcanzada' => $depr['vidaAlcanzada'],
        'depreciacionPct' => $depr['depreciacionPct'],
        'valorResidual' => $depr['valorResidual'],
        'aniosRestantes' => $depr['aniosRestantes'],
    ];
    $act['alertas'] = pa_calc_alertas($act, $depr);
    return $act;
}

function pa_fetch_all(PDO $db): array {
    pa_ensure_table($db);
    $rows = $db->query('SELECT * FROM `programa_anual_actividades` ORDER BY `programa_label`, `actividad`')->fetchAll();
    return array_map('pa_row_to_actividad', $rows);
}

function pa_get_row(PDO $db, string $id): ?array {
    pa_ensure_table($db);
    $stmt = $db->prepare('SELECT * FROM `programa_anual_actividades` WHERE `id` = ? LIMIT 1');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function pa_to_id(string $programa, string $actividad): string {
    $raw = strtolower($programa . '::' . $actividad);
    $raw = preg_replace('/\s+/', '_', $raw);
    return substr($raw, 0, 80);
}

function pa_create(PDO $db, array $body, ?string $userId): array {
    $actividad = trim((string)($body['actividad'] ?? ''));
    $programa = trim((string)($body['programa'] ?? ''));
    $programaLabel = trim((string)($body['programaLabel'] ?? ''));
    if ($actividad === '') {
        throw new InvalidArgumentException('actividad requerida');
    }
    if ($programa === '' && $programaLabel === '') {
        throw new InvalidArgumentException('programa requerido');
    }
    if ($programaLabel === '') {
        $programaLabel = $programa;
    }
    if ($programa === '') {
        $programa = strtoupper(preg_replace('/\s+/', ' ', $programaLabel));
    }

    $id = isset($body['id']) ? trim((string)$body['id']) : pa_to_id($programa, $actividad);
    if (pa_get_row($db, $id)) {
        throw new RuntimeException('Ya existe una actividad con el mismo programa y nombre');
    }

    $planeado = pa_normalize_months(is_array($body['planeado'] ?? null) ? $body['planeado'] : []);
    $realizado = pa_normalize_months(is_array($body['realizado'] ?? null) ? $body['realizado'] : []);
    $frecuencia = (string)($body['frecuencia'] ?? '');
    $responsable = (string)($body['responsable'] ?? '');
    $presupuesto = $body['presupuesto'] ?? null;
    $meta = is_array($body['meta'] ?? null) ? $body['meta'] : [];

    $stmt = $db->prepare(
        'INSERT INTO `programa_anual_actividades`
         (`id`,`actividad`,`frecuencia`,`responsable`,`presupuesto`,`programa`,`programa_label`,
          `planeado`,`realizado`,`excel_planeado`,`excel_realizado`,
          `excel_frecuencia`,`excel_responsable`,`excel_presupuesto`,`meta`,`updated_by`)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    );
    $stmt->execute([
        $id,
        $actividad,
        $frecuencia,
        $responsable,
        $presupuesto,
        $programa,
        $programaLabel,
        pa_encode_json($planeado),
        pa_encode_json($realizado),
        pa_encode_json($planeado),
        pa_encode_json($realizado),
        $frecuencia,
        $responsable,
        $presupuesto,
        pa_encode_json($meta ?: null),
        $userId,
    ]);

    $row = pa_get_row($db, $id);
    if (!$row) {
        throw new RuntimeException('No se pudo crear la actividad');
    }
    return pa_row_to_actividad($row);
}

function pa_update_meta(PDO $db, string $id, array $newMeta, ?string $userId): array {
    $row = pa_get_row($db, $id);
    if (!$row) {
        throw new RuntimeException('Actividad no encontrada');
    }
    $meta = array_merge(pa_decode_json($row['meta'] ?? null, []), $newMeta);
    $stmt = $db->prepare('UPDATE `programa_anual_actividades` SET `meta` = ?, `updated_by` = ? WHERE `id` = ?');
    $stmt->execute([pa_encode_json($meta), $userId, $id]);
    $updated = pa_get_row($db, $id);
    return pa_row_to_actividad($updated);
}

function pa_patch(PDO $db, string $id, array $patch, ?string $userId): array {
    $row = pa_get_row($db, $id);
    if (!$row) {
        throw new RuntimeException('Actividad no encontrada');
    }

    $planeado = pa_normalize_months(pa_decode_json($row['planeado'] ?? null));
    $realizado = pa_normalize_months(pa_decode_json($row['realizado'] ?? null));

    if (isset($patch['planeado']) && is_array($patch['planeado'])) {
        $planeado = pa_normalize_months(array_merge($planeado, $patch['planeado']));
    }
    if (isset($patch['realizado']) && is_array($patch['realizado'])) {
        $realizado = pa_normalize_months(array_merge($realizado, $patch['realizado']));
    }

    $frecuencia = isset($patch['frecuencia']) ? (string)$patch['frecuencia'] : (string)($row['frecuencia'] ?? '');
    $responsable = isset($patch['responsable']) ? (string)$patch['responsable'] : (string)($row['responsable'] ?? '');
    $presupuesto = array_key_exists('presupuesto', $patch) ? $patch['presupuesto'] : $row['presupuesto'];
    $actividad = isset($patch['actividad']) ? trim((string)$patch['actividad']) : (string)($row['actividad'] ?? '');
    $programa = isset($patch['programa']) ? trim((string)$patch['programa']) : (string)($row['programa'] ?? '');
    $programaLabel = isset($patch['programaLabel']) ? trim((string)$patch['programaLabel']) : (string)($row['programa_label'] ?? '');

    if ($actividad === '') {
        throw new InvalidArgumentException('actividad no puede estar vacía');
    }
    if ($programaLabel === '') {
        $programaLabel = $programa;
    }

    $stmt = $db->prepare(
        'UPDATE `programa_anual_actividades`
         SET `actividad` = ?, `programa` = ?, `programa_label` = ?,
             `planeado` = ?, `realizado` = ?, `frecuencia` = ?, `responsable` = ?, `presupuesto` = ?, `updated_by` = ?
         WHERE `id` = ?'
    );
    $stmt->execute([
        $actividad,
        $programa,
        $programaLabel,
        pa_encode_json($planeado),
        pa_encode_json($realizado),
        $frecuencia,
        $responsable,
        $presupuesto,
        $userId,
        $id,
    ]);

    $updated = pa_get_row($db, $id);
    return pa_row_to_actividad($updated);
}

function pa_delete_scope(PDO $db, string $id, string $scope, ?string $userId): void {
    $row = pa_get_row($db, $id);
    if (!$row) {
        throw new RuntimeException('Actividad no encontrada');
    }

    if ($scope === 'meta') {
        $stmt = $db->prepare('UPDATE `programa_anual_actividades` SET `meta` = NULL, `updated_by` = ? WHERE `id` = ?');
        $stmt->execute([$userId, $id]);
        return;
    }

    if ($scope === 'override') {
        $stmt = $db->prepare(
            'UPDATE `programa_anual_actividades`
             SET `planeado` = `excel_planeado`, `realizado` = `excel_realizado`,
                 `frecuencia` = `excel_frecuencia`, `responsable` = `excel_responsable`,
                 `presupuesto` = `excel_presupuesto`, `updated_by` = ?
             WHERE `id` = ?'
        );
        $stmt->execute([$userId, $id]);
        return;
    }

    if ($scope === 'actividad') {
        $stmt = $db->prepare('DELETE FROM `programa_anual_actividades` WHERE `id` = ?');
        $stmt->execute([$id]);
        return;
    }

    throw new InvalidArgumentException('scope inválido');
}

function pa_import_merged_row(PDO $db, array $act, array $meta, ?array $override): void {
    $excelPlaneado = pa_normalize_months($act['planeado'] ?? []);
    $excelRealizado = pa_normalize_months($act['realizado'] ?? []);
    $planeado = $excelPlaneado;
    $realizado = $excelRealizado;
    $frecuencia = (string)($act['frecuencia'] ?? '');
    $responsable = (string)($act['responsable'] ?? '');
    $presupuesto = $act['presupuesto'] ?? null;

    if ($override) {
        if (isset($override['planeado']) && is_array($override['planeado'])) {
            $planeado = pa_normalize_months(array_merge($planeado, $override['planeado']));
        }
        if (isset($override['realizado']) && is_array($override['realizado'])) {
            $realizado = pa_normalize_months(array_merge($realizado, $override['realizado']));
        }
        if (isset($override['frecuencia'])) $frecuencia = (string)$override['frecuencia'];
        if (isset($override['responsable'])) $responsable = (string)$override['responsable'];
        if (array_key_exists('presupuesto', $override)) $presupuesto = $override['presupuesto'];
    }

    $stmt = $db->prepare(
        'INSERT INTO `programa_anual_actividades`
         (`id`,`actividad`,`frecuencia`,`responsable`,`presupuesto`,`programa`,`programa_label`,
          `planeado`,`realizado`,`excel_planeado`,`excel_realizado`,
          `excel_frecuencia`,`excel_responsable`,`excel_presupuesto`,`meta`)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
          `actividad` = VALUES(`actividad`),
          `programa` = VALUES(`programa`),
          `programa_label` = VALUES(`programa_label`),
          `excel_planeado` = VALUES(`excel_planeado`),
          `excel_realizado` = VALUES(`excel_realizado`),
          `excel_frecuencia` = VALUES(`excel_frecuencia`),
          `excel_responsable` = VALUES(`excel_responsable`),
          `excel_presupuesto` = VALUES(`excel_presupuesto`)'
    );
    $stmt->execute([
        $act['id'],
        $act['actividad'],
        $frecuencia,
        $responsable,
        $presupuesto,
        $act['programa'],
        $act['programaLabel'],
        pa_encode_json($planeado),
        pa_encode_json($realizado),
        pa_encode_json($excelPlaneado),
        pa_encode_json($excelRealizado),
        (string)($act['frecuencia'] ?? ''),
        (string)($act['responsable'] ?? ''),
        $act['presupuesto'] ?? null,
        pa_encode_json($meta ?: null),
    ]);
}

function pa_import_from_json_dir(PDO $db, string $dataDir, bool $onlyIfEmpty = true): int {
    pa_ensure_table($db);
    $count = (int)$db->query('SELECT COUNT(*) FROM `programa_anual_actividades`')->fetchColumn();
    if ($onlyIfEmpty && $count > 0) {
        return 0;
    }

    $activitiesFile = rtrim($dataDir, '/') . '/programa-anual-activities.json';
    if (!file_exists($activitiesFile)) {
        throw new RuntimeException('No se encontró programa-anual-activities.json');
    }

    $activities = json_decode(file_get_contents($activitiesFile), true);
    if (!is_array($activities)) {
        throw new RuntimeException('programa-anual-activities.json inválido');
    }

    $metaAll = [];
    $metaFile = rtrim($dataDir, '/') . '/programa-anual-meta.json';
    if (file_exists($metaFile)) {
        $metaAll = json_decode(file_get_contents($metaFile), true);
        if (!is_array($metaAll)) $metaAll = [];
    }

    $overrides = [];
    $overridesFile = rtrim($dataDir, '/') . '/programa-anual-overrides.json';
    if (file_exists($overridesFile)) {
        $overrides = json_decode(file_get_contents($overridesFile), true);
        if (!is_array($overrides)) $overrides = [];
    }

    $imported = 0;
    foreach ($activities as $act) {
        if (empty($act['id'])) continue;
        $id = (string)$act['id'];
        pa_import_merged_row($db, $act, $metaAll[$id] ?? [], $overrides[$id] ?? null);
        $imported++;
    }
    return $imported;
}

function pa_require_staff(): array {
    require_once __DIR__ . '/session_config.php';
    $tok = $_COOKIE['dashboard_session'] ?? '';
    $payload = dashboard_verify_session_token($tok);
    if (!$payload || !in_array($payload['role'], ['admin', 'dev'], true)) {
        http_response_code(403);
        echo json_encode(['error' => 'Sin permisos. Solo administradores y desarrolladores pueden modificar.']);
        exit;
    }
    return $payload;
}
