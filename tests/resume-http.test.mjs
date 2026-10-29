import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

test('실제 HTTP: 두 참가자 퇴장·AI 대체·본인 자리 복귀·만료·인증·비공개 정보', async t => {
  const { server, lobby } = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, token, body, extra = {}) {
    const response = await fetch(base + '/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, value: await response.json() };
  }
  const host = (await call('rooms', null, { name: '선장' })).value;
  const guest = (await call('join', null, { code: host.state.code, name: '항해사' })).value;
  await call('ready', guest.token, { ready: true });
  await call('game/start', host.token, { withBots: true });
  assert.equal((await call('resume', null, { resumeToken: host.resumeToken }, { Origin: 'https://other.example' })).status, 403);
  for (const input of [{}, { resumeToken: host.token }, { code: host.state.code, playerId: host.state.selfId }, { resumeToken: [] }]) {
    assert.equal((await call('resume', guest.token, input)).status, 401);
  }
  await call('leave', host.token, {});
  assert.equal((await call('state', host.token)).status, 401);
  const guestView = (await call('state', guest.token)).value;
  assert.equal(guestView.players.find(player => player.id === host.state.selfId).isBot, true);
  for (const secret of [host.resumeToken, guest.resumeToken, host.token]) assert.ok(!JSON.stringify(guestView).includes(secret));
  const room = lobby.session(guest.token).room;
  // Pause only AI scheduling in this test-owned room while testing private bidding.
  room.game.autoAt = Date.now() + 60_000;
  const result = await call('resume', null, { resumeToken: host.resumeToken });
  assert.equal(result.status, 200);
  const restored = result.value;
  assert.equal(restored.state.selfId, host.state.selfId);
  assert.equal(restored.state.players.length, 4);
  assert.equal(restored.state.players.find(player => player.id === host.state.selfId).isBot, false);
  assert.deepEqual(restored.state.game.hand, room.game.hands[host.state.selfId]);
  assert.equal('hands' in restored.state.game, false);
  assert.ok(restored.state.game.players.every(player => !('hand' in player)));
  const stamp = { gameId: room.game.id, round: room.game.round };
  assert.equal((await call('game/bid', restored.token, { ...stamp, bid: 0 })).status, 200);
  assert.equal((await call('state', guest.token)).value.game.players.find(player => player.id === host.state.selfId).bid, null);
  assert.equal((await call('game/bid', host.token, { ...stamp, bid: 0 })).status, 401);
  assert.equal((await call('join', null, { code: room.code, name: '늦은 참가자' })).status, 400);
  await call('leave', restored.token, {});
  await call('leave', guest.token, {});
  assert.ok(room.vacantUntil > Date.now());
  const lastBack = (await call('resume', null, { resumeToken: guest.resumeToken })).value;
  assert.equal(lastBack.state.selfId, guest.state.selfId);
  assert.equal(lastBack.state.hostId, guest.state.selfId);
  await call('leave', lastBack.token, {});
  room.vacantUntil = Date.now() - 1;
  assert.equal((await call('resume', null, { resumeToken: host.resumeToken })).status, 401);
  assert.equal(lobby.rooms.size, 0);
  assert.equal(lobby.resumptions.size, 0);
});
