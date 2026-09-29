-- =============================================================================
-- KargoPazar - 001_InitialSchema.sql  (MySQL 8.0, InnoDB, utf8mb4_0900_ai_ci)
--
-- Hybrid schema for the demo panel (/app/):
--   * users, companies, wallets, wallet_transactions: relational core. The panel's
--     `user` document = users.profile + companies.data; `wallet` = wallets.data +
--     wallet_transactions (ordered by sort_order). Passwords are BCrypt hashes.
--   * one table per collection (orders, shipments, ...): typed, indexed columns for the
--     fields that are queried, plus the full record in `data`.
--   * app_documents: documents without a dedicated table (rate_cards, roles, system, ...).
--   * app_records: collections created by the panel at run time (requestLog, drafts, ...).
--   * leads: landing contact form.
--
-- `data` columns are LONGTEXT with a JSON_VALID check instead of the JSON type on
-- purpose: MySQL's JSON type re-sorts object keys, and the API must return every record
-- byte-for-byte in the key order the panel wrote it. Typed columns are derived copies
-- (the API rewrites them on every write); record keys use utf8mb4_bin (case-sensitive,
-- like JavaScript ids).
--
-- The column list of each collection table mirrors backend/Data/collections.json.
-- Idempotent: CREATE TABLE IF NOT EXISTS. Run after 000_CreateDatabase.sql.
-- =============================================================================

USE `kargopazar`;

-- ── Relational core ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `companies` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `name` VARCHAR(160) NULL,
  `legal_name` VARCHAR(160) NULL,
  `tax_id` VARCHAR(32) NULL,
  `phone` VARCHAR(40) NULL,
  `plan` VARCHAR(32) NULL,
  `default_hub` VARCHAR(16) NULL,
  `data` LONGTEXT NOT NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_companies_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `password_hash` VARCHAR(100) NOT NULL,
  `name` VARCHAR(160) NULL,
  `role` VARCHAR(32) NULL,
  `company_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  `created_at` DATETIME(3) NULL,
  `profile` LONGTEXT NOT NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_users_username` (`username`),
  UNIQUE KEY `ux_users_email` (`email`),
  KEY `ix_users_company_id` (`company_id`),
  CONSTRAINT `chk_users_profile` CHECK (JSON_VALID(`profile`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `wallets` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `company_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  `balance` DECIMAL(12,2) NULL,
  `currency` VARCHAR(8) NULL,
  `data` LONGTEXT NOT NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_wallets_company_id` (`company_id`),
  CONSTRAINT `chk_wallets_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `wallet_transactions` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `wallet_id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `type` VARCHAR(32) NULL,
  `status` VARCHAR(32) NULL,
  `amount` DECIMAL(12,2) NULL,
  `balance_after` DECIMAL(12,2) NULL,
  `shipment_id` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `data` LONGTEXT NOT NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_wallet_transactions_wallet_sort` (`wallet_id`, `sort_order`),
  KEY `ix_wallet_transactions_shipment_id` (`shipment_id`),
  KEY `ix_wallet_transactions_created_at` (`created_at`),
  CONSTRAINT `chk_wallet_transactions_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── Generic storage ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `app_documents` (
  `name` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `data` LONGTEXT NOT NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`name`),
  CONSTRAINT `chk_app_documents_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `app_records` (
  `collection` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `data` LONGTEXT NOT NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`collection`, `id`),
  KEY `ix_app_records_collection_sort` (`collection`, `sort_order`),
  CONSTRAINT `chk_app_records_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `app_meta` (
  `name` VARCHAR(64) NOT NULL,
  `value` VARCHAR(255) NULL,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `leads` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(160) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `company` VARCHAR(160) NULL,
  `phone` VARCHAR(40) NULL,
  `message` TEXT NULL,
  `ip` VARCHAR(64) NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` DATETIME(3) NOT NULL,
  `data` LONGTEXT NULL COMMENT 'whole submitted payload (topic, lang, consent, source, ...)',
  PRIMARY KEY (`id`),
  KEY `ix_leads_created_at` (`created_at`),
  CONSTRAINT `chk_leads_data` CHECK (`data` IS NULL OR JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── Collection tables (one per panel collection) ────────────────────────────

-- orders: key id, created_at <- createdAt
CREATE TABLE IF NOT EXISTS `orders` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `channel` VARCHAR(32) NULL,
  `channel_order_no` VARCHAR(64) NULL,
  `status` VARCHAR(32) NULL,
  `customer_name` VARCHAR(160) NULL,
  `customer_email` VARCHAR(190) NULL,
  `ship_to_state` VARCHAR(16) NULL,
  `address_score` DOUBLE NULL,
  `shipment_id` VARCHAR(64) NULL,
  `total` DECIMAL(12,2) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_orders_sort` (`sort_order`),
  KEY `ix_orders_channel` (`channel`),
  KEY `ix_orders_channel_order_no` (`channel_order_no`),
  KEY `ix_orders_status` (`status`),
  KEY `ix_orders_customer_email` (`customer_email`),
  KEY `ix_orders_ship_to_state` (`ship_to_state`),
  KEY `ix_orders_address_score` (`address_score`),
  KEY `ix_orders_shipment_id` (`shipment_id`),
  KEY `ix_orders_created_at` (`created_at`),
  CONSTRAINT `chk_orders_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- shipments: key id, created_at <- createdAt
CREATE TABLE IF NOT EXISTS `shipments` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `order_id` VARCHAR(64) NULL,
  `status` VARCHAR(32) NULL,
  `carrier` VARCHAR(16) NULL,
  `service` VARCHAR(32) NULL,
  `hub` VARCHAR(16) NULL,
  `tracking_no` VARCHAR(64) NULL,
  `reference` VARCHAR(64) NULL,
  `price` DECIMAL(12,2) NULL,
  `manifest_id` VARCHAR(64) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_shipments_sort` (`sort_order`),
  KEY `ix_shipments_order_id` (`order_id`),
  KEY `ix_shipments_status` (`status`),
  KEY `ix_shipments_carrier` (`carrier`),
  KEY `ix_shipments_hub` (`hub`),
  KEY `ix_shipments_tracking_no` (`tracking_no`),
  KEY `ix_shipments_manifest_id` (`manifest_id`),
  KEY `ix_shipments_created_at` (`created_at`),
  CONSTRAINT `chk_shipments_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- adjustments: key id, created_at <- measuredAt
CREATE TABLE IF NOT EXISTS `adjustments` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `shipment_id` VARCHAR(64) NULL,
  `status` VARCHAR(32) NULL,
  `delta` DECIMAL(12,2) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_adjustments_sort` (`sort_order`),
  KEY `ix_adjustments_shipment_id` (`shipment_id`),
  KEY `ix_adjustments_status` (`status`),
  KEY `ix_adjustments_created_at` (`created_at`),
  CONSTRAINT `chk_adjustments_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- invoices: key id, created_at <- issuedAt
CREATE TABLE IF NOT EXISTS `invoices` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NULL,
  `currency` VARCHAR(8) NULL,
  `total` DECIMAL(12,2) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_invoices_sort` (`sort_order`),
  KEY `ix_invoices_status` (`status`),
  KEY `ix_invoices_created_at` (`created_at`),
  CONSTRAINT `chk_invoices_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- manifests: key id, created_at <- createdAt
CREATE TABLE IF NOT EXISTS `manifests` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `type` VARCHAR(32) NULL,
  `hub` VARCHAR(16) NULL,
  `carrier` VARCHAR(16) NULL,
  `status` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_manifests_sort` (`sort_order`),
  KEY `ix_manifests_type` (`type`),
  KEY `ix_manifests_hub` (`hub`),
  KEY `ix_manifests_carrier` (`carrier`),
  KEY `ix_manifests_status` (`status`),
  KEY `ix_manifests_created_at` (`created_at`),
  CONSTRAINT `chk_manifests_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- intl_shipments: key id, created_at <- createdAt
CREATE TABLE IF NOT EXISTS `intl_shipments` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `origin` VARCHAR(8) NULL,
  `stage` VARCHAR(32) NULL,
  `dest_hub` VARCHAR(16) NULL,
  `manifest_id` VARCHAR(64) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_intl_shipments_sort` (`sort_order`),
  KEY `ix_intl_shipments_origin` (`origin`),
  KEY `ix_intl_shipments_stage` (`stage`),
  KEY `ix_intl_shipments_manifest_id` (`manifest_id`),
  KEY `ix_intl_shipments_created_at` (`created_at`),
  CONSTRAINT `chk_intl_shipments_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- stores: key id, created_at <- connectedAt
CREATE TABLE IF NOT EXISTS `stores` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `channel` VARCHAR(32) NULL,
  `status` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_stores_sort` (`sort_order`),
  KEY `ix_stores_channel` (`channel`),
  KEY `ix_stores_status` (`status`),
  KEY `ix_stores_created_at` (`created_at`),
  CONSTRAINT `chk_stores_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- carrier_accounts: key id, created_at <- connectedAt
CREATE TABLE IF NOT EXISTS `carrier_accounts` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `carrier` VARCHAR(16) NULL,
  `status` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_carrier_accounts_sort` (`sort_order`),
  KEY `ix_carrier_accounts_carrier` (`carrier`),
  KEY `ix_carrier_accounts_status` (`status`),
  KEY `ix_carrier_accounts_created_at` (`created_at`),
  CONSTRAINT `chk_carrier_accounts_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- carriers: key code, created_at <- connectedSince
CREATE TABLE IF NOT EXISTS `carriers` (
  `code` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `name` VARCHAR(100) NULL,
  `type` VARCHAR(32) NULL,
  `status` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`code`),
  KEY `ix_carriers_sort` (`sort_order`),
  KEY `ix_carriers_type` (`type`),
  KEY `ix_carriers_status` (`status`),
  KEY `ix_carriers_created_at` (`created_at`),
  CONSTRAINT `chk_carriers_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- countries: key code, created_at <- launchedAt
CREATE TABLE IF NOT EXISTS `countries` (
  `code` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `role` VARCHAR(32) NULL,
  `currency` VARCHAR(8) NULL,
  `active` TINYINT(1) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`code`),
  KEY `ix_countries_sort` (`sort_order`),
  KEY `ix_countries_role` (`role`),
  KEY `ix_countries_active` (`active`),
  KEY `ix_countries_created_at` (`created_at`),
  CONSTRAINT `chk_countries_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- products: key sku, created_at <- createdAt
CREATE TABLE IF NOT EXISTS `products` (
  `sku` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `hs_code` VARCHAR(16) NULL,
  `hs_status` VARCHAR(32) NULL,
  `origin` VARCHAR(8) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`sku`),
  KEY `ix_products_sort` (`sort_order`),
  KEY `ix_products_hs_code` (`hs_code`),
  KEY `ix_products_hs_status` (`hs_status`),
  KEY `ix_products_created_at` (`created_at`),
  CONSTRAINT `chk_products_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- notifications: key id, created_at <- at
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `is_read` TINYINT(1) NULL,
  `type` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_notifications_sort` (`sort_order`),
  KEY `ix_notifications_is_read` (`is_read`),
  KEY `ix_notifications_type` (`type`),
  KEY `ix_notifications_created_at` (`created_at`),
  CONSTRAINT `chk_notifications_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- sync_logs: key id, created_at <- at
CREATE TABLE IF NOT EXISTS `sync_logs` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `store` VARCHAR(32) NULL,
  `op` VARCHAR(32) NULL,
  `result` VARCHAR(32) NULL,
  `order_id` VARCHAR(64) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_sync_logs_sort` (`sort_order`),
  KEY `ix_sync_logs_store` (`store`),
  KEY `ix_sync_logs_result` (`result`),
  KEY `ix_sync_logs_order_id` (`order_id`),
  KEY `ix_sync_logs_created_at` (`created_at`),
  CONSTRAINT `chk_sync_logs_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- audit_log: key id, created_at <- at
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `action` VARCHAR(64) NULL,
  `actor_id` VARCHAR(64) NULL,
  `target_id` VARCHAR(64) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_audit_log_sort` (`sort_order`),
  KEY `ix_audit_log_action` (`action`),
  KEY `ix_audit_log_target_id` (`target_id`),
  KEY `ix_audit_log_created_at` (`created_at`),
  CONSTRAINT `chk_audit_log_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- api_keys: key id, created_at <- createdAt
CREATE TABLE IF NOT EXISTS `api_keys` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `env` VARCHAR(16) NULL,
  `status` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_api_keys_sort` (`sort_order`),
  KEY `ix_api_keys_status` (`status`),
  KEY `ix_api_keys_created_at` (`created_at`),
  CONSTRAINT `chk_api_keys_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- rules: key id, created_at <- createdAt
CREATE TABLE IF NOT EXISTS `rules` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `priority` INT NULL,
  `active` TINYINT(1) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_rules_sort` (`sort_order`),
  KEY `ix_rules_priority` (`priority`),
  KEY `ix_rules_created_at` (`created_at`),
  CONSTRAINT `chk_rules_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- team: key id, created_at <- joinedAt
CREATE TABLE IF NOT EXISTS `team` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `email` VARCHAR(190) NULL,
  `role` VARCHAR(32) NULL,
  `status` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_team_sort` (`sort_order`),
  KEY `ix_team_email` (`email`),
  KEY `ix_team_created_at` (`created_at`),
  CONSTRAINT `chk_team_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- customers: key id, created_at <- pilotStartedAt
CREATE TABLE IF NOT EXISTS `customers` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `name` VARCHAR(160) NULL,
  `plan` VARCHAR(32) NULL,
  `status` VARCHAR(32) NULL,
  `hub` VARCHAR(16) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_customers_sort` (`sort_order`),
  KEY `ix_customers_status` (`status`),
  KEY `ix_customers_created_at` (`created_at`),
  CONSTRAINT `chk_customers_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- roadmap: key id
CREATE TABLE IF NOT EXISTS `roadmap` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `wp` VARCHAR(16) NULL,
  `state` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_roadmap_sort` (`sort_order`),
  KEY `ix_roadmap_state` (`state`),
  CONSTRAINT `chk_roadmap_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- batches: key id, created_at <- at
CREATE TABLE IF NOT EXISTS `batches` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_batches_sort` (`sort_order`),
  KEY `ix_batches_created_at` (`created_at`),
  CONSTRAINT `chk_batches_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- hubs: key code, created_at <- openedAt
CREATE TABLE IF NOT EXISTS `hubs` (
  `code` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `type` VARCHAR(32) NULL,
  `country` VARCHAR(8) NULL,
  `active` TINYINT(1) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`code`),
  KEY `ix_hubs_sort` (`sort_order`),
  KEY `ix_hubs_type` (`type`),
  KEY `ix_hubs_created_at` (`created_at`),
  CONSTRAINT `chk_hubs_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- box_presets: key id
CREATE TABLE IF NOT EXISTS `box_presets` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `type` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_box_presets_sort` (`sort_order`),
  CONSTRAINT `chk_box_presets_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- hs_codes: key code
CREATE TABLE IF NOT EXISTS `hs_codes` (
  `code` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`code`),
  KEY `ix_hs_codes_sort` (`sort_order`),
  CONSTRAINT `chk_hs_codes_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- hs_training: key id
CREATE TABLE IF NOT EXISTS `hs_training` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `hs_code` VARCHAR(16) NULL,
  `source` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_hs_training_sort` (`sort_order`),
  KEY `ix_hs_training_hs_code` (`hs_code`),
  CONSTRAINT `chk_hs_training_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- addresses_labeled: key id
CREATE TABLE IF NOT EXISTS `addresses_labeled` (
  `id` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `carrier` VARCHAR(16) NULL,
  `label` INT NULL,
  `issue_type` VARCHAR(32) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `ix_addresses_labeled_sort` (`sort_order`),
  KEY `ix_addresses_labeled_label` (`label`),
  CONSTRAINT `chk_addresses_labeled_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- history_weekly: keyless (seq = array index), created_at <- weekStart
CREATE TABLE IF NOT EXISTS `history_weekly` (
  `seq` INT NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `week_index` INT NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`seq`),
  KEY `ix_history_weekly_sort` (`sort_order`),
  KEY `ix_history_weekly_week_index` (`week_index`),
  KEY `ix_history_weekly_created_at` (`created_at`),
  CONSTRAINT `chk_history_weekly_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- zip_city: keyless (seq = array index)
CREATE TABLE IF NOT EXISTS `zip_city` (
  `seq` INT NOT NULL,
  `sort_order` DOUBLE NOT NULL DEFAULT 0,
  `zip` VARCHAR(10) NULL,
  `state` VARCHAR(4) NULL,
  `data` LONGTEXT NOT NULL,
  `created_at` DATETIME(3) NULL,
  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`seq`),
  KEY `ix_zip_city_sort` (`sort_order`),
  KEY `ix_zip_city_zip` (`zip`),
  KEY `ix_zip_city_state` (`state`),
  CONSTRAINT `chk_zip_city_data` CHECK (JSON_VALID(`data`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

