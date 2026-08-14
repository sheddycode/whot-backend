const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { createGame } = require('../game/whotEngine');

const router = express.Router();

// POST /api/requests  { toUserId, stake }
// Sends a play request to another user with a proposed stake.
// NOTE: real-money wallet is inactive for now -> wallet is forced to 'bonus'
// until real deposits/withdrawals are switched on.
router.post('/', requireAuth, async (req, res) => {
  const { toUserId, stake } = req.body;
  if (!toUserId || typeof stake !== 'number' || stake < 0) {
    return res.status(400).json({ error: 'toUserId and a valid stake are required' });
  }
  if (toUserId === req.user.id) {
    return res.status(400).json({ error: "You can't challenge yourself" });
  }

  const { data, error } = await supabaseAdmin
    .from('game_requests')
    .insert({
      from_user: req.user.id,
      to_user: toUserId,
      proposed_stake: stake,
      wallet: 'bonus', // real money disabled for now
      status: 'pending',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ request: data });
});

// GET /api/requests  -> incoming + outgoing pending requests for this user
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('game_requests')
    .select('*, from_profile:from_user(username, display_name), to_profile:to_user(username, display_name)')
    .or(`from_user.eq.${req.user.id},to_user.eq.${req.user.id}`)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ requests: data });
});

// POST /api/requests/:id/respond  { action: 'accept' | 'decline', counterStake? }
router.post('/:id/respond', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { action, counterStake } = req.body;

  const { data: reqRow, error: reqErr } = await supabaseAdmin
    .from('game_requests')
    .select('*')
    .eq('id', id)
    .single();

  if (reqErr || !reqRow) return res.status(404).json({ error: 'Request not found' });
  if (reqRow.to_user !== req.user.id) return res.status(403).json({ error: 'Not your request to respond to' });
  if (reqRow.status !== 'pending') return res.status(400).json({ error: 'Request already resolved' });

  if (action === 'decline') {
    await supabaseAdmin
      .from('game_requests')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', id);
    return res.json({ status: 'declined' });
  }

  if (action !== 'accept') {
    return res.status(400).json({ error: "action must be 'accept' or 'decline'" });
  }

  const finalStake = typeof counterStake === 'number' ? counterStake : reqRow.proposed_stake;

  // --- Check both players have enough bonus balance for the stake ---
  const { data: wallets, error: wErr } = await supabaseAdmin
    .from('wallets')
    .select('user_id, bonus_balance')
    .in('user_id', [reqRow.from_user, reqRow.to_user]);

  if (wErr) return res.status(500).json({ error: wErr.message });

  const fromWallet = wallets.find((w) => w.user_id === reqRow.from_user);
  const toWallet = wallets.find((w) => w.user_id === reqRow.to_user);

  if (finalStake > 0 && (fromWallet.bonus_balance < finalStake || toWallet.bonus_balance < finalStake)) {
    return res.status(400).json({ error: 'One or both players have insufficient balance for this stake' });
  }

  // --- Hold the stake from both players (escrow) ---
  if (finalStake > 0) {
    await supabaseAdmin.rpc('noop').catch(() => {}); // placeholder if you add a real RPC later
    await supabaseAdmin
      .from('wallets')
      .update({ bonus_balance: fromWallet.bonus_balance - finalStake })
      .eq('user_id', reqRow.from_user);
    await supabaseAdmin
      .from('wallets')
      .update({ bonus_balance: toWallet.bonus_balance - finalStake })
      .eq('user_id', reqRow.to_user);

    await supabaseAdmin.from('transactions').insert([
      { user_id: reqRow.from_user, type: 'stake_hold', amount: -finalStake, wallet: 'bonus' },
      { user_id: reqRow.to_user, type: 'stake_hold', amount: -finalStake, wallet: 'bonus' },
    ]);
  }

  // --- Create the game ---
  const state = createGame([
    { id: reqRow.from_user, name: 'Player 1' },
    { id: reqRow.to_user, name: 'Player 2' },
  ]);

  const { data: game, error: gErr } = await supabaseAdmin
    .from('games')
    .insert({
      mode: 'pvp',
      player_one: reqRow.from_user,
      player_two: reqRow.to_user,
      stake: finalStake,
      wallet: 'bonus',
      state,
      status: 'active',
      request_id: id,
    })
    .select()
    .single();

  if (gErr) return res.status(500).json({ error: gErr.message });

  await supabaseAdmin
    .from('game_requests')
    .update({ status: 'accepted', responded_at: new Date().toISOString(), game_id: game.id })
    .eq('id', id);

  res.json({ status: 'accepted', gameId: game.id });
});

module.exports = router;
