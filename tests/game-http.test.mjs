import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { chooseBid, choosePlay } from '../src/game.mjs';

test('실제 HTTP: 시작 권한·비공개 예측·잘못된 제출·전체 게임·같은 방 다시 하기', async t => {
  const { server, lobby } = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, token, body) {
    const response = await fetch(base + '/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, value: await response.json() };
  }
  const host = (await call('rooms', null, { name: '선장' })).value;
  const guest = (await call('join', null, { code: host.state.code, name: '항해사' })).value;
  const room = lobby.session(host.token).room;
  assert.equal((await call('game/start', guest.token, { withBots: true })).status, 403);
  assert.equal((await call('game/start', host.token, { withBots: true })).status, 400);
  await call('ready', guest.token, { ready: true });
  const started = await call('game/start', host.token, { withBots: true });
  assert.equal(started.status, 200);
  assert.equal(started.value.phase, 'bidding');
  assert.equal(started.value.players.length, 4);
  const first = started.value.game;
  assert.deepEqual(first.timeLimits, { bidSeconds: 20, playSeconds: 15 });
  assert.equal(first.hand.length, 1);
  assert.equal('hands' in first, false);
  assert.ok(first.players.every(player => !('hand' in player)));
  const stamp = () => ({ gameId: room.game.id, round: room.game.round });
  assert.equal((await call('game/start', host.token, {})).status, 400);
  assert.equal((await call('join', null, { code: room.code, name: '늦은 참가' })).status, 400);
  assert.equal((await call('bots/add', host.token, {})).status, 400);
  assert.equal((await call('ready', guest.token, { ready: false })).status, 400);
  assert.equal((await call('game/bid', host.token, { ...stamp(), gameId: 'old', bid: 0 })).status, 400);
  assert.equal((await call('game/bid', host.token, { ...stamp(), bid: 100 })).status, 400);
  assert.equal((await call('game/bid', host.token, { ...stamp(), bid: 0 })).status, 200);
  assert.equal((await call('game/bid', host.token, { ...stamp(), bid: 1 })).status, 400);
  const privateView = (await call('state', guest.token)).value.game;
  assert.equal(privateView.players.find(player => player.id === host.state.selfId).bid, null);
  assert.equal(privateView.players.find(player => player.id === host.state.selfId).hasBid, true);
  assert.equal((await call('game/lobby', host.token, stamp())).status, 400);
  await call('game/bid', guest.token, { ...stamp(), bid: 0 });
  lobby.tick(Date.now() + 1000);
  assert.equal(room.game.phase, 'playing');
  const exposed = (await call('state', guest.token)).value.game;
  assert.equal(exposed.players.find(player => player.id === host.state.selfId).bid, 0);
  assert.equal((await call('game/play', guest.token, { ...stamp(), trickNumber: 1, cardId: privateView.hand[0].id })).status, 400);
  assert.equal((await call('game/play', host.token, { ...stamp(), trickNumber: 999, cardId: first.hand[0].id })).status, 400);
  assert.equal((await call('game/play', host.token, { ...stamp(), trickNumber: 1, cardId: 'missing' })).status, 400);

  // Accelerate only the test-owned clock, without changing server APIs or exposing fixtures.
  room.game.botMs = 0; room.game.resultMs = 0;
  room.game.bidMs = 1_000_000_000; room.game.playMs = 1_000_000_000;
  const humanTokens = new Map([[host.state.selfId, host.token], [guest.state.selfId, guest.token]]);
  let steps = 0;
  while (room.game.phase !== 'finished' && steps++ < 8000) {
    lobby.tick(Date.now() + 2000);
    const game = room.game;
    if (game.phase === 'bidding') {
      for (const [id, token] of humanTokens) {
        if (Object.hasOwn(game.bids, id)) continue;
        const view = (await call('state', token)).value.game;
        assert.equal((await call('game/bid', token, { ...stamp(), bid: chooseBid(view.hand) })).status, 200);
      }
    } else if (game.phase === 'playing' && humanTokens.has(game.turnId)) {
      const id = game.turnId;
      const token = humanTokens.get(id);
      const view = (await call('state', token)).value.game;
      const card = choosePlay(view.hand, view.trick, game.won[id] < game.bids[id]);
      assert.equal((await call('game/play', token, { ...stamp(), trickNumber: game.trickNumber, cardId: card.id, mode: card.mode })).status, 200);
    } else if (game.phase === 'round-result') {
      assert.equal((await call('game/next', guest.token, stamp())).status, 403);
      assert.equal((await call('game/next', host.token, stamp())).status, 200);
    }
  }
  assert.equal(room.game.phase, 'finished');
  assert.ok(room.game.round >= 10);
  assert.equal(room.game.leaderIds.length, 1);
  for (const round of room.game.history) assert.equal(round.results.reduce((sum, result) => sum + result.won, 0), round.cardsDealt);
  const firstGameId = room.game.id;
  assert.equal((await call('game/lobby', guest.token, stamp())).status, 403);
  const returned = (await call('game/lobby', host.token, stamp())).value;
  assert.equal(returned.code, host.state.code);
  assert.equal(returned.phase, 'lobby');
  assert.equal(returned.players.length, 4);
  assert.equal(returned.game, null);
  await call('ready', guest.token, { ready: true });
  const secondGame = (await call('game/start', host.token, {})).value.game;
  assert.notEqual(secondGame.id, firstGameId);
  assert.equal(secondGame.round, 1);
  assert.ok(secondGame.players.every(player => player.score === 0));
  assert.equal((await call('game/bid', host.token, { gameId: firstGameId, round: 1, bid: 0 })).status, 400);
});
