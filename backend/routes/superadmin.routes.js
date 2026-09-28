const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { requireSuperAdmin, signSuperAdminToken, signToken } = require('../middleware/auth');

const router = express.Router();

// ================= AUTH =================

// POST /api/superadmin/auth/login
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const admin = await db.getOne(
    'SELECT id, name, email, password_hash, is_active FROM super_admins WHERE email = ?',
    [email.trim().toLowerCase()]
  );
  if (!admin || !admin.is_active) return res.status(401).json({ error: 'Invalid email or password.' });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

  const token = signSuperAdminToken(admin);
  res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
});

router.get('/auth/me', requireSuperAdmin, async (req, res) => {
  const admin = await db.getOne(
    'SELECT id, name, email, is_active FROM super_admins WHERE id = ?',
    [req.superAdmin.id]
  );
  if (!admin || !admin.is_active) return res.status(401).json({ error: 'Account no longer active.' });
  res.json({ admin });
});

router.post('/auth/change-password', requireSuperAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const admin = await db.getOne('SELECT id, password_hash FROM super_admins WHERE id = ?', [req.superAdmin.id]);
  const valid = await bcrypt.compare(currentPassword, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

  const newHash = await bcrypt.hash(newPassword, 10);
  await db.query('UPDATE super_admins SET password_hash = ? WHERE id = ?', [newHash, req.superAdmin.id]);
  res.json({ ok: true });
});

// Everything below requires a super admin session.
router.use(requireSuperAdmin);

// ================= TENANTS =================

const TENANT_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
    (SELECT COUNT(*) FROM clients c WHERE c.tenant_id = t.id) AS client_count
  FROM tenants t
`;

// GET /api/superadmin/tenants — every tenant on the platform
router.get('/tenants', async (req, res) => {
  const tenants = await db.query(`${TENANT_SELECT} ORDER BY t.created_at ASC`);
  res.json({ tenants });
});

// POST /api/superadmin/tenants — create a tenant AND its first (primary) admin
// { name, slug, appName, primaryColor, brassColor, logoUrl, allowedEmailDomain,
//   subscriptionTier, adminName, adminEmail, adminPassword }
router.post('/tenants', async (req, res) => {
  const {
    name, slug, appName, primaryColor, brassColor, logoUrl, allowedEmailDomain, subscriptionTier,
    adminName, adminEmail, adminPassword,
  } = req.body || {};

  if (!name || !name.trim() || !slug || !slug.trim()) {
    return res.status(400).json({ error: 'Tenant name and slug are required.' });
  }
  if (!/^[a-z0-9-]+$/.test(slug.trim())) {
    return res.status(400).json({ error: 'Slug can only contain lowercase letters, numbers, and hyphens.' });
  }
  if (!adminName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'A name, email, and password for the tenant\u2019s first admin are required.' });
  }
  if (adminPassword.length < 8) {
    return res.status(400).json({ error: 'The admin password must be at least 8 characters.' });
  }

  const slugClash = await db.getOne('SELECT id FROM tenants WHERE slug = ?', [slug.trim().toLowerCase()]);
  if (slugClash) return res.status(409).json({ error: 'That slug is already in use by another tenant.' });

  try {
    const result = await db.transaction(async (tx) => {
      const tenantId = await (async () => {
        // db.insert() isn't transaction-aware (it uses the shared pool), so
        // the tenant insert + id lookup happens directly on the transaction
        // client here instead.
        await tx.query(
          `INSERT INTO tenants (name, slug, app_name, primary_color, brass_color, logo_url, allowed_email_domain, subscription_tier)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            name.trim(), slug.trim().toLowerCase(), appName || null, primaryColor || null,
            brassColor || null, logoUrl || null, allowedEmailDomain || null, subscriptionTier || 'free',
          ]
        );
        const row = await tx.getOne('SELECT id FROM tenants WHERE slug = ?', [slug.trim().toLowerCase()]);
        return row.id;
      })();

      const hash = await bcrypt.hash(adminPassword, 10);
      await tx.query(
        'INSERT INTO users (tenant_id, name, email, password_hash, role, is_primary_admin) VALUES (?, ?, ?, ?, ?, ?)',
        [tenantId, adminName.trim(), adminEmail.trim().toLowerCase(), hash, 'admin', true]
      );

      return tenantId;
    });

    const tenant = await db.getOne(`${TENANT_SELECT} WHERE t.id = ?`, [result]);
    res.status(201).json({ tenant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create the tenant. Check the admin email isn\u2019t already used oddly, and try again.' });
  }
});

// PATCH /api/superadmin/tenants/:id — update theming, name, slug, tier, active status
router.patch('/tenants/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name, slug, appName, primaryColor, brassColor, logoUrl,
    allowedEmailDomain, subscriptionTier, isActive,
  } = req.body || {};

  if (slug) {
    if (!/^[a-z0-9-]+$/.test(slug.trim())) {
      return res.status(400).json({ error: 'Slug can only contain lowercase letters, numbers, and hyphens.' });
    }
    const clash = await db.getOne('SELECT id FROM tenants WHERE slug = ? AND id != ?', [slug.trim().toLowerCase(), id]);
    if (clash) return res.status(409).json({ error: 'That slug is already in use by another tenant.' });
  }

  const fields = [];
  const params = [];
  const set = (col, val) => { fields.push(`${col} = ?`); params.push(val); };
  if (typeof name === 'string' && name.trim()) set('name', name.trim());
  if (typeof slug === 'string' && slug.trim()) set('slug', slug.trim().toLowerCase());
  if ('appName' in req.body) set('app_name', appName || null);
  if ('primaryColor' in req.body) set('primary_color', primaryColor || null);
  if ('brassColor' in req.body) set('brass_color', brassColor || null);
  if ('logoUrl' in req.body) set('logo_url', logoUrl || null);
  if ('allowedEmailDomain' in req.body) set('allowed_email_domain', allowedEmailDomain || null);
  if ('subscriptionTier' in req.body) set('subscription_tier', subscriptionTier || 'free');
  if (typeof isActive === 'boolean') set('is_active', isActive);
  if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  params.push(id);
  await db.query(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`, params);
  const tenant = await db.getOne(`${TENANT_SELECT} WHERE t.id = ?`, [id]);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
  res.json({ tenant });
});

// DELETE /api/superadmin/tenants/:id — deletes the tenant and, via existing
// ON DELETE CASCADE foreign keys, every user/client/property/note that
// belongs to it. Irreversible; the frontend should make this very clear.
router.delete('/tenants/:id', async (req, res) => {
  const tenant = await db.getOne('SELECT id FROM tenants WHERE id = ?', [req.params.id]);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
  await db.query('DELETE FROM tenants WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// POST /api/superadmin/tenants/:id/impersonate — "switch to tenant": issues
// an ordinary tenant-scoped JWT, as that tenant's primary admin, so the
// super admin can view/operate inside the tenant app using all the
// existing tenant-scoped routes unchanged. The action is attributed to
// the primary admin in the tenant's own data (there's no separate
// "acting as" identity in tenant-scoped tables) — the frontend labels
// this clearly so it's never mistaken for a real independent login.
router.post('/tenants/:id/impersonate', async (req, res) => {
  const tenant = await db.getOne('SELECT id, name FROM tenants WHERE id = ?', [req.params.id]);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });

  const primaryAdmin = await db.getOne(
    'SELECT id, tenant_id, name, email, role FROM users WHERE tenant_id = ? AND is_primary_admin = ?',
    [req.params.id, true]
  );
  if (!primaryAdmin) {
    return res.status(409).json({ error: 'This tenant has no primary admin to switch into \u2014 this shouldn\u2019t normally happen.' });
  }

  const token = signToken(primaryAdmin);
  res.json({ token, user: { id: primaryAdmin.id, tenant_id: primaryAdmin.tenant_id, name: primaryAdmin.name, email: primaryAdmin.email, role: primaryAdmin.role }, tenantName: tenant.name });
});

module.exports = router;
