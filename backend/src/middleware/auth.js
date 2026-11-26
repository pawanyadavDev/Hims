import jwt from 'jsonwebtoken';

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function authenticate(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET); // { id, hospitalId, role, name }
    next();
  } catch {
    res.status(401).json({ error: 'Please sign in again.' });
  }
}

// RBAC: allow only the listed roles (hospital_admin and super_admin are not implicit).
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have access to this action.' });

// Tenant routes need a hospital; super_admin has none.
export function requireTenant(req, res, next) {
  if (!req.user.hospitalId) return res.status(400).json({ error: 'This action needs a hospital account.' });
  next();
}
