import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';

test('여러 참가자의 생성·참가·준비·방장 승계·퇴장과 인증을 실제 HTTP로 검증', async t => {
  const { server } = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(path, body, token, extra = {}) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, value: await response.json() };
  }
  await t.test('정적 화면과 프로젝트 식별', async () => {
    for (const path of ['/', '/app.js', '/style.css']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200);
      assert.ok((await response.text()).length > 100);
    }
    assert.equal((await call('/api/health')).value.project, 'skull_king');
  });
  await t.test('잘못된 입력과 교차 출처 요청', async () => {
    for (const name of ['', ' '.repeat(3), '가'.repeat(21), 123]) {
      assert.equal((await call('/api/rooms', { name })).status, 400);
    }
    assert.equal((await call('/api/rooms', null)).status, 400);
    assert.equal((await call('/api/join', { name: '선원', code: 'NOPE' })).status, 400);
    assert.equal((await call('/api/rooms', { name: '외부' }, null, { Origin: 'https://other.example' })).status, 403);
    const bad = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(bad.status, 400);
    assert.equal((await call('/api/state', undefined, 'wrong')).status, 401);
    assert.equal((await call('/api/ready', { ready: true }, 'wrong')).status, 401);
  });
  const created = await call('/api/rooms', { name: '선장' });
  assert.equal(created.status, 201);
  const host = created.value;
  const code = host.state.code;
  assert.match(code, /^[A-F0-9]{6}$/);
  const guest = (await call('/api/join', { code: code.toLowerCase(), name: '항해사' })).value;
  await t.test('참가와 준비 상태 공유 및 비밀 토큰 분리', async () => {
    assert.notEqual(guest.token, host.token);
    assert.equal((await call('/api/join', { code, name: '항해사' })).status, 400);
    assert.equal((await call('/api/ready', { ready: 'yes' }, guest.token)).status, 400);
    await call('/api/ready', { ready: true }, guest.token);
    const view = (await call('/api/state', undefined, host.token)).value;
    assert.equal(view.players.length, 2);
    assert.equal(view.players.find(player => player.id === guest.state.selfId).ready, true);
    assert.equal(JSON.stringify(view).includes(guest.token), false);
    assert.equal(JSON.stringify(view).includes(host.token), false);
    const other = (await call('/api/rooms', { name: '다른 방' })).value;
    assert.equal((await call('/api/state', undefined, other.token)).value.players.length, 1);
    await call('/api/leave', {}, other.token);
  });
  const others = [];
  await t.test('8명 정원 및 정원 초과 거부', async () => {
    for (let index = 0; index < 6; index++) {
      const joined = await call('/api/join', { code, name: `선원${index}` });
      assert.equal(joined.status, 200);
      others.push(joined.value);
    }
    assert.equal((await call('/api/join', { code, name: '초과' })).status, 400);
  });
  await t.test('퇴장 시 방장 승계와 만료 인증, 빈 방 정리', async () => {
    await call('/api/leave', {}, host.token);
    const next = (await call('/api/state', undefined, guest.token)).value;
    assert.equal(next.hostId, guest.state.selfId);
    assert.equal(next.players.length, 7);
    assert.equal((await call('/api/state', undefined, host.token)).status, 401);
    for (const person of [guest, ...others]) await call('/api/leave', {}, person.token);
    assert.equal((await call('/api/join', { code, name: '다시' })).status, 400);
  });
});
