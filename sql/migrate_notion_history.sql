-- Historial de revisiones y acciones por tab (Notion)
CREATE TABLE IF NOT EXISTS `notion_tab_revisions` (
  `id`              VARCHAR(64)  NOT NULL,
  `tab_id`          VARCHAR(128) NOT NULL,
  `revision_num`    INT          NOT NULL,
  `user_id`         VARCHAR(64)  NOT NULL DEFAULT '',
  `user_name`       VARCHAR(128) NOT NULL DEFAULT '',
  `kind`            ENUM('auto','manual','pre_destructive') NOT NULL DEFAULT 'auto',
  `label`           VARCHAR(255) NOT NULL DEFAULT '',
  `pinned`          TINYINT(1)   NOT NULL DEFAULT 0,
  `row_count`       INT          NOT NULL DEFAULT 0,
  `content_hash`    CHAR(64)     NOT NULL DEFAULT '',
  `tasks_json`      LONGTEXT     NOT NULL,
  `columns_json`    LONGTEXT     NOT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tab_created` (`tab_id`, `created_at` DESC),
  KEY `idx_tab_num` (`tab_id`, `revision_num` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notion_tab_audit` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `tab_id`     VARCHAR(128) NOT NULL,
  `user_id`    VARCHAR(64)  NOT NULL DEFAULT '',
  `user_name`  VARCHAR(128) NOT NULL DEFAULT '',
  `action`     VARCHAR(64)  NOT NULL,
  `summary`    VARCHAR(255) NOT NULL DEFAULT '',
  `meta_json`  JSON         NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_tab_created` (`tab_id`, `created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
