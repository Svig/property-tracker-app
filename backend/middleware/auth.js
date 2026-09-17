const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set in .env — set one before running in production.');
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const headerToken = header.startsWith('Bearer ') ? header.slice(7) : null;
  const token = headerToken || req.query.token || null; // query token only used for plain-link downloads (CSV export)
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET || 'dev-secret-change-me');
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

function signToken(user) {
  return jwt.sign(
    { id: user.id, tenant_id: user.tenant_id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET || 'dev-secret-change-me',
    { expiresIn: '12h' }
  );
}

module.exports = { requireAuth, requireAdmin, signToken };
