-- Plan Anual: actividades + meta en MySQL (fuente de verdad en producción)
-- Ejecutar una vez en el hosting: mysql ... < migrate_programa_anual.sql

CREATE TABLE IF NOT EXISTS `programa_anual_actividades` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
