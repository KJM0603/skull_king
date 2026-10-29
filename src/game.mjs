import { randomInt, randomUUID } from 'node:crypto';

export const SUITS = ['green', 'yellow', 'purple', 'black'];
export const BID_TIMEOUT_MS = 20_000;
export const PLAY_TIMEOUT_MS = 15_000;
export function createDeck() {
  const deck = SUITS.flatMap(suit => Array.from({ length: 14 }, (_, index) => ({ id: `${suit}-${index + 1}`, type: 'number', suit, value: index + 1 })));
  for (const [type, count] of [['escape', 5], ['pirate', 5], ['mermaid', 2], ['king', 1], ['tigress', 1]]) {
    for (let index = 0; index < count; index++) deck.push({ id: `${type}-${index}`, type });
  }
  return deck;
}
export function shuffledDeck() {
  const deck = createDeck();
  for (let index = deck.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [deck[index], deck[other]] = [deck[other], deck[index]];
  }
  return deck;
}
export const kind = card => card.type === 'tigress' ? card.mode : card.type;
export function leadSuit(trick) {
  const first = trick.find(play => kind(play.card) !== 'escape');
  return first?.card.type === 'number' ? first.card.suit : null;
}
export function legalCards(hand, trick) {
  const suit = leadSuit(trick);
  const mustFollow = suit && hand.some(card => card.type === 'number' && card.suit === suit);
  return hand.filter(card => !mustFollow || card.type !== 'number' || card.suit === suit);
}
export function resolveTrick(trick) {
  if (!trick.length) throw new Error('아직 제출된 카드가 없습니다.');
  const king = trick.find(play => kind(play.card) === 'king');
  const mermaids = trick.filter(play => kind(play.card) === 'mermaid');
  const pirates = trick.filter(play => kind(play.card) === 'pirate');
  let winner;
  if (king) winner = mermaids[0] ?? king;
  else if (pirates.length) winner = pirates[0];
  else if (mermaids.length) winner = mermaids[0];
  else {
    const numbers = trick.filter(play => play.card.type === 'number');
    const trumps = numbers.filter(play => play.card.suit === 'black');
    const candidates = trumps.length ? trumps : numbers.filter(play => play.card.suit === leadSuit(trick));
    winner = candidates.reduce((best, play) => !best || play.card.value > best.card.value ? play : best, null) ?? trick[0];
  }
  let bonus = trick.reduce((total, play) => total + (play.card.type === 'number' && play.card.value === 14 ? play.card.suit === 'black' ? 20 : 10 : 0), 0);
  if (kind(winner.card) === 'king') bonus += pirates.length * 30;
  if (kind(winner.card) === 'pirate') bonus += mermaids.length * 20;
  if (kind(winner.card) === 'mermaid' && king) bonus += 40;
  return { winnerId: winner.playerId, bonus };
}
export function scoreRound(bid, won, cardsDealt, bonus = 0) {
  const exact = bid === won;
  const base = bid === 0 ? (exact ? 10 : -10) * cardsDealt : exact ? bid * 20 : -10 * Math.abs(bid - won);
  return { bid, won, exact, base, bonus: exact ? bonus : 0, points: base + (exact ? bonus : 0) };
}

export function createGame(players, now = Date.now()) {
  if (players.length < 3 || players.length > 8) throw new Error('기본 모드는 AI를 포함해 3~8명으로 진행합니다.');
  const game = {
    id: randomUUID(), players: players.map(player => player.id), round: 0,
    scores: Object.fromEntries(players.map(player => [player.id, 0])), history: [],
    bidMs: BID_TIMEOUT_MS, playMs: PLAY_TIMEOUT_MS, botMs: 650, resultMs: 1800,
  };
  dealRound(game, now);
  return game;
}
export function dealRound(game, now) {
  game.round++;
  game.cardsDealt = Math.min(game.round, 10, Math.floor(70 / game.players.length));
  const deck = shuffledDeck();
  game.hands = Object.fromEntries(game.players.map(id => [id, deck.splice(0, game.cardsDealt)]));
  game.bids = {};
  game.autoBids = {};
  game.won = Object.fromEntries(game.players.map(id => [id, 0]));
  game.bonuses = Object.fromEntries(game.players.map(id => [id, 0]));
  game.phase = 'bidding';
  game.roundStarter = game.players[(game.round - 1) % game.players.length];
  game.turnId = null;
  game.trickNumber = 1;
  game.trick = [];
  game.lastTrick = null;
  game.deadlineAt = now + game.bidMs;
  game.autoAt = now + game.botMs;
}
export function bid(game, playerId, value, now, automatic = false) {
  if (game.phase !== 'bidding') throw new Error('지금은 예측 제출 단계가 아닙니다.');
  if (!game.players.includes(playerId)) throw new Error('참가자를 찾을 수 없습니다.');
  if (Object.hasOwn(game.bids, playerId)) throw new Error('이미 예측을 제출했습니다.');
  if (!Number.isInteger(value) || value < 0 || value > game.cardsDealt) throw new Error(`예측은 0~${game.cardsDealt} 사이 정수로 입력해 주세요.`);
  game.bids[playerId] = value;
  if (automatic) game.autoBids[playerId] = true;
  if (Object.keys(game.bids).length === game.players.length) {
    game.phase = 'playing';
    game.turnId = game.roundStarter;
    game.deadlineAt = now + game.playMs;
    game.autoAt = now + game.botMs;
  }
}
export function play(game, playerId, cardId, mode, now) {
  if (game.phase !== 'playing' || game.turnId !== playerId) throw new Error('지금은 본인 차례가 아닙니다.');
  const hand = game.hands[playerId];
  const card = hand.find(value => value.id === cardId);
  if (!card) throw new Error('현재 손패에 없는 카드입니다.');
  if (!legalCards(hand, game.trick).some(value => value.id === cardId)) throw new Error('먼저 나온 색의 숫자 카드 또는 특수 카드를 내 주세요.');
  if (card.type === 'tigress' && !['pirate', 'escape'].includes(mode)) throw new Error('티그리스를 해적 또는 도망으로 선택해 주세요.');
  hand.splice(hand.indexOf(card), 1);
  game.trick.push({ playerId, card: { ...card, ...(card.type === 'tigress' ? { mode } : {}) } });
  if (game.trick.length === game.players.length) {
    const result = resolveTrick(game.trick);
    game.won[result.winnerId]++;
    game.bonuses[result.winnerId] += result.bonus;
    game.lastTrick = { ...result, round: game.round, number: game.trickNumber, plays: game.trick.map(value => ({ ...value, card: { ...value.card } })) };
    game.phase = 'trick-result';
    game.turnId = null;
    game.deadlineAt = null;
    game.autoAt = now + game.resultMs;
  } else {
    game.turnId = game.players[(game.players.indexOf(playerId) + 1) % game.players.length];
    game.deadlineAt = now + game.playMs;
    game.autoAt = now + game.botMs;
  }
}
export function advanceTrick(game, now) {
  if (game.phase !== 'trick-result') throw new Error('트릭 결과를 확인하는 단계가 아닙니다.');
  if (game.trickNumber === game.cardsDealt) {
    const results = game.players.map(playerId => {
      const score = scoreRound(game.bids[playerId], game.won[playerId], game.cardsDealt, game.bonuses[playerId]);
      game.scores[playerId] += score.points;
      return { playerId, ...score, total: game.scores[playerId] };
    });
    game.history.push({ round: game.round, cardsDealt: game.cardsDealt, results });
    const highest = Math.max(...Object.values(game.scores));
    game.leaderIds = game.players.filter(id => game.scores[id] === highest);
    game.phase = game.round >= 10 && game.leaderIds.length === 1 ? 'finished' : 'round-result';
    game.deadlineAt = null;
    game.autoAt = null;
  } else {
    game.trickNumber++;
    game.trick = [];
    game.phase = 'playing';
    game.turnId = game.lastTrick.winnerId;
    game.deadlineAt = now + game.playMs;
    game.autoAt = now + game.botMs;
  }
}

// Decisions use this player's hand and public information only.
export function chooseBid(hand) {
  const strength = hand.reduce((sum, card) => sum + (card.type === 'king' ? 0.9 : card.type === 'pirate' || card.type === 'tigress' ? 0.65 : card.type === 'mermaid' ? 0.45 : card.type === 'number' && card.suit === 'black' ? card.value / 20 : card.type === 'number' && card.value >= 12 ? 0.25 : 0), 0);
  return Math.min(hand.length, Math.round(strength));
}
export function choosePlay(hand, trick, wanted) {
  const options = legalCards(hand, trick).flatMap(card => card.type === 'tigress' ? [{ ...card, mode: 'escape' }, { ...card, mode: 'pirate' }] : [card]);
  const strength = card => kind(card) === 'king' ? 100 : kind(card) === 'pirate' ? 85 : kind(card) === 'mermaid' ? 70 : kind(card) === 'escape' ? 0 : (card.suit === 'black' ? 35 : 5) + card.value;
  options.sort((left, right) => strength(left) - strength(right));
  const wins = card => resolveTrick([...trick, { playerId: 'candidate', card }]).winnerId === 'candidate';
  if (wanted) return options.find(wins) ?? options.at(-1);
  return options.find(card => !wins(card)) ?? options[0];
}

export function gameView(game, playerId) {
  const reveal = game.phase !== 'bidding';
  return {
    id: game.id, phase: game.phase, round: game.round, cardsDealt: game.cardsDealt, totalRounds: 10,
    turnId: game.turnId, trickNumber: game.trickNumber, leadSuit: leadSuit(game.trick),
    deadlineAt: game.deadlineAt, submittedCount: Object.keys(game.bids).length,
    timeLimits: { bidSeconds: game.bidMs / 1000, playSeconds: game.playMs / 1000 },
    ownBid: game.bids[playerId] ?? null, ownAutoBid: Boolean(game.autoBids[playerId]),
    hand: game.hands[playerId].map(card => ({ ...card })),
    playableCardIds: game.phase === 'playing' && game.turnId === playerId ? legalCards(game.hands[playerId], game.trick).map(card => card.id) : [],
    players: game.players.map(id => ({ id, score: game.scores[id], won: game.won[id], hasBid: Object.hasOwn(game.bids, id), bid: reveal || id === playerId ? game.bids[id] ?? null : null, cardCount: game.hands[id].length })),
    trick: game.trick.map(value => ({ ...value, card: { ...value.card } })),
    lastTrick: game.lastTrick ? structuredClone(game.lastTrick) : null,
    history: structuredClone(game.history), leaderIds: [...(game.leaderIds ?? [])],
  };
}
