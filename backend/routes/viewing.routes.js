const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/viewing/current — this tenant's current property + recents
router.get('/current', async (req, res) => {
  const current = await db.getOne(
    'SELECT property FROM current_viewing WHERE tenant_id = ?',
    [req.user.tenant_id]
  );
  const recent = await db.query(
    'SELECT property FROM recent_properties WHERE tenant_id = ? ORDER BY used_at DESC LIMIT 8',
    [req.user.tenant_id]
  );
  res.json({ property: current?.property || '', recent: recent.map(r => r.property) });
});

// POST /api/viewing/current  { property }
router.post('/current', async (req, res) => {
  const { property } = req.body || {};
  if (typeof property !== 'string' || !property.trim()) {
    return res.status(400).json({ error: 'Property name is required.' });
  }
  const trimmed = property.trim();
  const tenantId = req.user.tenant_id;

  // upsert: one row per tenant
  const existing = await db.getOne('SELECT tenant_id FROM current_viewing WHERE tenant_id = ?', [tenantId]);
  if (existing) {
    await db.query(
      'UPDATE current_viewing SET property = ?, updated_by = ? WHERE tenant_id = ?',
      [trimmed, req.user.id, tenantId]
    );
  } else {
    await db.query(
      'INSERT INTO current_viewing (tenant_id, property, updated_by) VALUES (?, ?, ?)',
      [tenantId, trimmed, req.user.id]
    );
  }

  // de-dupe against recents, then push to the front (scoped to this tenant)
  await db.query('DELETE FROM recent_properties WHERE tenant_id = ? AND property = ?', [tenantId, trimmed]);
  await db.query('INSERT INTO recent_properties (tenant_id, property) VALUES (?, ?)', [tenantId, trimmed]);
  const rows = await db.query('SELECT id FROM recent_properties WHERE tenant_id = ? ORDER BY used_at DESC', [tenantId]);
  const stale = rows.slice(8).map(r => r.id);
  if (stale.length) {
    await db.query(`DELETE FROM recent_properties WHERE id IN (${stale.map(() => '?').join(',')})`, stale);
  }

  res.json({ ok: true, property: trimmed });
});

module.exports = router;
