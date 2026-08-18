// src/middleware/auth.js
const { supabaseAdmin } = require('../config/supabase');

/**
 * Middleware to verify the Supabase access token.
 * Expects: Authorization: Bearer <token>
 */
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    // 🔍 Log the token (first 20 chars) for debugging
    console.log('🔑 Received token:', token ? token.substring(0, 20) + '...' : 'null');

    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    // Verify the token with Supabase
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error) {
      // 🔍 Log the exact error from Supabase
      console.error('❌ getUser error:', error.message);
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    if (!data?.user) {
      console.error('❌ No user found for token');
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    // Attach user to the request
    req.user = data.user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    res.status(500).json({ error: 'Auth check failed' });
  }
}

module.exports = { requireAuth };