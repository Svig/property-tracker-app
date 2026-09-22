const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Every route below requires a logged-in admin, and every query is
// scoped to req.user.tenant_id so one tenant's admin can never see or
// touch another tenant's logins.
router.use(requireAuth, requireAdmin);

const USER_COLUMNS = 'id, name, email, email_verified, mobile, mobile_verified, role, is_active, is_super_admin, created_at';

// GET /api/users — list all logins for this tenant (admin only)
router.get('/', async (req, res) => {
  const users = await db.query(
    `SELECT ${USER_COLUMNS} FROM users WHERE tenant_id = ? ORDER BY created_at ASC`,
    [req.user.tenant_id]
  );
  res.json({ users });
});

// POST /api/users — create a new login in this tenant (admin only)
// { name, email, mobile, password, role: 'admin' | 'agent' }
router.post('/', async (req, res) => {
  const { name, email, mobile, password, role } = req.body || {};
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
    'INSERT INTO users (tenant_id, name, email, mobile, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.tenant_id, name.trim(), email.trim().toLowerCase(), mobile || null, hash, finalRole]
  );
  res.status(201).json({ id: insertedId, name, email, mobile: mobile || null, role: finalRole });
});

// PATCH /api/users/:id — update profile info, role, active status, or reset a password
// (admin only, same tenant only). The tenant's super admin (is_super_admin=true) can
// never be demoted or deactivated by ANYONE, including other admins — not just by
// themselves — so a tenant can never end up with no way back into admin access.
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, mobile, role, is_active, password } = req.body || {};

  const target = await db.getOne(
    'SELECT id, is_super_admin FROM users WHERE id = ? AND tenant_id = ?',
    [id, req.user.tenant_id]
  );
  if (!target) return res.status(404).json({ error: 'User not found.' });

  if (target.is_super_admin && (role === 'agent' || is_active === false)) {
    return res.status(400).json({ error: 'The super admin account can\u2019t be demoted or deactivated.' });
  }
  if (Number(id) === req.user.id && (role === 'agent' || is_active === false)) {
    return res.status(400).json({ error: "You can't demote or deactivate your own account." });
  }
  if (password && password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (email) {
    const clash = await db.getOne(
      'SELECT id FROM users WHERE tenant_id = ? AND email = ? AND id != ?',
      [req.user.tenant_id, email.trim().toLowerCase(), id]
    );
    if (clash) return res.status(409).json({ error: 'Another user already has that email address.' });
  }

  const fields = [];
  const params = [];
  if (typeof name === 'string' && name.trim()) { fields.push('name = ?'); params.push(name.trim()); }
  if (typeof email === 'string' && email.trim()) {
    fields.push('email = ?'); params.push(email.trim().toLowerCase());
    fields.push('email_verified = ?'); params.push(false); // changing the address means it needs re-verifying, once that flow exists
  }
  if ('mobile' in req.body) {
    fields.push('mobile = ?'); params.push(mobile || null);
    fields.push('mobile_verified = ?'); params.push(false);
  }
  if (role === 'admin' || role === 'agent') { fields.push('role = ?'); params.push(role); }
  if (typeof is_active === 'boolean') { fields.push('is_active = ?'); params.push(is_active); }
  if (password) { fields.push('password_hash = ?'); params.push(await bcrypt.hash(password, 10)); }
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  params.push(id, req.user.tenant_id);
  await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
  const updated = await db.getOne(`SELECT ${USER_COLUMNS} FROM users WHERE id = ? AND tenant_id = ?`, [id, req.user.tenant_id]);
  res.json({ user: updated });
});

// DELETE /api/users/:id — remove a login (admin only; can't delete yourself, the
// tenant's super admin, or the last admin; scoped so you can only ever act on your
// own tenant's users)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account while logged in as it." });
  }
  const target = await db.getOne(
    'SELECT role, is_super_admin FROM users WHERE id = ? AND tenant_id = ?',
    [id, req.user.tenant_id]
  );
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.is_super_admin) {
    return res.status(400).json({ error: 'The super admin account can\u2019t be deleted.' });
  }
  const admins = await db.query(
    "SELECT id FROM users WHERE tenant_id = ? AND role = 'admin'",
    [req.user.tenant_id]
  );
  if (target.role === 'admin' && admins.length <= 1) {
    return res.status(400).json({ error: 'At least one admin account must remain.' });
  }
  await db.query('DELETE FROM users WHERE id = ? AND tenant_id = ?', [id, req.user.tenant_id]);
  res.json({ ok: true });
});

module.exports = router;
