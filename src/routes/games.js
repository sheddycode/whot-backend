const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const engine = require('../game/whotEngine');

const router = express.Router();

async function loadGame(id) {
  const { data, error } = await supabaseAdmin.from('games').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

async function saveGame(id, state, extra = {}) {
  const { error } = await supabaseAdmin
    .from('games')
    .update({ state, updated_at: new Date().toISOString(), ...extra })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

/** Pays out the stake pot to the winner and releases escrow. Bonus wallet only, for now. */
async function settleGame(gameRow, state) {
  if (gameRow.status === 'finished') return; // already settled
  if (state.status !== 'finished') return;

  const winnerId = state.winnerId;
  const pot = gameRow.stake * 2;

  if (pot > 0 && winnerId) {
    const { data: wallet } = await supabaseAdmin
      .from('wallets')
      .select('bonus_balance')
      .eq('user_id', winnerId)
      .single();

    await supabaseAdmin
      .from('wallets')
      .update({ bonus_balance: wallet.bonus_balance + pot })
      .eq('user_id', winnerId);

    await supabaseAdmin.from('transactions').insert({
      user_id: winnerId,
      type: 'stake_win',
      amount: pot,
      wallet: 'bonus',
      game_id: gameRow.id,
    });
  }

  await supabaseAdmin
    .from('games')
    .update({ status: 'finished', winner_id: winnerId, finished_at: new Date().toISOString() })
    .eq('id', gameRow.id);
}

// POST /api/games/vs-computer  -> start an instant mock game
router.post('/vs-computer', requireAuth, async (req, res) => {
  const state = engine.createGame([
    { id: req.user.id, name: 'You' },
    { id: 'computer', name: 'Computer', isComputer: true },
  ]);

  const { data: game, error } = await supabaseAdmin
    .from('games')
    .insert({
      mode: 'vs_computer',
      player_one: req.user.id,
      player_two: null,
      stake: 0,
      wallet: 'bonus',
      state,
      status: 'active',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ gameId: game.id, state: engine.toClientView(state, req.user.id) });
});

// GET /api/games/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const game = await loadGame(req.params.id);
    if (![game.player_one, game.player_two].includes(req.user.id)) {
      return res.status(403).json({ error: 'Not your game' });
    }
    res.json({ game: { ...game, state: engine.toClientView(game.state, req.user.id) } });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// POST /api/games/:id/play  { cardId, calledShape? }
router.post('/:id/play', requireAuth, async (req, res) => {
  const { cardId, calledShape } = req.body;
  try {
    const game = await loadGame(req.params.id);
    if (![game.player_one, game.player_two].includes(req.user.id)) {
      return res.status(403).json({ error: 'Not your game' });
    }
    if (game.status !== 'active') return res.status(400).json({ error: 'Game already finished' });

    let state = game.state;
    state = engine.playCard(state, req.user.id, cardId, calledShape);

    // If it's a vs-computer game and it's now the computer's turn, auto-play immediately.
    if (game.mode === 'vs_computer' && state.status === 'active') {
      while (state.status === 'active' && engine.currentPlayer(state).id === 'computer') {
        state = engine.computerMove(state, 'computer');
      }
    }

    await saveGame(game.id, state);
    await settleGame(game, state);

    res.json({ state: engine.toClientView(state, req.user.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/games/:id/draw
router.post('/:id/draw', requireAuth, async (req, res) => {
  try {
    const game = await loadGame(req.params.id);
    if (![game.player_one, game.player_two].includes(req.user.id)) {
      return res.status(403).json({ error: 'Not your game' });
    }
    if (game.status !== 'active') return res.status(400).json({ error: 'Game already finished' });

    let state = game.state;
    state = engine.drawCard(state, req.user.id);

    if (game.mode === 'vs_computer' && state.status === 'active') {
      while (state.status === 'active' && engine.currentPlayer(state).id === 'computer') {
        state = engine.computerMove(state, 'computer');
      }
    }

    await saveGame(game.id, state);
    await settleGame(game, state);

    res.json({ state: engine.toClientView(state, req.user.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
