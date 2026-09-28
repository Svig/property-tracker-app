-- ============================================================
-- Migration 004 — user profile fields (mobile number, email/mobile
-- verification groundwork), tenant-level admin protection, and a
-- tenant-level allowed email domain column for future use.
--
-- NOTE: this version is corrected from the one first shipped, based on
-- real-world testing against Aiven's MySQL. Two plain MySQL limitations
-- (not Aiven-specific) caused the original to fail:
--   1. MySQL's ALTER TABLE ... ADD COLUMN does not accept IF NOT EXISTS
--      (that's a MariaDB-only extension) — removed here.
--   2. The correlated NOT EXISTS subquery in the UPDATE didn't work as
--      written — rewritten as a LEFT JOIN ... IS NULL instead.
-- If you're running this for the first time, this version should apply
-- cleanly on real MySQL, MariaDB, or Aiven's MySQL.
--
-- Run as: mysql -u root -p viewing_register < migrate_004_user_profile.mariadb.sql
-- ============================================================

USE viewing_register;

ALTER TABLE users
  ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER email,
  ADD COLUMN mobile VARCHAR(40) NULL AFTER email_verified,
  ADD COLUMN mobile_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER mobile,
  ADD COLUMN is_super_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active;

ALTER TABLE tenants
  ADD COLUMN allowed_email_domain VARCHAR(190) NULL AFTER logo_url;

-- Make the earliest admin in each tenant the protected admin, if one
-- hasn't been designated yet.
UPDATE users u
JOIN (
    SELECT tenant_id, MIN(id) AS first_admin_id
    FROM users
    WHERE role = 'admin'
    GROUP BY tenant_id
) fa ON fa.tenant_id = u.tenant_id AND fa.first_admin_id = u.id
LEFT JOIN (
    SELECT tenant_id
    FROM users
    WHERE is_super_admin = 1
    GROUP BY tenant_id
) sa ON sa.tenant_id = u.tenant_id
SET u.is_super_admin = 1
WHERE sa.tenant_id IS NULL;

SELECT 'Migration 004 complete.' AS status;
