const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireAuth, signToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login  { email, password }
// Now that tenants are a real, active feature (not just schema
// groundwork), the previous "email is unique per tenant, so a plain
// WHERE email = ? could match the wrong tenant" risk is live: two
// different companies' agents could genuinely share a personal email
// address. Handled here by checking the password against every matching
// row (there's normally only one) rather than assuming the first match
// is the right one — whichever row's password matches is the account
// that logs in. A deactivated tenant blocks its users from logging in
// entirely, even with the right password.
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const candidates = await db.query(
    `SELECT u.id, u.tenant_id, u.name, u.email, u.password_hash, u.role, u.is_active AS user_active,
            t.is_active AS tenant_active, t.name AS tenant_name, t.app_name, t.primary_color,
            t.brass_color, t.logo_url
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     WHERE u.email = ?`,
    [email.trim().toLowerCase()]
  );

  let user = null;
  for (const candidate of candidates) {
    if (!candidate.user_active || !candidate.tenant_active) continue;
    if (await bcrypt.compare(password, candidate.password_hash)) { user = candidate; break; }
  }

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, tenant_id: user.tenant_id, name: user.name, email: user.email, role: user.role },
    theme: {
      appName: user.app_name || user.tenant_name,
      primaryColor: user.primary_color || null,
      brassColor: user.brass_color || null,
      logoUrl: user.logo_url || null,
    },
  });
});

// GET /api/auth/me  — returns the logged-in user + their tenant's theme,
// used on app load to restore a session (and reapply branding) from a
// stored token without requiring a fresh login.
router.get('/me', requireAuth, async (req, res) => {
  const user = await db.getOne(
    `SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.is_active,
            t.name AS tenant_name, t.app_name, t.primary_color, t.brass_color, t.logo_url
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     WHERE u.id = ? AND u.tenant_id = ?`,
    [req.user.id, req.user.tenant_id]
  );
  if (!user || !user.is_active) return res.status(401).json({ error: 'Account no longer active.' });
  res.json({
    user: { id: user.id, tenant_id: user.tenant_id, name: user.name, email: user.email, role: user.role },
    theme: {
      appName: user.app_name || user.tenant_name,
      primaryColor: user.primary_color || null,
      brassColor: user.brass_color || null,
      logoUrl: user.logo_url || null,
    },
  });
});

// Password changes are admin-only in this app (see PATCH /api/users/:id in
// users.routes.js) — there is deliberately no self-service change-password
// endpoint here. An agent who needs a new password asks an admin to reset
// it from the Manage Users screen.

module.exports = router;
