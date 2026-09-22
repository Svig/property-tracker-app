-- ============================================================
-- Migration 002 — properties, and linking clients/current_viewing to them
-- Run against an EXISTING database from an earlier init.postgres.sql.
-- Run as: psql -U postgres -d viewing_register -f migrate_002_properties.postgres.sql
-- ============================================================

\c viewing_register

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

-- Backfill a Property row per distinct free-text label already in use
INSERT INTO properties (tenant_id, name)
SELECT DISTINCT tenant_id, property FROM clients c
WHERE property IS NOT NULL AND property != ''
  AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.tenant_id = c.tenant_id AND p.name = c.property);

INSERT INTO properties (tenant_id, name)
SELECT DISTINCT tenant_id, property FROM current_viewing cv
WHERE property IS NOT NULL AND property != ''
  AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.tenant_id = cv.tenant_id AND p.name = cv.property);

ALTER TABLE clients ALTER COLUMN source TYPE VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS source_detail VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL;

UPDATE clients c
SET property_id = p.id
FROM properties p
WHERE p.tenant_id = c.tenant_id AND p.name = c.property AND c.property_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_property ON clients(property_id);
CREATE INDEX IF NOT EXISTS idx_clients_tenant_phone ON clients(tenant_id, phone);

ALTER TABLE current_viewing ADD COLUMN IF NOT EXISTS property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL;

UPDATE current_viewing cv
SET property_id = p.id
FROM properties p
WHERE p.tenant_id = cv.tenant_id AND p.name = cv.property AND cv.property_id IS NULL;

-- Rebuild recent_properties against managed properties (safe to reset, it's
-- just a quick-pick cache that repopulates itself)
DROP TABLE IF EXISTS recent_properties;
CREATE TABLE recent_properties (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  used_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recent_tenant ON recent_properties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recent_used_at ON recent_properties(used_at);

SELECT 'Migration 002 complete.' AS status;
