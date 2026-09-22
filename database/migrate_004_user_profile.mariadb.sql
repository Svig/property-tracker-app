-- ============================================================
-- Migration 004 — super admin protection, user profile fields
-- (mobile number, email/mobile verification groundwork), and a
-- tenant-level allowed email domain column for future use.
-- Run as: mysql -u root -p viewing_register < migrate_004_user_profile.mariadb.sql
-- ============================================================

USE viewing_register;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER email,
  ADD COLUMN IF NOT EXISTS mobile VARCHAR(40) NULL AFTER email_verified,
  ADD COLUMN IF NOT EXISTS mobile_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER mobile,
  ADD COLUMN IF NOT EXISTS is_super_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS allowed_email_domain VARCHAR(190) NULL AFTER logo_url;

-- Make the earliest admin in each tenant the super admin, if one hasn't
-- been designated yet. Safe to run more than once — it's a no-op once
-- each tenant already has one.
UPDATE users u
JOIN (
  SELECT tenant_id, MIN(id) AS first_admin_id
  FROM users
  WHERE role = 'admin'
  GROUP BY tenant_id
) fa ON fa.tenant_id = u.tenant_id AND fa.first_admin_id = u.id
SET u.is_super_admin = 1
WHERE NOT EXISTS (
  SELECT 1 FROM users u2 WHERE u2.tenant_id = u.tenant_id AND u2.is_super_admin = 1
);

SELECT 'Migration 004 complete.' AS status;
