// src/routes/users.js
const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');   // ✅ ensure this path is correct

const router = express.Router();

// GET /api/users/search?q=chi
router.get('/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) {
    return res.json({ users: [] });
  }

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .ilike('username', `%${q}%`)
    .eq('is_searchable', true)
    .neq('id', req.user.id)
    .limit(20);

  if (error) {
    console.error('Search error:', error.message);
    return res.status(500).json({ error: error.message });
  }
  res.json({ users: data });
});

// GET /api/users/me
router.get('/me', requireAuth, async (req, res) => {
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  const { data: wallet, error: wErr } = await supabaseAdmin
    .from('wallets')
    .select('*')
    .eq('user_id', req.user.id)
    .single();

  if (pErr || wErr) {
    console.error('Profile/wallet error:', (pErr || wErr).message);
    return res.status(500).json({ error: (pErr || wErr).message });
  }
  res.json({ profile, wallet });
});

module.exports = router;