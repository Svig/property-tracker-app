-- ============================================================
-- Migration 005 — global super admin layer (Postgres)
-- See migrate_005_super_admin.mariadb.sql for the full explanation.
-- Only needed if you already ran migrate_004. A fresh install via
-- init.postgres.sql already has everything this migration adds.
--
-- Run as: psql -U postgres -d viewing_register -f migrate_005_super_admin.postgres.sql
-- ============================================================

\c viewing_register

ALTER TABLE users RENAME COLUMN is_super_admin TO is_primary_admin;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(40) NOT NULL DEFAULT 'free';

CREATE TABLE IF NOT EXISTS super_admins (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(190)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Seed the first super admin (skip if one already exists).
--   Email:    superadmin@example.com
--   Password: ChangeMeSuperAdmin123!
--   CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN.
INSERT INTO super_admins (id, name, email, password_hash)
VALUES (
  1,
  'Super Admin',
  'superadmin@example.com',
  '$2a$10$XFQd.0.Q48acN5roWJI4a.T4Iv4m7/Lyxb3J6eldBIekdtQ8Ydube'
)
ON CONFLICT (email) DO NOTHING;

SELECT setval('super_admins_id_seq', (SELECT MAX(id) FROM super_admins));

SELECT 'Migration 005 complete.' AS status;
