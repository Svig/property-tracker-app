-- ============================================================
-- Viewing Register — PostgreSQL initialization script
-- Run as: psql -U postgres -f init.postgres.sql
--
-- Tenant-ready: every row belongs to a tenant via tenant_id. Only one
-- tenant ("Default") is seeded for now — see init.mariadb.sql header
-- for the same note, and README.md "Multi-tenancy" for what's still
-- needed to actually onboard a second tenant.
-- ============================================================

CREATE DATABASE viewing_register;
\c viewing_register

CREATE TYPE user_role AS ENUM ('admin', 'agent');
CREATE TYPE client_status AS ENUM ('new','contacted','scheduled','offer','won','lost');

-- ------------------------------------------------------------
-- tenants
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(160)  NOT NULL,
  slug            VARCHAR(80)   NOT NULL UNIQUE,
  app_name        VARCHAR(160),
  primary_color   VARCHAR(20),
  brass_color     VARCHAR(20),
  logo_url        VARCHAR(500),
  allowed_email_domain VARCHAR(190),
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- users — email unique per tenant, not globally. The seeded admin is
-- also the tenant's super admin (is_super_admin=true): that one account
-- can never be deleted, demoted, or deactivated by anyone, including
-- other admins. email_verified / mobile / mobile_verified are groundwork
-- for future verification flows (not enforced anywhere yet).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  tenant_id       INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            VARCHAR(120)  NOT NULL,
  email           VARCHAR(190)  NOT NULL,
  email_verified  BOOLEAN       NOT NULL DEFAULT FALSE,
  mobile          VARCHAR(40),
  mobile_verified BOOLEAN       NOT NULL DEFAULT FALSE,
  password_hash   VARCHAR(255)  NOT NULL,
  role            user_role     NOT NULL DEFAULT 'agent',
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  is_super_admin  BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- ------------------------------------------------------------
-- properties — the actual listings/units your agents show
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  address       VARCHAR(500),
  listing_url   VARCHAR(1000),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_properties_tenant ON properties(tenant_id);

-- ------------------------------------------------------------
-- clients — source is now VARCHAR(255) to hold multiple comma-joined
-- selections (multi-select "how did you hear about this viewing/us?"),
-- source_detail holds the freehand follow-up, property_id links to a
-- managed property.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                VARCHAR(160)   NOT NULL,
  phone               VARCHAR(40)    NOT NULL,
  email               VARCHAR(190),
  property            VARCHAR(255),
  property_id         INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  budget              VARCHAR(80),
  financing           VARCHAR(60),
  timeline            VARCHAR(60),
  source              VARCHAR(255),
  source_detail       VARCHAR(255),
  status              client_status  NOT NULL DEFAULT 'new',
  consent             BOOLEAN        NOT NULL DEFAULT FALSE,
  consent_marketing   BOOLEAN        NOT NULL DEFAULT FALSE,
  viewing_date        DATE,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP      NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_status ON clients(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_clients_created_at ON clients(created_at);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);
CREATE INDEX IF NOT EXISTS idx_clients_property ON clients(property_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_phone ON clients(tenant_id, phone);

-- ------------------------------------------------------------
-- client_notes — tenant_id denormalized here too (see mariadb notes)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_notes (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notes_tenant ON client_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notes_client ON client_notes(client_id);

-- ------------------------------------------------------------
-- property_agents — many-to-many visibility gate for the 'agent' role.
-- Admins bypass this (they see every property); agents only see
-- properties they're assigned to. Managed from the Properties screen.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_agents (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id   INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (property_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_property_agents_tenant ON property_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_property_agents_user ON property_agents(user_id);

-- ------------------------------------------------------------
-- current_viewing — one row per USER, not per tenant (see mariadb
-- schema notes for why: a shared tenant-wide value would strand an
-- agent on a property they're no longer assigned to).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS current_viewing (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property    VARCHAR(255),
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- recent_properties — rolling list of recently-used properties, per user
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recent_properties (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  used_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recent_tenant ON recent_properties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recent_user ON recent_properties(user_id);
CREATE INDEX IF NOT EXISTS idx_recent_used_at ON recent_properties(used_at);

-- ------------------------------------------------------------
-- Seed the default tenant and its first admin user.
-- Email:    admin@example.com
-- Password: ChangeMe123!
-- CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN.
-- ------------------------------------------------------------
INSERT INTO tenants (id, name, slug, app_name)
VALUES (1, 'Default', 'default', 'Viewing Register')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, tenant_id, name, email, password_hash, role, is_super_admin)
VALUES (
  1,
  1,
  'Admin',
  'admin@example.com',
  '$2b$10$haTEt1tfs3Imttd5lNuqEecAlyC97.pfy538PsmhWmQNoEBMbJYZ6',
  'admin',
  TRUE
)
ON CONFLICT (tenant_id, email) DO NOTHING;

INSERT INTO current_viewing (user_id, tenant_id, property) VALUES (1, 1, NULL)
  ON CONFLICT (user_id) DO NOTHING;

SELECT setval('tenants_id_seq', (SELECT MAX(id) FROM tenants));
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
