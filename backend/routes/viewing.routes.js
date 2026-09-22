const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// An agent may only point their current viewing at a property they're
// assigned to; admins can use any property in their tenant. Same check
// used when quick-creating a brand new property by name (which
// auto-assigns the creator, so this still holds immediately after).
async function canAccessProperty(req, propertyId) {
  if (req.user.role === 'admin') {
    return db.getOne('SELECT * FROM properties WHERE id = ? AND tenant_id = ?', [propertyId, req.user.tenant_id]);
  }
  return db.getOne(
    `SELECT p.* FROM properties p
     WHERE p.id = ? AND p.tenant_id = ?
       AND EXISTS (SELECT 1 FROM property_agents pa WHERE pa.property_id = p.id AND pa.user_id = ?)`,
    [propertyId, req.user.tenant_id, req.user.id]
  );
}

// GET /api/viewing/current — this USER's current property (with listing
// link, if any) + their recently-used properties
router.get('/current', async (req, res) => {
  const current = await db.getOne(
    `SELECT cv.property, cv.property_id, p.listing_url AS listing_url, p.address AS address
     FROM current_viewing cv
     LEFT JOIN properties p ON p.id = cv.property_id
     WHERE cv.user_id = ?`,
    [req.user.id]
  );
  const recent = await db.query(
    `SELECT p.id, p.name, p.listing_url
     FROM recent_properties rp
     JOIN properties p ON p.id = rp.property_id
     WHERE rp.user_id = ?
     ORDER BY rp.used_at DESC LIMIT 8`,
    [req.user.id]
  );
  res.json({
    property: current?.property || '',
    propertyId: current?.property_id || null,
    listingUrl: current?.listing_url || null,
    recent,
  });
});

// POST /api/viewing/current  { propertyId } OR { propertyName }
// propertyId picks an existing property this user can access. propertyName
// quick-creates one (reusing an exact-name match if it already exists in
// this tenant) and, for an agent, auto-assigns them to it.
router.post('/current', async (req, res) => {
  const { propertyId, propertyName } = req.body || {};
  const tenantId = req.user.tenant_id;
  const userId = req.user.id;

  let finalPropertyId = propertyId || null;
  let finalName = null;

  if (finalPropertyId) {
    const prop = await canAccessProperty(req, finalPropertyId);
    if (!prop) return res.status(404).json({ error: 'Property not found.' });
    finalName = prop.name;
  } else if (typeof propertyName === 'string' && propertyName.trim()) {
    const trimmed = propertyName.trim();
    const existing = await db.getOne('SELECT * FROM properties WHERE tenant_id = ? AND name = ?', [tenantId, trimmed]);
    if (existing) {
      const accessible = await canAccessProperty(req, existing.id);
      if (!accessible) return res.status(403).json({ error: 'That property exists but you are not assigned to it. Ask an admin to assign you.' });
      finalPropertyId = existing.id;
      finalName = existing.name;
    } else {
      finalPropertyId = await db.insert(
        'INSERT INTO properties (tenant_id, name, created_by) VALUES (?, ?, ?)',
        [tenantId, trimmed, userId]
      );
      finalName = trimmed;
      if (req.user.role === 'agent') {
        await db.query('INSERT INTO property_agents (tenant_id, property_id, user_id) VALUES (?, ?, ?)', [tenantId, finalPropertyId, userId]);
      }
    }
  } else {
    return res.status(400).json({ error: 'propertyId or propertyName is required.' });
  }

  const existingViewing = await db.getOne('SELECT user_id FROM current_viewing WHERE user_id = ?', [userId]);
  if (existingViewing) {
    await db.query(
      'UPDATE current_viewing SET property = ?, property_id = ? WHERE user_id = ?',
      [finalName, finalPropertyId, userId]
    );
  } else {
    await db.query(
      'INSERT INTO current_viewing (user_id, tenant_id, property, property_id) VALUES (?, ?, ?, ?)',
      [userId, tenantId, finalName, finalPropertyId]
    );
  }

  // de-dupe against this user's recents, then push to the front
  await db.query('DELETE FROM recent_properties WHERE user_id = ? AND property_id = ?', [userId, finalPropertyId]);
  await db.query('INSERT INTO recent_properties (tenant_id, user_id, property_id) VALUES (?, ?, ?)', [tenantId, userId, finalPropertyId]);
  const rows = await db.query('SELECT id FROM recent_properties WHERE user_id = ? ORDER BY used_at DESC', [userId]);
  const stale = rows.slice(8).map(r => r.id);
  if (stale.length) {
    await db.query(`DELETE FROM recent_properties WHERE id IN (${stale.map(() => '?').join(',')})`, stale);
  }

  res.json({ ok: true, property: finalName, propertyId: finalPropertyId });
});

module.exports = router;
