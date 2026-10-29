import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby, VACANT_ROOM_MS } from '../src/lobby.mjs';
import { dealRound } from '../src/game.mjs';

function setup() {
  const lobby = new Lobby();
  const host = lobby.create('선장');
  const guest = lobby.join(host.state.code, '항해사');
  lobby.ready(guest.token, true);
  lobby.start(host.token, true, 0);
  return { lobby, host, guest, room: lobby.session(host.token).room };
}

test('퇴장 후 AI 예측·카드가 실제 반영되고 같은 자리·남은 손패·점수로 복귀', () => {
  const { lobby, host, guest, room } = setup();
  const game = room.game;
  const id = host.state.selfId;
  const seats = [...game.players];
  game.scores[id] = 40;
  lobby.leave(host.token, 100);
  assert.throws(() => lobby.state(host.token), { status: 401 });
  assert.equal(room.players.find(player => player.id === id).isBot, true);
  lobby.tick(650);
  assert.ok(Object.hasOwn(game.bids, id), 'AI must actually submit the departed player’s bid');
  lobby.submitBid(guest.token, { gameId: game.id, round: game.round, bid: 0 }, 700);
  for (let step = 1; step <= 4 && game.hands[id].length; step++) {
    if (game.turnId === guest.state.selfId) {
      const card = game.hands[game.turnId][0];
      lobby.playCard(guest.token, { gameId: game.id, round: game.round, trickNumber: 1, cardId: card.id, mode: card.type === 'tigress' ? 'escape' : undefined }, 700 + step * 650);
    } else lobby.tick(700 + step * 650);
  }
  assert.equal(game.hands[id].length, 0, 'AI must actually play the departed player’s card');
  const before = structuredClone(game);
  const restored = lobby.resume(host.resumeToken, 4000);
  assert.equal(restored.state.selfId, id);
  assert.deepEqual(restored.state.game.seatOrder, seats);
  assert.deepEqual(restored.state.game.hand, before.hands[id]);
  assert.equal(restored.state.game.ownBid, before.bids[id]);
  assert.equal(restored.state.game.players.find(player => player.id === id).score, 40);
  assert.equal(restored.state.players.find(player => player.id === id).isBot, false);
  assert.equal(restored.state.hostId, guest.state.selfId, 'returning host must not displace the successor');
  assert.deepEqual(game, before, 'resuming must not rewind, redeal or extend deadlines');
  assert.equal('hands' in restored.state.game, false);
  assert.ok(restored.state.game.players.every(player => !('hand' in player)));
  // A new round gives the reclaimed seat back to its human owner.
  dealRound(game, 5000);
  lobby.tick(5650);
  assert.equal(Object.hasOwn(game.bids, id), false);
  lobby.submitBid(restored.token, { gameId: game.id, round: game.round, bid: 0 }, 5700);
  lobby.submitBid(guest.token, { gameId: game.id, round: game.round, bid: 0 }, 5700);
  for (let step = 1; game.turnId !== id && step <= 4; step++) {
    if (game.turnId === guest.state.selfId) {
      const view = lobby.state(guest.token).game;
      const card = view.hand.find(card => view.playableCardIds.includes(card.id));
      lobby.playCard(guest.token, { gameId: game.id, round: game.round, trickNumber: 1, cardId: card.id, mode: card.type === 'tigress' ? 'escape' : undefined }, 5700 + step * 650);
    } else lobby.tick(5700 + step * 650);
  }
  assert.equal(game.turnId, id);
  const view = lobby.state(restored.token).game;
  const card = view.hand.find(card => view.playableCardIds.includes(card.id));
  const played = lobby.playCard(restored.token, { gameId: game.id, round: game.round, trickNumber: game.trickNumber, cardId: card.id, mode: card.type === 'tigress' ? 'escape' : undefined }, 9000);
  assert.equal(played.game.hand.length, 1, 'human can submit again after reclaiming the two-card round');
});

test('복귀 인증은 비공개이며 이전 탭의 읽기·행동 권한을 해제, 응답 손실 재시도 가능', () => {
  const { lobby, host, guest, room } = setup();
  for (const credential of [undefined, host.token, host.state.selfId, room.code, guest.state.selfId, {}, 'invalid']) {
    assert.throws(() => lobby.resume(credential, 100), { status: 401 });
  }
  const snapshot = JSON.stringify(lobby.state(guest.token));
  for (const secret of [host.token, guest.token, host.resumeToken, guest.resumeToken]) assert.ok(!snapshot.includes(secret));
  const first = lobby.resume(host.resumeToken, 100);
  const retry = lobby.resume(host.resumeToken, 101);
  assert.equal(retry.state.selfId, host.state.selfId);
  assert.equal(lobby.sessions.size, 2);
  for (const oldToken of [host.token, first.token]) {
    assert.throws(() => lobby.state(oldToken), { status: 401 });
    assert.throws(() => lobby.submitBid(oldToken, { gameId: room.game.id, round: 1, bid: 0 }), { status: 401 });
  }
  assert.equal(retry.state.game.players.find(player => player.id === guest.state.selfId).bid, null);
});

test('마지막 사람 퇴장 후 10분 직전 복귀·방장 복구, 만료 경계 및 기록 정리', () => {
  const lobby = new Lobby();
  const host = lobby.create('혼자 연습');
  lobby.start(host.token, true, 0);
  lobby.leave(host.token, 100);
  lobby.tick(100 + VACANT_ROOM_MS - 1);
  assert.equal(lobby.rooms.size, 1);
  const resumed = lobby.resume(host.resumeToken, 100 + VACANT_ROOM_MS - 1);
  assert.equal(resumed.state.hostId, host.state.selfId);
  const room = lobby.session(resumed.token).room;
  assert.equal(room.vacantUntil, undefined);
  lobby.leave(resumed.token, 1_000_000);
  assert.throws(() => lobby.resume(host.resumeToken, 1_000_000 + VACANT_ROOM_MS), { status: 401 });
  assert.equal(lobby.rooms.size, 0);
  assert.equal(lobby.resumptions.size, 0);
  assert.equal(lobby.sessions.size, 0);
  const other = lobby.create('자동 정리');
  lobby.start(other.token, true, 0);
  lobby.leave(other.token, 0);
  lobby.tick(VACANT_ROOM_MS);
  assert.equal(lobby.rooms.size, 0);
  assert.equal(lobby.resumptions.size, 0);
});

test('다른 사람이 남으면 10분 뒤에도 복귀 가능, 결과 스킵 표는 복귀로 되살리지 않음', () => {
  const { lobby, host, room } = setup();
  room.game.phase = 'round-result';
  room.game.deadlineAt = 10_000;
  room.game.roundSkips = [host.state.selfId];
  lobby.leave(host.token, 100);
  const resumed = lobby.resume(host.resumeToken, VACANT_ROOM_MS * 2);
  assert.equal(resumed.state.game.roundAdvance.eligibleCount, 2);
  assert.equal(resumed.state.game.roundAdvance.ownSkipped, false);
  assert.equal(resumed.state.game.roundAdvance.skippedCount, 0);
});

test('대기실 퇴장·판 종료 후 자리 정리·서버 재시작은 복귀 만료', () => {
  const { lobby, host, guest, room } = setup();
  lobby.leave(guest.token, 100);
  room.game.phase = 'finished';
  lobby.returnToLobby(host.token, { gameId: room.game.id, round: room.game.round });
  assert.throws(() => lobby.resume(guest.resumeToken), { status: 401 });
  assert.equal(lobby.resumptions.size, 1);
  const resumed = lobby.resume(host.resumeToken);
  assert.equal(resumed.state.game, null);
  lobby.leave(resumed.token);
  assert.throws(() => lobby.resume(host.resumeToken), { status: 401 });
  assert.equal(lobby.resumptions.size, 0);
  assert.throws(() => new Lobby().resume(host.resumeToken), { status: 401 });
});
