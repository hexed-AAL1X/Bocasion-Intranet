-- Evita truncamiento de JSON con muchos adjuntos en base64 (TEXT ≈ 64 KB).
ALTER TABLE `notion_tasks`
  MODIFY COLUMN `tasks` LONGTEXT NOT NULL;
