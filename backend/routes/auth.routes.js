const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAuth, signToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login  { email, password }
// NOTE: email is only unique *per tenant* in the schema, so once a second
// tenant exists, this plain "WHERE email = ?" lookup is no longer safe —
// it could match a row in the wrong tenant if the same address is reused
// across companies. At that point, add a tenant-resolution step before
// this handler (subdomain, a company code on the login form, etc.) and
// scope this query by the resolved tenant_id. Harmless today since only
// one tenant exists.
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = await db.getOne(
    'SELECT id, tenant_id, name, email, password_hash, role, is_active FROM users WHERE email = ?',
    [email.trim().toLowerCase()]
  );

  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, tenant_id: user.tenant_id, name: user.name, email: user.email, role: user.role },
  });
});

// GET /api/auth/me  — returns the logged-in user, used on app load to restore session
router.get('/me', requireAuth, async (req, res) => {
  const user = await db.getOne(
    'SELECT id, tenant_id, name, email, role, is_active FROM users WHERE id = ? AND tenant_id = ?',
    [req.user.id, req.user.tenant_id]
  );
  if (!user || !user.is_active) return res.status(401).json({ error: 'Account no longer active.' });
  res.json({ user });
});

// POST /api/auth/change-password  { currentPassword, newPassword }
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const user = await db.getOne('SELECT id, password_hash FROM users WHERE id = ? AND tenant_id = ?', [req.user.id, req.user.tenant_id]);
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

  const newHash = await bcrypt.hash(newPassword, 10);
  await db.query('UPDATE users SET password_hash = ? WHERE id = ? AND tenant_id = ?', [newHash, req.user.id, req.user.tenant_id]);
  res.json({ ok: true });
});

module.exports = router;
