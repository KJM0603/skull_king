import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

test('AI 참가자 관리와 인간 참가자 혼합 흐름을 실제 HTTP로 검증', async t => {
  const { server, lobby } = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, token, body = {}) {
    const response = await fetch(base + '/api/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, value: await response.json() };
  }
  const host = (await call('rooms', null, { name: 'AI 선원 1' })).value;
  const code = host.state.code;
  let botId;
  await t.test('AI 추가: 준비 완료, 중복 이름 회피, 세션 미발급', async () => {
    const added = await call('bots/add', host.token);
    assert.equal(added.status, 200);
    const bot = added.value.players.find(player => player.isBot);
    assert.equal(bot.name, 'AI 선원 2');
    assert.equal(bot.ready, true);
    assert.equal(added.value.players.length, 2);
    assert.equal(lobby.sessions.size, 1);
    assert.equal(added.value.hostId, host.state.selfId);
    botId = bot.id;
  });
  const guest = (await call('join', null, { code, name: '항해사' })).value;
  await t.test('미인증 요청과 일반 참가자의 AI 관리 차단', async () => {
    for (const path of ['bots/add', 'bots/remove']) {
      assert.equal((await call(path, 'invalid', { playerId: botId })).status, 401);
      assert.equal((await call(path, guest.token, { playerId: botId })).status, 403);
    }
    assert.equal(lobby.state(host.token).players.length, 3);
  });
  await t.test('인간 및 다른 방 AI 삭제 차단', async () => {
    assert.equal((await call('bots/remove', host.token, { playerId: guest.state.selfId })).status, 400);
    assert.equal((await call('bots/remove', host.token)).status, 400);
    const other = (await call('rooms', null, { name: '다른 선장' })).value;
    const otherView = (await call('bots/add', other.token)).value;
    const otherBot = otherView.players.find(player => player.isBot);
    assert.equal((await call('bots/remove', host.token, { playerId: otherBot.id })).status, 400);
    await call('leave', other.token);
    assert.equal(lobby.rooms.has(other.state.code), false);
  });
  await t.test('AI 삭제 후 재추가 및 총 정원 8명 제한', async () => {
    const removed = await call('bots/remove', host.token, { playerId: botId });
    assert.equal(removed.status, 200);
    assert.equal(removed.value.players.some(player => player.id === botId), false);
    assert.equal((await call('bots/remove', host.token, { playerId: botId })).status, 400);
    for (let index = 0; index < 6; index++) assert.equal((await call('bots/add', host.token)).status, 200);
    const view = lobby.state(host.token);
    assert.equal(view.players.length, 8);
    assert.equal(new Set(view.players.map(player => player.name)).size, 8);
    assert.equal((await call('bots/add', host.token)).status, 400);
    assert.equal((await call('join', null, { code, name: '초과 선원' })).status, 400);
    await call('bots/remove', host.token, { playerId: view.players.find(player => player.isBot).id });
    assert.equal((await call('bots/add', host.token)).status, 200);
  });
  await t.test('AI를 건너뛰고 사람에게 방장 승계 후 관리 허용', async () => {
    await call('leave', host.token);
    const view = lobby.state(guest.token);
    assert.equal(view.hostId, guest.state.selfId);
    assert.equal((await call('bots/add', guest.token)).status, 200);
    assert.equal(lobby.state(guest.token).players.length, 8);
  });
  await t.test('마지막 사람이 나가면 AI만 남은 방 삭제', async () => {
    await call('leave', guest.token);
    assert.equal(lobby.rooms.has(code), false);
    assert.equal(lobby.sessions.size, 0);
    assert.equal((await call('join', null, { code, name: '재입장' })).status, 400);
  });
});
