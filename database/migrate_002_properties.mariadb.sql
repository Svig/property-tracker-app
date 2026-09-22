-- ============================================================
-- Migration 002 — properties, and linking clients/current_viewing to them
-- Run this against an EXISTING database (one already set up from an
-- earlier init.mariadb.sql) instead of re-running the full init script,
-- which would try to recreate tables that already exist.
--
-- Run as: mysql -u root -p viewing_register < migrate_002_properties.mariadb.sql
-- ============================================================

USE viewing_register;

-- 1. New properties table
CREATE TABLE IF NOT EXISTS properties (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT UNSIGNED  NOT NULL,
  name          VARCHAR(255)  NOT NULL,
  address       VARCHAR(500)  NULL,
  listing_url   VARCHAR(1000) NULL,
  created_by    INT UNSIGNED  NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_properties_tenant (tenant_id),
  CONSTRAINT fk_properties_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_properties_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Backfill a Property row for every distinct free-text property label
--    already sitting in clients/current_viewing, so existing sign-ins don't
--    lose their property association.
INSERT INTO properties (tenant_id, name)
SELECT DISTINCT tenant_id, property FROM clients
WHERE property IS NOT NULL AND property != ''
  AND NOT EXISTS (
    SELECT 1 FROM properties p WHERE p.tenant_id = clients.tenant_id AND p.name = clients.property
  );

INSERT INTO properties (tenant_id, name)
SELECT DISTINCT tenant_id, property FROM current_viewing
WHERE property IS NOT NULL AND property != ''
  AND NOT EXISTS (
    SELECT 1 FROM properties p WHERE p.tenant_id = current_viewing.tenant_id AND p.name = current_viewing.property
  );

-- 3. Widen clients.source (multi-select now) and add source_detail + property_id
ALTER TABLE clients
  MODIFY COLUMN source VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS source_detail VARCHAR(255) NULL AFTER source,
  ADD COLUMN IF NOT EXISTS property_id INT UNSIGNED NULL AFTER property;

UPDATE clients c
JOIN properties p ON p.tenant_id = c.tenant_id AND p.name = c.property
SET c.property_id = p.id
WHERE c.property_id IS NULL AND c.property IS NOT NULL;

ALTER TABLE clients
  ADD KEY IF NOT EXISTS idx_clients_property (property_id),
  ADD KEY IF NOT EXISTS idx_clients_tenant_phone (tenant_id, phone);

-- Adding the FK separately so this migration doesn't fail outright if it
-- happens to already exist from a partial prior run.
SET @fk_exists = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = 'viewing_register' AND CONSTRAINT_NAME = 'fk_clients_property'
);
SET @sql = IF(@fk_exists = 0,
  'ALTER TABLE clients ADD CONSTRAINT fk_clients_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL',
  'SELECT "fk_clients_property already exists, skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 4. Link current_viewing to a managed property too
ALTER TABLE current_viewing
  ADD COLUMN IF NOT EXISTS property_id INT UNSIGNED NULL AFTER property;

UPDATE current_viewing cv
JOIN properties p ON p.tenant_id = cv.tenant_id AND p.name = cv.property
SET cv.property_id = p.id
WHERE cv.property_id IS NULL AND cv.property IS NOT NULL;

SET @fk_exists2 = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = 'viewing_register' AND CONSTRAINT_NAME = 'fk_viewing_property'
);
SET @sql2 = IF(@fk_exists2 = 0,
  'ALTER TABLE current_viewing ADD CONSTRAINT fk_viewing_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL',
  'SELECT "fk_viewing_property already exists, skipping"');
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;

-- 5. Rebuild recent_properties to point at managed properties instead of
--    free text. This is just a quick-pick cache, so it's fine to reset it —
--    it repopulates itself as you use the "change property" screen again.
DROP TABLE IF EXISTS recent_properties;
CREATE TABLE recent_properties (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   INT UNSIGNED NOT NULL,
  property_id INT UNSIGNED NOT NULL,
  used_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_recent_tenant (tenant_id),
  KEY idx_recent_used_at (used_at),
  CONSTRAINT fk_recent_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_recent_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 002 complete.' AS status;
