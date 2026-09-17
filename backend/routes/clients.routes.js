const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth); // any logged-in user (admin or agent) can use these

// GET /api/clients — list this tenant's clients, newest first, with notes attached
router.get('/', async (req, res) => {
  const clients = await db.query(
    'SELECT * FROM clients WHERE tenant_id = ? ORDER BY created_at DESC',
    [req.user.tenant_id]
  );
  const notes = await db.query(
    'SELECT * FROM client_notes WHERE tenant_id = ? ORDER BY created_at ASC',
    [req.user.tenant_id]
  );
  const notesByClient = {};
  for (const n of notes) {
    (notesByClient[n.client_id] = notesByClient[n.client_id] || []).push(n);
  }
  const shaped = clients.map(c => ({ ...c, notes: notesByClient[c.id] || [] }));
  res.json({ clients: shaped });
});

// POST /api/clients — used by the sign-in form (any logged-in session, e.g. the tablet)
router.post('/', async (req, res) => {
  const {
    name, phone, email, property, budget, financing, timeline, source,
    consent, consentMarketing, viewingDate,
  } = req.body || {};

  if (!name || !name.trim() || !phone || !phone.trim() || !consent) {
    return res.status(400).json({ error: 'Name, phone, and consent are required.' });
  }

  const insertedId = await db.insert(
    `INSERT INTO clients
      (tenant_id, name, phone, email, property, budget, financing, timeline, source, consent, consent_marketing, viewing_date, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      req.user.tenant_id, name.trim(), phone.trim(), email || null, property || null, budget || null,
      financing || null, timeline || null, source || null,
      !!consent, !!consentMarketing, viewingDate || null, req.user.id,
    ]
  );
  const created = await db.getOne(
    'SELECT * FROM clients WHERE id = ? AND tenant_id = ?',
    [insertedId, req.user.tenant_id]
  );
  res.status(201).json({ client: { ...created, notes: [] } });
});

// PATCH /api/clients/:id — update status or any captured field (this tenant only)
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const allowed = ['name','phone','email','property','budget','financing','timeline','source','status','consent','consent_marketing'];
  const fields = [];
  const params = [];
  for (const key of allowed) {
    if (key in req.body) { fields.push(`${key} = ?`); params.push(req.body[key]); }
  }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update.' });
  params.push(id, req.user.tenant_id);
  await db.query(`UPDATE clients SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
  const updated = await db.getOne('SELECT * FROM clients WHERE id = ? AND tenant_id = ?', [id, req.user.tenant_id]);
  if (!updated) return res.status(404).json({ error: 'Client not found.' });
  res.json({ client: updated });
});

// DELETE /api/clients/:id (this tenant only)
router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM clients WHERE id = ? AND tenant_id = ?', [req.params.id, req.user.tenant_id]);
  res.json({ ok: true });
});

// POST /api/clients/:id/notes  { text }  (this tenant only)
router.post('/:id/notes', async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'Note text is required.' });

  // confirm the client actually belongs to this tenant before attaching a note to it
  const client = await db.getOne('SELECT id FROM clients WHERE id = ? AND tenant_id = ?', [req.params.id, req.user.tenant_id]);
  if (!client) return res.status(404).json({ error: 'Client not found.' });

  await db.query(
    'INSERT INTO client_notes (tenant_id, client_id, note, created_by) VALUES (?, ?, ?, ?)',
    [req.user.tenant_id, req.params.id, text.trim(), req.user.id]
  );
  const notes = await db.query(
    'SELECT * FROM client_notes WHERE client_id = ? AND tenant_id = ? ORDER BY created_at ASC',
    [req.params.id, req.user.tenant_id]
  );
  res.status(201).json({ notes });
});

// GET /api/clients/export/csv — download this tenant's register as CSV
router.get('/export/csv', async (req, res) => {
  const clients = await db.query(
    'SELECT * FROM clients WHERE tenant_id = ? ORDER BY created_at DESC',
    [req.user.tenant_id]
  );
  const headers = [
    'id','name','phone','email','property','budget','financing','timeline',
    'source','status','consent','consent_marketing','viewing_date','created_at',
  ];
  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const rows = clients.map(c => headers.map(h => escape(c[h])).join(','));
  const csv = [headers.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="clients-export-${Date.now()}.csv"`);
  res.send(csv);
});

module.exports = router;
