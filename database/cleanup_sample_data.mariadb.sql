-- ============================================================
-- Removes the demo data added by migrate_006_sample_data.mariadb.sql
-- (tenant 1 only). NOT run automatically - run it yourself, or paste it
-- into any SQL console. Removing the data does not bring it back on the
-- next deploy: schema_migrations remembers that 006 was applied.
-- WARNING: deletes every sign-in at these 5 properties, including any
-- real ones added since.
-- ============================================================
DELETE FROM clients WHERE tenant_id = 1 AND property_id IN (
  SELECT id FROM (SELECT id FROM properties WHERE tenant_id = 1 AND name IN (
    '12 Beach Road, Sea Point',
    'Villa 7, Vineyard Estate, Constantia',
    'Unit 304, Harbour Quay, V&A Waterfront',
    '45 Oak Avenue, Claremont',
    '18 Dune Crescent, Table View')) x);

DELETE FROM properties WHERE tenant_id = 1 AND name IN (
  '12 Beach Road, Sea Point',
  'Villa 7, Vineyard Estate, Constantia',
  'Unit 304, Harbour Quay, V&A Waterfront',
  '45 Oak Avenue, Claremont',
  '18 Dune Crescent, Table View');
