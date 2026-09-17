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
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- users — email unique per tenant, not globally
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(190)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  role          user_role     NOT NULL DEFAULT 'agent',
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- ------------------------------------------------------------
-- clients
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id                  SERIAL PRIMARY KEY,
  tenant_id           INTEGER        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                VARCHAR(160)   NOT NULL,
  phone               VARCHAR(40)    NOT NULL,
  email               VARCHAR(190),
  property            VARCHAR(255),
  budget              VARCHAR(80),
  financing           VARCHAR(60),
  timeline            VARCHAR(60),
  source              VARCHAR(60),
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
-- current_viewing — one row per tenant (tenant_id is the PK)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS current_viewing (
  tenant_id   INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  property    VARCHAR(255),
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- recent_properties
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recent_properties (
  id        SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property  VARCHAR(255) NOT NULL,
  used_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recent_tenant ON recent_properties(tenant_id);
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

INSERT INTO current_viewing (tenant_id, property) VALUES (1, NULL)
  ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO users (id, tenant_id, name, email, password_hash, role)
VALUES (
  1,
  1,
  'Admin',
  'admin@example.com',
  '$2b$10$haTEt1tfs3Imttd5lNuqEecAlyC97.pfy538PsmhWmQNoEBMbJYZ6',
  'admin'
)
ON CONFLICT (tenant_id, email) DO NOTHING;

SELECT setval('tenants_id_seq', (SELECT MAX(id) FROM tenants));
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
