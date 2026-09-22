-- ============================================================
-- Migration 003 — agent-to-property assignments, and current_viewing /
-- recent_properties restructured from per-tenant to per-user.
--
-- Why the restructure: once agents only see their assigned properties, a
-- single tenant-wide "current viewing" value could strand an agent on a
-- property they can no longer access. Each user now has their own.
--
-- This carries forward each tenant's previous current-viewing property as
-- a starting point for every user in that tenant (just a convenience —
-- they can change it immediately). recent_properties is reset to empty
-- per user since it's only a quick-pick cache, not real history.
--
-- Run as: mysql -u root -p viewing_register < migrate_003_property_agents.mariadb.sql
-- ============================================================

USE viewing_register;

CREATE TABLE IF NOT EXISTS property_agents (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT UNSIGNED NOT NULL,
  property_id   INT UNSIGNED NOT NULL,
  user_id       INT UNSIGNED NOT NULL,
  assigned_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_property_agent (property_id, user_id),
  KEY idx_property_agents_tenant (tenant_id),
  KEY idx_property_agents_user (user_id),
  CONSTRAINT fk_pa_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Stash the old per-tenant current_viewing values before rebuilding the table
CREATE TEMPORARY TABLE _old_viewing AS SELECT * FROM current_viewing;

DROP TABLE IF EXISTS current_viewing;
CREATE TABLE current_viewing (
  user_id     INT UNSIGNED PRIMARY KEY,
  tenant_id   INT UNSIGNED NOT NULL,
  property    VARCHAR(255) NULL,
  property_id INT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_viewing_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_viewing_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_viewing_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Give every existing user a starting current_viewing row, carried over
-- from their tenant's old shared value where one existed.
INSERT INTO current_viewing (user_id, tenant_id, property, property_id)
SELECT u.id, u.tenant_id, ov.property, ov.property_id
FROM users u
LEFT JOIN _old_viewing ov ON ov.tenant_id = u.tenant_id;

DROP TABLE IF EXISTS recent_properties;
CREATE TABLE recent_properties (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  property_id INT UNSIGNED NOT NULL,
  used_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_recent_tenant (tenant_id),
  KEY idx_recent_user (user_id),
  KEY idx_recent_used_at (used_at),
  CONSTRAINT fk_recent_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_recent_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_recent_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'Migration 003 complete. Every existing property is currently unassigned — open the Properties tab as an admin to assign agents.' AS status;
