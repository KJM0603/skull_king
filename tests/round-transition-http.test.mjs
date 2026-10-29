import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

test('실제 HTTP: 모든 사람 스킵·진행률 공유·중복·동시 요청·권한·10초 자동 전환', async t => {
  const { server, lobby } = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  const call = async (path, token, body) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, value: await res.json() };
  };
  const host = (await call('rooms', null, { name: '선장' })).value;
  const people = [host];
  for (let i = 1; i < 4; i++) {
    const guest = (await call('join', null, { code: host.state.code, name: `선원${i}` })).value;
    await call('ready', guest.token, { ready: true });
    people.push(guest);
  }
  const outsider = (await call('rooms', null, { name: '다른 방' })).value;
  const room = lobby.session(host.token).room;
  const tokens = new Map(people.map(person => [person.state.selfId, person.token]));
  await call('game/start', host.token, {});
  const stamp = () => ({ gameId: room.game.id, round: room.game.round });
  assert.equal((await call('game/skip', host.token, stamp())).status, 400);
  for (const person of people) await call('game/bid', person.token, { ...stamp(), bid: 0 });
  room.game.resultMs = 0;
  while (room.game.phase === 'playing') {
    const token = tokens.get(room.game.turnId);
    const view = (await call('state', token)).value.game;
    const card = view.hand.find(card => view.playableCardIds.includes(card.id));
    assert.equal((await call('game/play', token, { ...stamp(), trickNumber: 1, cardId: card.id, mode: 'escape' })).status, 200);
  }
  lobby.tick();
  const before = (await call('state', host.token)).value.game;
  assert.equal(before.phase, 'round-result');
  assert.equal(before.roundAdvance.eligibleCount, 4);
  assert.equal(before.roundAdvance.requiredCount, 3);
  const input = stamp();
  assert.equal((await call('game/skip', null, input)).status, 401);
  assert.equal((await call('game/skip', outsider.token, input)).status, 400);
  assert.equal((await call('game/skip', host.token, { ...input, gameId: 'old' })).status, 400);
  const voted = (await call('game/skip', people[1].token, { ...input, playerId: host.state.selfId })).value.game;
  assert.equal(voted.roundAdvance.ownSkipped, true);
  assert.equal(voted.roundAdvance.skippedCount, 1);
  assert.equal((await call('game/skip', people[1].token, input)).value.game.roundAdvance.skippedCount, 1);
  const observer = (await call('state', people[3].token)).value.game;
  assert.equal(observer.roundAdvance.ownSkipped, false);
  assert.equal(observer.roundAdvance.skippedCount, 1);
  assert.equal(observer.roundAdvance.deadlineAt, before.roundAdvance.deadlineAt);
  assert.equal((await call('game/next', host.token, input)).value.game.roundAdvance.skippedCount, 2, 'host cannot bypass quorum through legacy API');
  const simultaneous = await Promise.all([call('game/skip', people[2].token, input), call('game/skip', people[2].token, input)]);
  assert.deepEqual(simultaneous.map(res => res.status).sort(), [200, 400]);
  const after = (await call('state', people[3].token)).value.game;
  assert.equal(after.round, 2);
  assert.equal(after.phase, 'bidding');
  assert.equal(after.roundAdvance, null);
  assert.equal(after.history.length, 1);
  assert.equal(after.hand.length, 2);
  assert.equal('hands' in after, false);
  assert.ok(after.players.every(player => player.bid === null && !('hand' in player)));
  assert.equal((await call('game/skip', host.token, input)).status, 400);

  // The timeout branch uses the same live room, with no skip votes.
  const game = room.game;
  game.phase = 'round-result'; game.deadlineAt = Date.now() + 10_000;
  const end = game.deadlineAt;
  lobby.tick(end - 1);
  assert.equal((await call('state', host.token)).value.game.phase, 'round-result');
  lobby.tick(end);
  const automatic = (await call('state', host.token)).value.game;
  assert.equal(automatic.round, 3);
  assert.equal(automatic.phase, 'bidding');
  assert.equal(automatic.deadlineAt, end + 20_000);
});
