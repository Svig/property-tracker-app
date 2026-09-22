-- ============================================================
-- Migration 004 — super admin protection, user profile fields
-- Run as: psql -U postgres -d viewing_register -f migrate_004_user_profile.postgres.sql
-- ============================================================

\c viewing_register

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS allowed_email_domain VARCHAR(190);

-- Make the earliest admin in each tenant the super admin, if one hasn't
-- been designated yet. Safe to run more than once.
UPDATE users u
SET is_super_admin = TRUE
FROM (
  SELECT tenant_id, MIN(id) AS first_admin_id
  FROM users
  WHERE role = 'admin'
  GROUP BY tenant_id
) fa
WHERE fa.tenant_id = u.tenant_id AND fa.first_admin_id = u.id
  AND NOT EXISTS (
    SELECT 1 FROM users u2 WHERE u2.tenant_id = u.tenant_id AND u2.is_super_admin = TRUE
  );

SELECT 'Migration 004 complete.' AS status;
