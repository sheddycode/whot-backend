const { supabaseAdmin } = require('../config/supabase');

/**
 * Expects: Authorization: Bearer <supabase access token>
 * The mobile app gets this token from supabase.auth.getSession() after login.
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    req.user = data.user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

module.exports = { requireAuth };
