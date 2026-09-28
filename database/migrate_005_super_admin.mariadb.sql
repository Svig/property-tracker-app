-- ============================================================
-- Migration 005 — global super admin layer
-- Adds a `super_admins` table (platform operators, separate from
-- tenant `users`), a `subscription_tier` column on tenants (groundwork
-- for future tier-based feature gating), and renames the tenant-level
-- `users.is_super_admin` column to `is_primary_admin` — freeing up
-- "super admin" to mean the new global concept, not a tenant-scoped one.
--
-- Only needed if you already ran migrate_004 (i.e. your `users` table
-- currently has an `is_super_admin` column). A fresh install via
-- init.mariadb.sql already has everything this migration adds.
--
-- Run as: mysql -u root -p viewing_register < migrate_005_super_admin.mariadb.sql
-- ============================================================

USE viewing_register;

-- 1. Rename the tenant-level protected-admin flag.
ALTER TABLE users CHANGE COLUMN is_super_admin is_primary_admin TINYINT(1) NOT NULL DEFAULT 0;

-- 2. Subscription tier groundwork on tenants.
ALTER TABLE tenants ADD COLUMN subscription_tier VARCHAR(40) NOT NULL DEFAULT 'free';

-- 3. The new, separate super_admins table.
CREATE TABLE IF NOT EXISTS super_admins (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(190)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_super_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Seed the first super admin (skip if one already exists).
--    Email:    superadmin@example.com
--    Password: ChangeMeSuperAdmin123!
--    CHANGE THIS PASSWORD IMMEDIATELY AFTER FIRST LOGIN.
INSERT IGNORE INTO super_admins (id, name, email, password_hash)
VALUES (
  1,
  'Super Admin',
  'superadmin@example.com',
  '$2a$10$XFQd.0.Q48acN5roWJI4a.T4Iv4m7/Lyxb3J6eldBIekdtQ8Ydube'
);

SELECT 'Migration 005 complete.' AS status;
