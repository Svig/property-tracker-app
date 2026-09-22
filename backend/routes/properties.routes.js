const express = require('express');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Admins see every property in their tenant. Agents only see properties
// they're assigned to via property_agents — this is the actual visibility
// gate, so every route below applies it consistently rather than trusting
// the frontend to hide things.
async function visibleWhereClause(req) {
  if (req.user.role === 'admin') {
    return { clause: 'p.tenant_id = ?', params: [req.user.tenant_id] };
  }
  return {
    clause: 'p.tenant_id = ? AND EXISTS (SELECT 1 FROM property_agents pa WHERE pa.property_id = p.id AND pa.user_id = ?)',
    params: [req.user.tenant_id, req.user.id],
  };
}

async function canAccessProperty(req, propertyId) {
  if (req.user.role === 'admin') {
    const p = await db.getOne('SELECT * FROM properties WHERE id = ? AND tenant_id = ?', [propertyId, req.user.tenant_id]);
    return p || null;
  }
  const p = await db.getOne(
    `SELECT p.* FROM properties p
     WHERE p.id = ? AND p.tenant_id = ?
       AND EXISTS (SELECT 1 FROM property_agents pa WHERE pa.property_id = p.id AND pa.user_id = ?)`,
    [propertyId, req.user.tenant_id, req.user.id]
  );
  return p || null;
}

// GET /api/properties — this tenant's properties, scoped by role
router.get('/', async (req, res) => {
  const { clause, params } = await visibleWhereClause(req);
  const properties = await db.query(
    `SELECT p.* FROM properties p WHERE ${clause} ORDER BY p.name ASC`,
    params
  );
  res.json({ properties });
});

// POST /api/properties  { name, address, listingUrl }
// An agent who creates a property is automatically assigned to it —
// otherwise they'd create something and immediately be unable to see it.
router.post('/', async (req, res) => {
  const { name, address, listingUrl } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Property name is required.' });

  const insertedId = await db.insert(
    'INSERT INTO properties (tenant_id, name, address, listing_url, created_by) VALUES (?, ?, ?, ?, ?)',
    [req.user.tenant_id, name.trim(), address || null, listingUrl || null, req.user.id]
  );
  if (req.user.role === 'agent') {
    await db.query(
      'INSERT INTO property_agents (tenant_id, property_id, user_id) VALUES (?, ?, ?)',
      [req.user.tenant_id, insertedId, req.user.id]
    );
  }
  const created = await db.getOne('SELECT * FROM properties WHERE id = ? AND tenant_id = ?', [insertedId, req.user.tenant_id]);
  res.status(201).json({ property: created });
});

// PATCH /api/properties/:id  { name, address, listingUrl }
router.patch('/:id', async (req, res) => {
  const existing = await canAccessProperty(req, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Property not found.' });

  const { name, address, listingUrl } = req.body || {};
  const fields = [];
  const params = [];
  if (typeof name === 'string' && name.trim()) { fields.push('name = ?'); params.push(name.trim()); }
  if ('address' in req.body) { fields.push('address = ?'); params.push(address || null); }
  if ('listingUrl' in req.body) { fields.push('listing_url = ?'); params.push(listingUrl || null); }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  params.push(req.params.id, req.user.tenant_id);
  await db.query(`UPDATE properties SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
  const updated = await db.getOne('SELECT * FROM properties WHERE id = ? AND tenant_id = ?', [req.params.id, req.user.tenant_id]);
  res.json({ property: updated });
});

// DELETE /api/properties/:id
// FK is ON DELETE SET NULL on clients/current_viewing, so this never
// deletes client history — it just detaches it from a now-gone listing.
router.delete('/:id', async (req, res) => {
  const existing = await canAccessProperty(req, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Property not found.' });
  await db.query('DELETE FROM properties WHERE id = ? AND tenant_id = ?', [req.params.id, req.user.tenant_id]);
  res.json({ ok: true });
});

// GET /api/properties/:id/visitors — who has signed in for this property
router.get('/:id/visitors', async (req, res) => {
  const property = await canAccessProperty(req, req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found.' });

  const visitors = await db.query(
    `SELECT id, name, phone, email, status, budget, financing, timeline, source, source_detail, created_at
     FROM clients WHERE tenant_id = ? AND property_id = ? ORDER BY created_at DESC`,
    [req.user.tenant_id, req.params.id]
  );
  res.json({ property, visitors });
});

// ---- Assignment management (admin only) ----

// GET /api/properties/:id/agents — assigned + assignable agent users for
// this property, for the admin's assignment picker
router.get('/:id/agents', requireAdmin, async (req, res) => {
  const property = await db.getOne('SELECT id FROM properties WHERE id = ? AND tenant_id = ?', [req.params.id, req.user.tenant_id]);
  if (!property) return res.status(404).json({ error: 'Property not found.' });

  const assigned = await db.query(
    `SELECT u.id, u.name, u.email FROM property_agents pa
     JOIN users u ON u.id = pa.user_id
     WHERE pa.property_id = ? AND pa.tenant_id = ?
     ORDER BY u.name ASC`,
    [req.params.id, req.user.tenant_id]
  );
  const assignedIds = assigned.map(a => a.id);
  const allAgents = await db.query(
    `SELECT id, name, email FROM users WHERE tenant_id = ? AND role = 'agent' AND is_active = true ORDER BY name ASC`,
    [req.user.tenant_id]
  );
  const available = allAgents.filter(a => !assignedIds.includes(a.id));

  res.json({ assigned, available });
});

// POST /api/properties/:id/agents  { userId } — assign an agent
router.post('/:id/agents', requireAdmin, async (req, res) => {
  const { userId } = req.body || {};
  const property = await db.getOne('SELECT id FROM properties WHERE id = ? AND tenant_id = ?', [req.params.id, req.user.tenant_id]);
  if (!property) return res.status(404).json({ error: 'Property not found.' });
  const agent = await db.getOne("SELECT id FROM users WHERE id = ? AND tenant_id = ? AND role = 'agent'", [userId, req.user.tenant_id]);
  if (!agent) return res.status(404).json({ error: 'Agent not found.' });

  const existing = await db.getOne('SELECT id FROM property_agents WHERE property_id = ? AND user_id = ?', [req.params.id, userId]);
  if (!existing) {
    await db.query(
      'INSERT INTO property_agents (tenant_id, property_id, user_id) VALUES (?, ?, ?)',
      [req.user.tenant_id, req.params.id, userId]
    );
  }
  res.status(201).json({ ok: true });
});

// DELETE /api/properties/:id/agents/:userId — unassign an agent
router.delete('/:id/agents/:userId', requireAdmin, async (req, res) => {
  await db.query(
    'DELETE FROM property_agents WHERE tenant_id = ? AND property_id = ? AND user_id = ?',
    [req.user.tenant_id, req.params.id, req.params.userId]
  );
  res.json({ ok: true });
});

module.exports = router;
