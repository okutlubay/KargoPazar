-- =============================================================================
-- KargoPazar - 000_CreateDatabase.sql
-- Creates the database and the application user. Run once as the RDS master user.
-- BEFORE RUNNING: replace CHANGE_ME_STRONG_PASSWORD with a strong password and use
-- the same value in the App Runner env var ConnectionStrings__Default.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS `kargopazar`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'kargopazar_app'@'%' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';

-- The API only reads/writes data (the schema comes from 001_InitialSchema.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON `kargopazar`.* TO 'kargopazar_app'@'%';

FLUSH PRIVILEGES;
