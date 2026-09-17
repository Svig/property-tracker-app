-- ============================================================
-- Viewing Register — MariaDB initialization script
-- Run as: mysql -u root -p < init.mariadb.sql
-- (or) mariadb -u root -p < init.mariadb.sql
--
-- Tenant-ready: every row belongs to a tenant via tenant_id. Only one
-- tenant ("Default") is seeded for now, so this behaves exactly like a
-- single-tenant app today — but every table, index, and foreign key
-- already reflects the multi-tenant shape. See README.md "Multi-tenancy"
-- section for what's still needed to actually onboard a second tenant
-- (tenant resolution, a super-admin tier, per-tenant theming).
-- ============================================================

CREATE DATABASE IF NOT EXISTS viewing_register
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE viewing_register;

-- ------------------------------------------------------------
-- tenants — one row per company/deployment using this app.
-- Theming fields let each tenant get its own colours/logo/name
-- without forking the codebase (see public/styles.css variables).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(160)  NOT NULL,
  slug            VARCHAR(80)   NOT NULL,
  app_name        VARCHAR(160)  NULL,
  primary_color   VARCHAR(20)   NULL,
  brass_color     VARCHAR(20)   NULL,
  logo_url        VARCHAR(500)  NULL,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenants_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- users — application logins. First user is seeded as admin.
-- Email is unique per tenant, not globally, so two different
-- companies can each onboard someone with the same address.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT UNSIGNED        NOT NULL,
  name          VARCHAR(120)        NOT NULL,
  email         VARCHAR(190)        NOT NULL,
  password_hash VARCHAR(255)        NOT NULL,
  role          ENUM('admin','agent') NOT NULL DEFAULT 'agent',
  is_active     TINYINT(1)          NOT NULL DEFAULT 1,
  created_at    DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_tenant_email (tenant_id, email),
  KEY idx_users_tenant (tenant_id),
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- clients — captured leads / viewing sign-ins
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           INT UNSIGNED  NOT NULL,
  name                VARCHAR(160)  NOT NULL,
  phone               VARCHAR(40)   NOT NULL,
  email               VARCHAR(190)  NULL,
  property            VARCHAR(255)  NULL,
  budget              VARCHAR(80)   NULL,
  financing           VARCHAR(60)   NULL,
  timeline            VARCHAR(60)   NULL,
  source              VARCHAR(60)   NULL,
  status              ENUM('new','contacted','scheduled','offer','won','lost') NOT NULL DEFAULT 'new',
  consent             TINYINT(1)    NOT NULL DEFAULT 0,
  consent_marketing   TINYINT(1)    NOT NULL DEFAULT 0,
  viewing_date        DATE          NULL,
  created_by          INT UNSIGNED  NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_clients_tenant (tenant_id),
  KEY idx_clients_tenant_status (tenant_id, status),
  KEY idx_clients_created_at (created_at),
  KEY idx_clients_name (name),
  CONSTRAINT fk_clients_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_clients_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- client_notes — timestamped follow-up notes per client.
-- tenant_id is denormalized here (also derivable via client_id) so
-- every query can filter by tenant directly without a join — a small
-- redundancy that makes it much harder to accidentally leak data
-- across tenants later.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_notes (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   INT UNSIGNED NOT NULL,
  client_id   INT UNSIGNED NOT NULL,
  note        TEXT         NOT NULL,
  created_by  INT UNSIGNED NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notes_tenant (tenant_id),
  KEY idx_notes_client (client_id),
  CONSTRAINT fk_notes_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- current_viewing — the property currently being shown.
-- One row per tenant (tenant_id is now the primary key, replacing
-- the old fixed-id=1 singleton design).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS current_viewing (
  tenant_id   INT UNSIGNED PRIMARY KEY,
  property    VARCHAR(255) NULL,
  updated_by  INT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_viewing_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_viewing_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- recent_properties — small rolling list for quick reselection
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recent_properties (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT UNSIGNED NOT NULL,
  property  VARCHAR(255) NOT NULL,
  used_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_recent_tenant (tenant_id),
  KEY idx_recent_used_at (used_at),
  CONSTRAINT fk_recent_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Seed one default tenant, and the first admin user inside it.
-- Email:    admin@example.com
-- Password: ChangeMe123!
-- CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN.
-- ------------------------------------------------------------
INSERT IGNORE INTO tenants (id, name, slug, app_name)
VALUES (1, 'Default', 'default', 'Viewing Register');

INSERT IGNORE INTO current_viewing (tenant_id, property) VALUES (1, NULL);

INSERT IGNORE INTO users (id, tenant_id, name, email, password_hash, role)
VALUES (
  1,
  1,
  'Admin',
  'admin@example.com',
  '$2b$10$haTEt1tfs3Imttd5lNuqEecAlyC97.pfy538PsmhWmQNoEBMbJYZ6',
  'admin'
);
