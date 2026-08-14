/**
 * Whot Card Game Engine
 * ---------------------
 * Pure, dependency-free game logic so it can be used on the server
 * (authoritative state for real / staked games) and copied verbatim
 * into the mobile app (instant, offline "vs Computer" games).
 *
 * Shapes: circle, triangle, cross, square, star, whot
 * Standard 54-card Whot deck distribution:
 *   Circle:   1,2,3,4,5,7,8,10,11,12,13,14        (13 cards... see below)
 *   Triangle: 1,2,3,4,5,7,8,10,11,12,13,14
 *   Cross:    1,2,3,5,7,10,11,13,14
 *   Square:   1,2,3,5,7,10,11,13,14
 *   Star:     1,2,3,4,5,7,8
 *   Whot:     20 (x5, wild card)
 *
 * Special card rules:
 *   1  -> Hold On: same player goes again
 *   2  -> Pick Two: next player draws 2 and is skipped
 *   5  -> Pick Three: next player draws 3 and is skipped
 *   8  -> Suspension: next player is skipped
 *   14 -> General Market: every OTHER player draws 1 card
 *   20 -> Whot (wild): caller names the next required shape
 */

const SHAPES = ['circle', 'triangle', 'cross', 'square', 'star'];

function buildDeck() {
  const deck = [];
  let id = 0;

  const add = (shape, numbers) => {
    numbers.forEach((n) => deck.push({ id: `c${id++}`, shape, number: n }));
  };

  add('circle', [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]);
  add('triangle', [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]);
  add('cross', [1, 2, 3, 5, 7, 10, 11, 13, 14]);
  add('square', [1, 2, 3, 5, 7, 10, 11, 13, 14]);
  add('star', [1, 2, 3, 4, 5, 7, 8]);

  for (let i = 0; i < 5; i++) {
    deck.push({ id: `c${id++}`, shape: 'whot', number: 20 });
  }

  return deck;
}

function shuffle(deck, rng = Math.random) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Creates a fresh game state for N players (2+).
 * players: array of { id, name, isComputer? }
 */
function createGame(players, opts = {}) {
  if (!players || players.length < 2) {
    throw new Error('Whot requires at least 2 players');
  }

  const rng = opts.rng || Math.random;
  let deck = shuffle(buildDeck(), rng);

  const hands = {};
  players.forEach((p) => {
    hands[p.id] = deck.splice(0, 6);
  });

  // First card on the pile can't be a special/wild card
  let startIndex = deck.findIndex(
    (c) => ![1, 2, 5, 8, 14, 20].includes(c.number)
  );
  if (startIndex === -1) startIndex = 0;
  const [startCard] = deck.splice(startIndex, 1);

  return {
    id: opts.id || null,
    players: players.map((p) => ({ id: p.id, name: p.name, isComputer: !!p.isComputer })),
    hands,
    market: deck,
    pile: [startCard],
    currentShape: startCard.shape,
    currentNumber: startCard.number,
    turnIndex: 0,
    direction: 1,
    pendingDraw: 0, // accumulated pick-two/pick-three penalty
    status: 'active', // active | finished
    winnerId: null,
    lastAction: null,
    createdAt: opts.createdAt || new Date().toISOString(),
  };
}

function currentPlayer(state) {
  return state.players[state.turnIndex];
}

function topCard(state) {
  return state.pile[state.pile.length - 1];
}

function canPlay(state, card) {
  if (card.shape === 'whot') return true;
  return card.shape === state.currentShape || card.number === state.currentNumber;
}

function legalMoves(state, playerId) {
  const hand = state.hands[playerId] || [];
  return hand.filter((c) => canPlay(state, c));
}

function reshuffleMarketIfNeeded(state) {
  if (state.market.length === 0) {
    const top = state.pile.pop();
    state.market = shuffle(state.pile);
    state.pile = [top];
  }
}

function drawCards(state, playerId, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    reshuffleMarketIfNeeded(state);
    if (state.market.length === 0) break; // no cards left anywhere
    drawn.push(state.market.shift());
  }
  state.hands[playerId].push(...drawn);
  return drawn;
}

function advanceTurn(state, steps = 1) {
  const n = state.players.length;
  state.turnIndex = (state.turnIndex + steps * state.direction + n) % n;
}

/**
 * Applies a "play card" move.
 * calledShape is required when playing a Whot (20) card.
 */
function playCard(state, playerId, cardId, calledShape) {
  if (state.status !== 'active') throw new Error('Game is not active');
  if (currentPlayer(state).id !== playerId) throw new Error('Not your turn');

  const hand = state.hands[playerId];
  const cardIndex = hand.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) throw new Error('Card not in hand');
  const card = hand[cardIndex];

  if (!canPlay(state, card)) throw new Error('Illegal move: card does not match');

  // Remove from hand, place on pile
  hand.splice(cardIndex, 1);
  state.pile.push(card);

  if (card.shape === 'whot') {
    if (!SHAPES.includes(calledShape)) {
      throw new Error('Must call a valid shape when playing Whot (20)');
    }
    state.currentShape = calledShape;
    state.currentNumber = null; // number irrelevant, only shape matters until next non-whot
  } else {
    state.currentShape = card.shape;
    state.currentNumber = card.number;
  }

  state.lastAction = { type: 'play', playerId, card, calledShape: calledShape || null };

  // Win check
  if (hand.length === 0) {
    state.status = 'finished';
    state.winnerId = playerId;
    return state;
  }

  // Apply special effects
  switch (card.number) {
    case 1: // Hold On - same player plays again
      // turnIndex unchanged
      break;
    case 2: { // Pick Two
      advanceTurn(state, 1);
      const victim = currentPlayer(state).id;
      drawCards(state, victim, 2);
      advanceTurn(state, 1);
      break;
    }
    case 5: { // Pick Three
      advanceTurn(state, 1);
      const victim = currentPlayer(state).id;
      drawCards(state, victim, 3);
      advanceTurn(state, 1);
      break;
    }
    case 8: // Suspension - skip next player
      advanceTurn(state, 2);
      break;
    case 14: { // General Market - everyone else draws 1
      state.players.forEach((p) => {
        if (p.id !== playerId) drawCards(state, p.id, 1);
      });
      advanceTurn(state, 1);
      break;
    }
    case 20: // Whot - caller goes again (common house rule) then next player must match called shape
      advanceTurn(state, 1);
      break;
    default:
      advanceTurn(state, 1);
  }

  return state;
}

/**
 * Applies a "draw from market" move (player has no legal move, or chooses to draw).
 */
function drawCard(state, playerId) {
  if (state.status !== 'active') throw new Error('Game is not active');
  if (currentPlayer(state).id !== playerId) throw new Error('Not your turn');

  const drawn = drawCards(state, playerId, 1);
  state.lastAction = { type: 'draw', playerId, count: drawn.length };
  advanceTurn(state, 1);
  return state;
}

/**
 * Simple computer AI: play the first legal move (preferring to save
 * Whot cards for later), otherwise draw. When forced to call a shape,
 * picks the shape it holds the most of.
 */
function computerMove(state, playerId) {
  const moves = legalMoves(state, playerId).sort((a, b) => {
    if (a.shape === 'whot') return 1;
    if (b.shape === 'whot') return -1;
    return 0;
  });

  if (moves.length === 0) {
    return drawCard(state, playerId);
  }

  const chosen = moves[0];
  let calledShape;
  if (chosen.shape === 'whot') {
    const hand = state.hands[playerId];
    const counts = {};
    hand.forEach((c) => {
      if (c.shape !== 'whot') counts[c.shape] = (counts[c.shape] || 0) + 1;
    });
    calledShape = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || SHAPES[0];
  }
  return playCard(state, playerId, chosen.id, calledShape);
}

/** Returns a version of state safe to send to a specific player (hides opponents' hands). */
function toClientView(state, forPlayerId) {
  return {
    id: state.id,
    youId: forPlayerId,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      isComputer: p.isComputer,
      cardCount: state.hands[p.id].length,
    })),
    myHand: state.hands[forPlayerId] || [],
    topCard: topCard(state),
    currentShape: state.currentShape,
    currentNumber: state.currentNumber,
    marketCount: state.market.length,
    turnPlayerId: currentPlayer(state).id,
    status: state.status,
    winnerId: state.winnerId,
    lastAction: state.lastAction,
  };
}

module.exports = {
  SHAPES,
  buildDeck,
  shuffle,
  createGame,
  currentPlayer,
  topCard,
  canPlay,
  legalMoves,
  playCard,
  drawCard,
  computerMove,
  toClientView,
};
