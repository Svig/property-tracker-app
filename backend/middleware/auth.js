const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set in .env — set one before running in production.');
}

// Two completely separate auth realms share this one secret, distinguished
// by a `type` claim: ordinary tokens (tenant users, no `type` field) and
// super-admin tokens (`type: 'super_admin'`, no tenant_id/role at all —
// a super admin isn't a member of any tenant). Each realm's middleware
// explicitly rejects the other's tokens, so a super-admin token can never
// be used against a tenant route (which would otherwise run tenant-scoped
// queries with an undefined tenant_id) and a tenant token can never reach
// the platform-admin routes.

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const headerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = headerToken || req.query.token || null; // query token only used for plain-link downloads (CSV export)
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET || 'dev-secret-change-me');
    if (payload.type === 'super_admin') {
      return res.status(403).json({ error: 'Super admin tokens can\u2019t be used on tenant routes.' });
    }
    req.user = payload; // { id, tenant_id, name, email, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET || 'dev-secret-change-me');
    if (payload.type !== 'super_admin') {
      return res.status(403).json({ error: 'Super admin access required.' });
    }
    req.superAdmin = payload; // { type, id, name, email }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, tenant_id: user.tenant_id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET || 'dev-secret-change-me',
    { expiresIn: '12h' }
  );
}

function signSuperAdminToken(admin) {
  return jwt.sign(
    { type: 'super_admin', id: admin.id, name: admin.name, email: admin.email },
    JWT_SECRET || 'dev-secret-change-me',
    { expiresIn: '12h' }
  );
}

module.exports = { requireAuth, requireAdmin, requireSuperAdmin, signToken, signSuperAdminToken };
