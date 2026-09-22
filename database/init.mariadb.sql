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
  allowed_email_domain VARCHAR(190) NULL,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenants_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- users — application logins. First user is seeded as admin AND as the
-- tenant's super admin (is_super_admin=1): that one account can never be
-- deleted, demoted, or deactivated by anyone — including other admins —
-- so a tenant can never accidentally lock itself out of admin access.
-- Email is unique per tenant, not globally, so two different companies
-- can each onboard someone with the same address.
-- email_verified / mobile_verified / mobile are groundwork for future
-- verification flows (not enforced anywhere yet — see README).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       INT UNSIGNED        NOT NULL,
  name            VARCHAR(120)        NOT NULL,
  email           VARCHAR(190)        NOT NULL,
  email_verified  TINYINT(1)          NOT NULL DEFAULT 0,
  mobile          VARCHAR(40)         NULL,
  mobile_verified TINYINT(1)          NOT NULL DEFAULT 0,
  password_hash   VARCHAR(255)        NOT NULL,
  role            ENUM('admin','agent') NOT NULL DEFAULT 'agent',
  is_active       TINYINT(1)          NOT NULL DEFAULT 1,
  is_super_admin  TINYINT(1)          NOT NULL DEFAULT 0,
  created_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME            NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_tenant_email (tenant_id, email),
  KEY idx_users_tenant (tenant_id),
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- properties — the actual listings/units your agents show.
-- Linking a sign-in to a property (rather than a free-text label)
-- is what makes "who viewed this property" and "which properties has
-- this person viewed" answerable later.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- clients — captured leads / viewing sign-ins
-- property_id links this sign-in to a managed property (nullable —
-- older/ad-hoc rows may only have the free-text `property` label).
-- source can hold multiple comma-separated selections now that "how
-- did you hear about this viewing" is multi-select, hence VARCHAR(255)
-- instead of the original VARCHAR(60). source_detail carries the
-- freehand follow-up (who referred them, or general notes).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           INT UNSIGNED  NOT NULL,
  name                VARCHAR(160)  NOT NULL,
  phone               VARCHAR(40)   NOT NULL,
  email               VARCHAR(190)  NULL,
  property            VARCHAR(255)  NULL,
  property_id         INT UNSIGNED  NULL,
  budget              VARCHAR(80)   NULL,
  financing           VARCHAR(60)   NULL,
  timeline            VARCHAR(60)   NULL,
  source              VARCHAR(255)  NULL,
  source_detail       VARCHAR(255)  NULL,
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
  KEY idx_clients_property (property_id),
  KEY idx_clients_tenant_phone (tenant_id, phone),
  CONSTRAINT fk_clients_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_clients_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_clients_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL
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
-- property_agents — which agents can see/use which properties.
-- Many-to-many: an agent can be assigned to multiple properties, a
-- property can have multiple assigned agents. Admins bypass this table
-- entirely (they see every property in their tenant); this table only
-- gates visibility for the 'agent' role. Managed from the Properties
-- screen by an admin.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- current_viewing — the property currently being shown.
-- One row per USER, not per tenant: now that agents only see their
-- assigned properties, a single shared tenant-wide "now viewing" would
-- let an agent get stuck pointing at a property they can't access.
-- Each agent (and each admin) tracks their own.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS current_viewing (
  user_id     INT UNSIGNED PRIMARY KEY,
  tenant_id   INT UNSIGNED NOT NULL,
  property    VARCHAR(255) NULL,
  property_id INT UNSIGNED NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_viewing_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_viewing_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_viewing_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- recent_properties — small rolling list of recently-used managed
-- properties for quick-pick chips. Per user, same reasoning as above.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recent_properties (
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

-- ------------------------------------------------------------
-- Seed one default tenant, and the first admin user inside it.
-- Email:    admin@example.com
-- Password: ChangeMe123!
-- CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN.
-- ------------------------------------------------------------
INSERT IGNORE INTO tenants (id, name, slug, app_name)
VALUES (1, 'Default', 'default', 'Viewing Register');

INSERT IGNORE INTO users (id, tenant_id, name, email, password_hash, role, is_super_admin)
VALUES (
  1,
  1,
  'Admin',
  'admin@example.com',
  '$2b$10$haTEt1tfs3Imttd5lNuqEecAlyC97.pfy538PsmhWmQNoEBMbJYZ6',
  'admin',
  1
);

INSERT IGNORE INTO current_viewing (user_id, tenant_id, property) VALUES (1, 1, NULL);
