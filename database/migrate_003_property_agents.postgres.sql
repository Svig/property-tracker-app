-- ============================================================
-- Migration 003 — agent-to-property assignments, and current_viewing /
-- recent_properties restructured from per-tenant to per-user.
-- See migrate_003_property_agents.mariadb.sql for the full explanation.
--
-- Run as: psql -U postgres -d viewing_register -f migrate_003_property_agents.postgres.sql
-- ============================================================

\c viewing_register

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

CREATE TEMP TABLE _old_viewing AS SELECT * FROM current_viewing;

DROP TABLE IF EXISTS current_viewing;
CREATE TABLE current_viewing (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property    VARCHAR(255),
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO current_viewing (user_id, tenant_id, property, property_id)
SELECT u.id, u.tenant_id, ov.property, ov.property_id
FROM users u
LEFT JOIN _old_viewing ov ON ov.tenant_id = u.tenant_id;

DROP TABLE IF EXISTS recent_properties;
CREATE TABLE recent_properties (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  used_at     TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recent_tenant ON recent_properties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recent_user ON recent_properties(user_id);
CREATE INDEX IF NOT EXISTS idx_recent_used_at ON recent_properties(used_at);

SELECT 'Migration 003 complete. Every existing property is currently unassigned — open the Properties tab as an admin to assign agents.' AS status;
