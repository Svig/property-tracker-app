-- ============================================================
-- Migration 006 - sample / demo data (MariaDB / MySQL)
-- ------------------------------------------------------------
-- Applied automatically ONCE by backend/scripts/bootstrap-db.js on the
-- next start (tracked in the schema_migrations table), so it needs no
-- database client on your own machine.
--
-- Adds 5 properties and 32 viewing sign-ins to tenant 1 (the Default
-- tenant). Everyone is fictional (example.com emails, 555 numbers).
-- Repeat visitors (same person signed in more than once):
--   Sea Point  : 3 rows are people who also viewed elsewhere
--   Waterfront : 5 rows are people who also viewed elsewhere
--   Claremont  : 3 rows are people who also viewed elsewhere
--   Thandiwe Mokoena views 3 properties; Pieter van der Merwe, Naledi
--   Dlamini, Megan Fourie and Kabelo Molefe view 2 each. Naledi's phone
--   is "072 555 0105" and "+27 72 555 0105" on purpose, to exercise the
--   repeat sign-in matching.
--
-- Written so it is safe to run again and never needs a session variable
-- (the app's connection pool may use a different connection per
-- statement): every statement is self-contained and skips rows that are
-- already there. If tenant 1 does not exist it inserts nothing.
-- To remove the data later, see database/cleanup_sample_data.mariadb.sql.
-- ============================================================


INSERT INTO properties (tenant_id, name, address, listing_url, created_by)
SELECT t.id, '12 Beach Road, Sea Point', '12 Beach Road, Sea Point, Cape Town, 8005', 'https://www.example.com/listings/12-beach-road-sea-point', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1)
FROM tenants t
WHERE t.id = 1
  AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.tenant_id = t.id AND p.name = '12 Beach Road, Sea Point');


INSERT INTO properties (tenant_id, name, address, listing_url, created_by)
SELECT t.id, 'Villa 7, Vineyard Estate, Constantia', '7 Vineyard Drive, Constantia, Cape Town, 7806', 'https://www.example.com/listings/villa-7-vineyard-estate-constantia', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1)
FROM tenants t
WHERE t.id = 1
  AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.tenant_id = t.id AND p.name = 'Villa 7, Vineyard Estate, Constantia');


INSERT INTO properties (tenant_id, name, address, listing_url, created_by)
SELECT t.id, 'Unit 304, Harbour Quay, V&A Waterfront', 'Dock Road, V&A Waterfront, Cape Town, 8001', 'https://www.example.com/listings/unit-304-harbour-quay-waterfront', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1)
FROM tenants t
WHERE t.id = 1
  AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.tenant_id = t.id AND p.name = 'Unit 304, Harbour Quay, V&A Waterfront');


INSERT INTO properties (tenant_id, name, address, listing_url, created_by)
SELECT t.id, '45 Oak Avenue, Claremont', '45 Oak Avenue, Claremont, Cape Town, 7708', 'https://www.example.com/listings/45-oak-avenue-claremont', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1)
FROM tenants t
WHERE t.id = 1
  AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.tenant_id = t.id AND p.name = '45 Oak Avenue, Claremont');


INSERT INTO properties (tenant_id, name, address, listing_url, created_by)
SELECT t.id, '18 Dune Crescent, Table View', '18 Dune Crescent, Table View, Cape Town, 7441', 'https://www.example.com/listings/18-dune-crescent-table-view', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1)
FROM tenants t
WHERE t.id = 1
  AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.tenant_id = t.id AND p.name = '18 Dune Crescent, Table View');


-- 12 Beach Road, Sea Point  (8 sign-ins)
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Thandiwe Mokoena', '082 555 0101', 'thandiwe.mokoena@example.com', p.name, p.id, 'R 3 500 000 – R 5 000 000', 'Bond pre-approved', '1–3 months', 'Signboard', NULL, 'contacted', 1, 1, '2026-09-05', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-05 10:15:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '12 Beach Road, Sea Point'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '082 555 0101');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Pieter van der Merwe', '083 555 0102', 'pieter.vdm@example.com', p.name, p.id, 'R 4 000 000 – R 6 000 000', 'Cash buyer', 'Immediately', 'Online listing', NULL, 'contacted', 1, 0, '2026-09-05', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-05 11:40:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '12 Beach Road, Sea Point'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '083 555 0102');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Aisha Patel', '084 555 0103', 'aisha.patel@example.com', p.name, p.id, 'R 3 000 000 – R 4 000 000', 'Needs bond approval', '3–6 months', 'Referral', 'Referred by Simone Hendricks', 'lost', 1, 1, '2026-09-05', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-05 14:05:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '12 Beach Road, Sea Point'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '084 555 0103');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Johan Botha', '071 555 0104', NULL, p.name, p.id, 'R 3 800 000', 'Bond pre-approved', 'Immediately', 'Walk-in', NULL, 'won', 1, 1, '2026-09-06', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-06 10:30:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '12 Beach Road, Sea Point'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '071 555 0104');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Naledi Dlamini', '072 555 0105', 'naledi.d@example.com', p.name, p.id, 'R 3 000 000 – R 4 500 000', 'Bond pre-approved', '1–3 months', 'Online listing', NULL, 'contacted', 1, 1, '2026-09-06', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-06 12:10:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '12 Beach Road, Sea Point'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '072 555 0105');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Liam O''Connor', '073 555 0106', 'liam.oconnor@example.com', p.name, p.id, 'R 4 500 000', 'Cash buyer', '3–6 months', 'Online listing, Signboard', NULL, 'scheduled', 1, 0, '2026-09-12', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-12 10:45:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '12 Beach Road, Sea Point'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '073 555 0106');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Zanele Khumalo', '060 555 0107', NULL, p.name, p.id, 'R 3 200 000 – R 3 800 000', 'Not sure yet', 'Just browsing', 'Walk-in', 'Was passing by, interested in the area', 'new', 1, 0, '2026-09-12', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-12 13:20:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '12 Beach Road, Sea Point'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '060 555 0107');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Ruan Pretorius', '061 555 0108', 'ruan.p@example.com', p.name, p.id, 'R 4 000 000 – R 5 000 000', 'Needs bond approval', '1–3 months', 'Online listing', NULL, 'new', 1, 1, '2026-09-12', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-12 14:50:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '12 Beach Road, Sea Point'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '061 555 0108');

-- Villa 7, Vineyard Estate, Constantia  (5 sign-ins)
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Fatima Jacobs', '062 555 0109', 'fatima.jacobs@example.com', p.name, p.id, 'R 9 000 000 – R 12 000 000', 'Cash buyer', '1–3 months', 'Referral', 'Referred by Annelize du Plessis', 'offer', 1, 1, '2026-09-19', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-19 10:00:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Villa 7, Vineyard Estate, Constantia'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '062 555 0109');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Sipho Ndlovu', '063 555 0110', 'sipho.n@example.com', p.name, p.id, 'R 8 000 000 – R 10 000 000', 'Bond pre-approved', '3–6 months', 'Online listing', NULL, 'contacted', 1, 0, '2026-09-19', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-19 11:25:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Villa 7, Vineyard Estate, Constantia'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '063 555 0110');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Annelize du Plessis', '066 555 0113', 'annelize.dp@example.com', p.name, p.id, 'R 10 000 000 – R 15 000 000', 'Cash buyer', 'Immediately', 'Signboard', NULL, 'scheduled', 1, 1, '2026-09-19', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-19 13:40:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Villa 7, Vineyard Estate, Constantia'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '066 555 0113');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Yusuf Adams', '067 555 0114', NULL, p.name, p.id, 'R 7 500 000', 'Not sure yet', 'Just browsing', 'Online listing', NULL, 'new', 1, 0, '2026-09-20', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-20 11:00:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Villa 7, Vineyard Estate, Constantia'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '067 555 0114');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Chantelle Williams', '068 555 0115', 'chantelle.w@example.com', p.name, p.id, 'R 8 500 000 – R 11 000 000', 'Bond pre-approved', '3–6 months', 'Walk-in', 'Found the price too high', 'lost', 1, 0, '2026-09-20', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-20 14:15:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Villa 7, Vineyard Estate, Constantia'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '068 555 0115');

-- Unit 304, Harbour Quay, V&A Waterfront  (7 sign-ins)
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Thandiwe Mokoena', '082 555 0101', 'thandiwe.mokoena@example.com', p.name, p.id, 'R 3 500 000 – R 5 000 000', 'Bond pre-approved', '1–3 months', 'Repeat client', 'Viewed the Sea Point flat on 5 Sep', 'scheduled', 1, 1, '2026-09-26', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-26 10:20:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Unit 304, Harbour Quay, V&A Waterfront'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '082 555 0101');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Pieter van der Merwe', '083 555 0102', 'pieter.vdm@example.com', p.name, p.id, 'R 4 000 000 – R 6 000 000', 'Cash buyer', 'Immediately', 'Repeat client', NULL, 'offer', 1, 0, '2026-09-26', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-26 11:50:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Unit 304, Harbour Quay, V&A Waterfront'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '083 555 0102');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Naledi Dlamini', '+27 72 555 0105', 'naledi.d@example.com', p.name, p.id, 'R 3 000 000 – R 4 500 000', 'Bond pre-approved', '1–3 months', 'Repeat client', NULL, 'scheduled', 1, 1, '2026-09-26', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-26 13:30:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Unit 304, Harbour Quay, V&A Waterfront'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '+27 72 555 0105');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Megan Fourie', '064 555 0111', 'megan.fourie@example.com', p.name, p.id, 'R 3 500 000 – R 5 500 000', 'Bond pre-approved', '1–3 months', 'Online listing', NULL, 'contacted', 1, 1, '2026-09-27', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-27 10:10:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Unit 304, Harbour Quay, V&A Waterfront'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '064 555 0111');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Kabelo Molefe', '065 555 0112', 'kabelo.m@example.com', p.name, p.id, 'R 3 000 000 – R 6 000 000', 'Needs bond approval', '3–6 months', 'Online listing, Other', 'Saw it on social media', 'new', 1, 0, '2026-09-27', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-27 11:35:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Unit 304, Harbour Quay, V&A Waterfront'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '065 555 0112');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Ethan Naidoo', '078 555 0119', 'ethan.naidoo@example.com', p.name, p.id, 'R 5 000 000 – R 7 000 000', 'Cash buyer', '1–3 months', 'Referral', 'Referred by Hendrik Steyn', 'contacted', 1, 0, '2026-09-27', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-27 13:00:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Unit 304, Harbour Quay, V&A Waterfront'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '078 555 0119');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Palesa Sithole', '079 555 0120', 'palesa.s@example.com', p.name, p.id, 'R 5 500 000', 'Bond pre-approved', 'Immediately', 'Signboard', NULL, 'new', 1, 1, '2026-09-27', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-09-27 14:30:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = 'Unit 304, Harbour Quay, V&A Waterfront'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '079 555 0120');

-- 45 Oak Avenue, Claremont  (6 sign-ins)
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Thandiwe Mokoena', '082 555 0101', 'thandiwe.mokoena@example.com', p.name, p.id, 'R 3 500 000 – R 5 000 000', 'Bond pre-approved', '1–3 months', 'Repeat client', NULL, 'offer', 1, 1, '2026-10-03', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-03 10:05:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '45 Oak Avenue, Claremont'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '082 555 0101');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Megan Fourie', '064 555 0111', 'megan.fourie@example.com', p.name, p.id, 'R 3 500 000 – R 5 500 000', 'Bond pre-approved', '1–3 months', 'Repeat client', NULL, 'scheduled', 1, 1, '2026-10-03', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-03 11:20:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '45 Oak Avenue, Claremont'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '064 555 0111');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Kabelo Molefe', '065 555 0112', 'kabelo.m@example.com', p.name, p.id, 'R 3 000 000 – R 6 000 000', 'Needs bond approval', '3–6 months', 'Repeat client', NULL, 'contacted', 1, 0, '2026-10-03', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-03 12:45:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '45 Oak Avenue, Claremont'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '065 555 0112');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Lwazi Mthembu', '069 555 0116', 'lwazi.m@example.com', p.name, p.id, 'R 2 800 000 – R 3 600 000', 'Bond pre-approved', '1–3 months', 'Online listing', NULL, 'new', 1, 1, '2026-10-04', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-04 10:40:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '45 Oak Avenue, Claremont'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '069 555 0116');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Hendrik Steyn', '074 555 0117', NULL, p.name, p.id, 'R 3 000 000 – R 4 000 000', 'Needs bond approval', '3–6 months', 'Walk-in', NULL, 'new', 1, 0, '2026-10-04', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-04 12:00:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '45 Oak Avenue, Claremont'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '074 555 0117');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Busisiwe Zulu', '076 555 0118', 'busisiwe.z@example.com', p.name, p.id, 'R 2 500 000 – R 3 200 000', 'Bond pre-approved', 'Immediately', 'Online listing', 'Evening viewing request', 'new', 1, 1, '2026-10-08', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-08 17:30:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '45 Oak Avenue, Claremont'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '076 555 0118');

-- 18 Dune Crescent, Table View  (6 sign-ins)
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Marius le Roux', '081 555 0121', 'marius.lr@example.com', p.name, p.id, 'R 1 800 000 – R 2 400 000', 'Bond pre-approved', '1–3 months', 'Signboard', NULL, 'contacted', 1, 1, '2026-10-03', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-03 14:30:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '18 Dune Crescent, Table View'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '081 555 0121');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Nomsa Cele', '082 555 0122', 'nomsa.cele@example.com', p.name, p.id, 'R 2 000 000 – R 2 800 000', 'Needs bond approval', '3–6 months', 'Online listing', NULL, 'new', 1, 1, '2026-10-04', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-04 11:15:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '18 Dune Crescent, Table View'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '082 555 0122');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Riaan Venter', '083 555 0123', NULL, p.name, p.id, 'R 2 200 000', 'Cash buyer', 'Immediately', 'Walk-in', NULL, 'scheduled', 1, 0, '2026-10-04', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-04 13:50:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '18 Dune Crescent, Table View'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '083 555 0123');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Zoë Abrahams', '084 555 0124', 'zoe.abrahams@example.com', p.name, p.id, 'R 1 900 000 – R 2 500 000', 'Not sure yet', 'Just browsing', 'Online listing, Signboard', NULL, 'new', 1, 1, '2026-10-04', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-04 15:05:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '18 Dune Crescent, Table View'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '084 555 0124');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Tshepo Mahlangu', '060 555 0125', 'tshepo.m@example.com', p.name, p.id, 'R 2 400 000 – R 3 000 000', 'Bond pre-approved', '1–3 months', 'Referral', 'Referred by Marius le Roux', 'new', 1, 1, '2026-10-08', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-08 16:45:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '18 Dune Crescent, Table View'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '060 555 0125');
INSERT INTO clients (tenant_id, name, phone, email, property, property_id, budget, financing, timeline, source, source_detail, status, consent, consent_marketing, viewing_date, created_by, created_at)
SELECT p.tenant_id, 'Caitlin Meyer', '061 555 0126', 'caitlin.meyer@example.com', p.name, p.id, 'R 1 800 000 – R 2 200 000', 'Needs bond approval', '3–6 months', 'Online listing', NULL, 'new', 1, 0, '2026-10-08', (SELECT id FROM users WHERE tenant_id = 1 AND role = 'admin' ORDER BY is_primary_admin DESC, id LIMIT 1), '2026-10-08 18:00:00'
FROM properties p
WHERE p.tenant_id = 1 AND p.name = '18 Dune Crescent, Table View'
  AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = p.tenant_id AND c.property_id = p.id AND c.phone = '061 555 0126');
