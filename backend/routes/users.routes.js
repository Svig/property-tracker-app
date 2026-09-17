const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Every route below requires a logged-in admin, and every query is
// scoped to req.user.tenant_id so one tenant's admin can never see or
// touch another tenant's logins.
router.use(requireAuth, requireAdmin);

// GET /api/users — list all logins for this tenant (admin only)
router.get('/', async (req, res) => {
  const users = await db.query(
    'SELECT id, name, email, role, is_active, created_at FROM users WHERE tenant_id = ? ORDER BY created_at ASC',
    [req.user.tenant_id]
  );
  res.json({ users });
});

// POST /api/users — create a new login in this tenant (admin only)
// { name, email, password, role: 'admin' | 'agent' }
router.post('/', async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const finalRole = role === 'admin' ? 'admin' : 'agent';

  const existing = await db.getOne(
    'SELECT id FROM users WHERE tenant_id = ? AND email = ?',
    [req.user.tenant_id, email.trim().toLowerCase()]
  );
  if (existing) return res.status(409).json({ error: 'A user with that email already exists.' });

  const hash = await bcrypt.hash(password, 10);
  const insertedId = await db.insert(
    'INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
    [req.user.tenant_id, name.trim(), email.trim().toLowerCase(), hash, finalRole]
  );
  res.status(201).json({ id: insertedId, name, email, role: finalRole });
});

// PATCH /api/users/:id — update role or active status (admin only, same tenant only)
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { role, is_active } = req.body || {};

  if (Number(id) === req.user.id && (role === 'agent' || is_active === false)) {
    return res.status(400).json({ error: "You can't demote or deactivate your own account." });
  }

  const fields = [];
  const params = [];
  if (role === 'admin' || role === 'agent') { fields.push('role = ?'); params.push(role); }
  if (typeof is_active === 'boolean') { fields.push('is_active = ?'); params.push(is_active); }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  params.push(id, req.user.tenant_id);
  await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
  res.json({ ok: true });
});

// DELETE /api/users/:id — remove a login (admin only, can't delete yourself or the last
// admin in the tenant; scoped so you can only ever act on your own tenant's users)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account while logged in as it." });
  }
  const admins = await db.query(
    "SELECT id FROM users WHERE tenant_id = ? AND role = 'admin'",
    [req.user.tenant_id]
  );
  const target = await db.getOne(
    'SELECT role FROM users WHERE id = ? AND tenant_id = ?',
    [id, req.user.tenant_id]
  );
  if (target && target.role === 'admin' && admins.length <= 1) {
    return res.status(400).json({ error: 'At least one admin account must remain.' });
  }
  await db.query('DELETE FROM users WHERE id = ? AND tenant_id = ?', [id, req.user.tenant_id]);
  res.json({ ok: true });
});

module.exports = router;
