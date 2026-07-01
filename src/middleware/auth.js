// src/middleware/auth.js
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== (process.env.ADMIN_KEY || 'warc-admin-2024')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireAdmin };
