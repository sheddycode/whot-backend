const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const REBUNDLE_AMOUNT = 1000000; // ₦10,000.00 in kobo
const REBUNDLE_COOLDOWN_MS = 1000 * 60 * 60 * 24; // 24h between rebundles

// GET /api/wallet
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('wallets')
    .select('*')
    .eq('user_id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ wallet: data });
});

// GET /api/wallet/transactions
router.get('/transactions', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ transactions: data });
});

// POST /api/wallet/bonus/rebundle
// Tops up the mock/demo bonus balance once it runs out, so the user can
// keep practicing / playing computer games. Rate-limited to avoid abuse.
router.post('/bonus/rebundle', requireAuth, async (req, res) => {
  const { data: wallet, error: wErr } = await supabaseAdmin
    .from('wallets')
    .select('bonus_balance')
    .eq('user_id', req.user.id)
    .single();
  if (wErr) return res.status(500).json({ error: wErr.message });

  if (wallet.bonus_balance > 0) {
    return res.status(400).json({ error: 'Bonus balance is not exhausted yet' });
  }

  const { data: lastClaim } = await supabaseAdmin
    .from('bonus_claims')
    .select('created_at')
    .eq('user_id', req.user.id)
    .eq('reason', 'rebundle')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastClaim) {
    const elapsed = Date.now() - new Date(lastClaim.created_at).getTime();
    if (elapsed < REBUNDLE_COOLDOWN_MS) {
      const hoursLeft = Math.ceil((REBUNDLE_COOLDOWN_MS - elapsed) / (1000 * 60 * 60));
      return res.status(429).json({ error: `You can rebundle again in ~${hoursLeft}h` });
    }
  }

  await supabaseAdmin
    .from('wallets')
    .update({ bonus_balance: REBUNDLE_AMOUNT })
    .eq('user_id', req.user.id);

  await supabaseAdmin.from('bonus_claims').insert({
    user_id: req.user.id,
    amount: REBUNDLE_AMOUNT,
    reason: 'rebundle',
  });

  await supabaseAdmin.from('transactions').insert({
    user_id: req.user.id,
    type: 'bonus_grant',
    amount: REBUNDLE_AMOUNT,
    wallet: 'bonus',
    reference: 'rebundle',
  });

  res.json({ bonus_balance: REBUNDLE_AMOUNT });
});

// -----------------------------------------------------------------
// REAL MONEY ENDPOINTS — INTENTIONALLY DISABLED
// These are wired up end-to-end (routes exist, tables exist, mobile
// screens exist) but return 503 until a payment processor (e.g.
// Paystack/Flutterwave) is integrated and the feature is switched on.
// Flip `REAL_MONEY_ENABLED` in .env once ready.
// -----------------------------------------------------------------
const REAL_MONEY_ENABLED = process.env.REAL_MONEY_ENABLED === 'true';

router.post('/deposit', requireAuth, async (req, res) => {
  if (!REAL_MONEY_ENABLED) {
    return res.status(503).json({
      error: 'Real-money deposits are coming soon. You are currently playing with bonus funds.',
    });
  }
  // TODO: integrate payment provider, verify webhook, credit real_balance
  res.status(501).json({ error: 'Not implemented' });
});

router.post('/withdraw', requireAuth, async (req, res) => {
  if (!REAL_MONEY_ENABLED) {
    return res.status(503).json({
      error: 'Withdrawals are coming soon. Real-money play is not active yet.',
    });
  }
  // TODO: create withdrawal_requests row, debit real_balance, trigger payout
  res.status(501).json({ error: 'Not implemented' });
});

module.exports = router;
