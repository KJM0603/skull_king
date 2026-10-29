import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, leadSuit, legalCards, resolveTrick, scoreRound, createGame as createRandomGame, bid, play, advanceTrick, dealRound, gameView, chooseBid, choosePlay, BID_TIMEOUT_MS, PLAY_TIMEOUT_MS } from '../src/game.mjs';
import { Lobby } from '../src/lobby.mjs';

// Existing rule fixtures use stable seating; production seating is tested separately.
const createGame = (players, now) => createRandomGame(players, now, size => size - 1);
const num = (suit, value) => ({ id: `${suit}-${value}`, type: 'number', suit, value });
const special = (type, mode) => ({ id: type, type, ...(mode ? { mode } : {}) });
const trick = (...cards) => cards.map((card, index) => ({ playerId: `p${index}`, card }));

test('기본 덱은 70장의 고유 카드이며 8명 후반은 8장 배분', () => {
  const deck = createDeck();
  assert.equal(deck.length, 70);
  assert.equal(new Set(deck.map(card => card.id)).size, 70);
  assert.equal(deck.filter(card => card.type === 'mermaid').length, 2);
  const game = createGame(Array.from({ length: 8 }, (_, index) => ({ id: `p${index}` })), 0);
  for (let index = 0; index < 9; index++) dealRound(game, 0);
  assert.equal(game.round, 10);
  assert.equal(game.cardsDealt, 8);
  assert.equal(new Set(Object.values(game.hands).flat().map(card => card.id)).size, 64);
});

test('숫자/검정/색 따르기와 특수 카드 선행 규칙', () => {
  const hand = [num('green', 2), num('black', 14), num('yellow', 8), special('pirate')];
  assert.deepEqual(legalCards(hand, trick(num('green', 5))).map(card => card.id), ['green-2', 'pirate']);
  assert.deepEqual(legalCards(hand, trick(num('black', 1))).map(card => card.id), ['black-14', 'pirate']);
  assert.equal(legalCards(hand, trick(num('purple', 1))).length, 4);
  assert.equal(leadSuit(trick(special('escape'), num('green', 5), special('pirate'))), 'green');
  assert.equal(leadSuit(trick(special('escape'), special('pirate'), num('green', 5))), null);
  assert.equal(legalCards(hand, trick(special('pirate'), num('green', 5))).length, 4);
  assert.equal(resolveTrick(trick(num('green', 12), num('purple', 14), num('green', 2))).winnerId, 'p0');
  assert.equal(resolveTrick(trick(num('green', 14), num('black', 1))).winnerId, 'p1');
});

test('해적·인어·스컬킹 순환과 선착 특수 카드 및 티그리스', () => {
  for (const [cards, winner] of [
    [[special('pirate'), special('mermaid')], 'p0'],
    [[special('mermaid'), special('king')], 'p0'],
    [[special('king'), special('pirate')], 'p0'],
    [[special('king'), special('pirate'), special('mermaid')], 'p2'],
    [[special('mermaid'), special('pirate'), special('king')], 'p0'],
    [[special('pirate'), special('pirate')], 'p0'],
    [[special('mermaid'), special('mermaid')], 'p0'],
    [[special('escape'), special('tigress', 'escape'), special('escape')], 'p0'],
    [[special('tigress', 'pirate'), special('pirate')], 'p0'],
    [[special('tigress', 'escape'), num('green', 1)], 'p1'],
  ]) assert.equal(resolveTrick(trick(...cards)).winnerId, winner);
});

test('보너스는 순서와 무관하고 예측 실패 시 소멸', () => {
  assert.equal(resolveTrick(trick(special('king'), special('pirate'), num('black', 14))).bonus, 50);
  assert.equal(resolveTrick(trick(special('pirate'), special('mermaid'), special('mermaid'))).bonus, 40);
  assert.equal(resolveTrick(trick(special('pirate'), special('king'), special('mermaid'), num('yellow', 14))).bonus, 50);
  assert.equal(resolveTrick(trick(special('king'), special('tigress', 'escape'))).bonus, 0);
  assert.equal(resolveTrick(trick(special('king'), special('tigress', 'pirate'))).bonus, 30);
  assert.deepEqual(scoreRound(3, 3, 6, 40), { bid: 3, won: 3, exact: true, base: 60, bonus: 40, points: 100 });
  assert.equal(scoreRound(3, 1, 6, 40).points, -20);
  assert.equal(scoreRound(0, 0, 8).points, 80);
  assert.equal(scoreRound(0, 2, 8).points, -80);
});

test('잘못된 카드/색/모드/중복 제출은 손패를 바꾸지 않고 재시도 허용', () => {
  const game = createGame([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 0);
  game.cardsDealt = 2;
  game.hands = { a: [num('green', 7), special('escape')], b: [num('green', 2), num('black', 14)], c: [special('tigress'), num('yellow', 1)] };
  bid(game, 'a', 1, 0);
  assert.throws(() => bid(game, 'a', 0, 0));
  assert.equal(gameView(game, 'b').players.find(player => player.id === 'a').bid, null);
  bid(game, 'b', 0, 0); bid(game, 'c', 1, 0);
  assert.throws(() => play(game, 'b', 'green-2', null, 0));
  assert.throws(() => play(game, 'a', 'missing', null, 0));
  play(game, 'a', 'green-7', null, 0);
  assert.throws(() => play(game, 'b', 'black-14', null, 0));
  assert.equal(game.hands.b.length, 2);
  play(game, 'b', 'green-2', null, 0);
  assert.throws(() => play(game, 'c', 'tigress', null, 0));
  assert.equal(game.hands.c.length, 2);
  play(game, 'c', 'tigress', 'pirate', 0);
  assert.equal(game.lastTrick.winnerId, 'c');
  advanceTrick(game, 2000);
  assert.equal(game.turnId, 'c');
});

test('1인 AI 바로 시작, 타임아웃 자동 진행, 이탈 대체와 사람 방장 승계', () => {
  const lobby = new Lobby();
  const host = lobby.create('선장');
  assert.throws(() => lobby.start(host.token));
  const view = lobby.start(host.token, true, 0);
  assert.equal(view.players.length, 4);
  const game = lobby.session(host.token).room.game;
  lobby.tick(46_000);
  assert.equal(game.phase, 'playing');
  assert.equal(game.autoBids[host.state.selfId], true);
  for (let index = 0; index < game.players.length; index++) lobby.tick(92_000 + index * 46_000);
  assert.equal(game.hands[host.state.selfId].length, 0);
  lobby.leave(host.token);
  assert.equal(lobby.rooms.size, 0);

  const captain = lobby.create('새 선장');
  lobby.addBot(captain.token);
  const guest = lobby.join(captain.state.code, '항해사');
  assert.throws(() => lobby.start(captain.token));
  lobby.ready(guest.token, true);
  lobby.start(captain.token, false, 0);
  lobby.leave(captain.token);
  assert.equal(lobby.state(guest.token).hostId, guest.state.selfId);
  assert.equal(lobby.state(guest.token).players.find(player => player.id === captain.state.selfId).isBot, true);
  assert.throws(() => lobby.addBot(guest.token));
  lobby.leave(guest.token);
  assert.equal(lobby.sessions.size, 0);
});

test('실제 셔플과 AI 전략으로 전체 게임 종료 및 라운드 합계 검증', () => {
  const players = Array.from({ length: 4 }, (_, index) => ({ id: `p${index}` }));
  const game = createGame(players, 0);
  let now = 0;
  let steps = 0;
  while (game.phase !== 'finished' && steps++ < 10000) {
    now += 100;
    if (game.phase === 'bidding') for (const id of game.players) bid(game, id, chooseBid(game.hands[id]), now);
    else if (game.phase === 'playing') {
      const id = game.turnId;
      const chosen = choosePlay(game.hands[id], game.trick, game.won[id] < game.bids[id]);
      play(game, id, chosen.id, chosen.mode, now);
    } else if (game.phase === 'trick-result') advanceTrick(game, now);
    else if (game.phase === 'round-result') dealRound(game, now);
  }
  assert.equal(game.phase, 'finished');
  assert.ok(game.round >= 10);
  for (const id of game.players) assert.equal(game.scores[id], game.history.reduce((sum, round) => sum + round.results.find(result => result.playerId === id).points, 0));
  for (const round of game.history) assert.equal(round.results.reduce((sum, result) => sum + result.won, 0), round.cardsDealt);
});

test('10라운드 공동 1위는 연장하며 단독 1위에서 종료', () => {
  const game = createGame([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 0);
  game.round = 10; game.cardsDealt = 1; game.trickNumber = 1; game.phase = 'trick-result';
  game.bids = { a: 0, b: 0, c: 0 }; game.won = { a: 0, b: 0, c: 1 };
  advanceTrick(game, 0);
  assert.equal(game.phase, 'round-result');
  assert.deepEqual(game.leaderIds, ['a', 'b']);
  dealRound(game, 0);
  assert.equal(game.round, 11);
  assert.equal(game.cardsDealt, 10);
});

test('예측 20초와 카드 15초의 경계에서만 자동 제출', () => {
  assert.equal(BID_TIMEOUT_MS, 20_000);
  assert.equal(PLAY_TIMEOUT_MS, 15_000);
  const lobby = new Lobby();
  const host = lobby.create('시간 검증');
  const view = lobby.start(host.token, true, 1000);
  assert.equal(view.game.deadlineAt, 21_000);
  assert.deepEqual(view.game.timeLimits, { bidSeconds: 20, playSeconds: 15 });
  const game = lobby.session(host.token).room.game;
  game.roundStarter = host.state.selfId; // Isolate the human timeout boundary from random seating.
  lobby.tick(20_999);
  assert.equal(game.phase, 'bidding');
  assert.equal(Object.hasOwn(game.bids, host.state.selfId), false);
  lobby.tick(21_000);
  assert.equal(game.phase, 'playing');
  assert.equal(game.autoBids[host.state.selfId], true);
  assert.equal(game.deadlineAt, 36_000);
  lobby.tick(35_999);
  assert.equal(game.hands[host.state.selfId].length, 1);
  lobby.tick(36_000);
  assert.equal(game.hands[host.state.selfId].length, 0);
  assert.equal(game.deadlineAt, 51_000);
});

test('각 참가자의 새 차례와 다음 트릭은 15초, 새 라운드 예측은 20초', () => {
  const game = createGame([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 0);
  game.cardsDealt = 2;
  game.hands = { a: [num('green', 1), num('green', 2)], b: [num('green', 3), num('green', 4)], c: [num('green', 5), num('green', 6)] };
  bid(game, 'a', 0, 1000); bid(game, 'b', 0, 1000); bid(game, 'c', 0, 1000);
  assert.equal(game.deadlineAt, 16_000);
  play(game, 'a', 'green-1', null, 2000);
  assert.equal(game.deadlineAt, 17_000);
  play(game, 'b', 'green-3', null, 3000);
  assert.equal(game.deadlineAt, 18_000);
  play(game, 'c', 'green-5', null, 4000);
  assert.equal(game.deadlineAt, null);
  advanceTrick(game, 5800);
  assert.equal(game.turnId, 'c');
  assert.equal(game.deadlineAt, 20_800);
  play(game, 'c', 'green-6', null, 6000);
  play(game, 'a', 'green-2', null, 7000);
  play(game, 'b', 'green-4', null, 8000);
  advanceTrick(game, 9800);
  assert.equal(game.phase, 'round-result');
  dealRound(game, 10_000);
  assert.equal(game.deadlineAt, 30_000);
});

test('서버 좌석 셔플은 시작 때 한 번, 모든 참가자와 라운드에 동일한 시계 방향', () => {
  const players = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const game = createRandomGame(players, 0, () => 0);
  assert.deepEqual(game.players, ['b', 'c', 'd', 'a']);
  assert.deepEqual(players.map(player => player.id), ['a', 'b', 'c', 'd'], 'lobby order is untouched');
  for (const { id } of players) {
    const view = gameView(game, id);
    assert.deepEqual(view.seatOrder, game.players);
    assert.equal(view.direction, 'clockwise');
    view.seatOrder.reverse();
    assert.deepEqual(game.players, ['b', 'c', 'd', 'a'], 'view cannot mutate server seats');
  }
  for (const id of game.players) bid(game, id, 0, 0);
  assert.equal(game.turnId, 'b');
  for (const id of ['b', 'c', 'd', 'a']) {
    assert.equal(game.turnId, id);
    const card = game.hands[id][0];
    play(game, id, card.id, 'escape', 0);
  }
  advanceTrick(game, 0);
  dealRound(game, 0);
  assert.deepEqual(game.players, ['b', 'c', 'd', 'a']);
  assert.equal(game.roundStarter, 'c');
  const production = createRandomGame(players, 0);
  assert.deepEqual([...production.players].sort(), ['a', 'b', 'c', 'd']);
});
