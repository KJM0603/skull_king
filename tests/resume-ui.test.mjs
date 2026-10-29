import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import[^\n]+\n/, '');
const resumeKey = 'skull-king-resume';
function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function boot(local, session = storage()) {
  const nodes = new Map();
  class Element {
    dataset = {}; hidden = false; disabled = false; value = ''; textContent = ''; children = []; listeners = {};
    addEventListener(type, handler) { this.listeners[type] = handler; }
    append(...items) { items.forEach(item => { item.parent = this; this.children.push(item); }); }
    replaceChildren() { this.children = []; }
    remove() { this.parent.children = this.parent.children.filter(item => item !== this); }
    setAttribute() {}
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const requests = [];
  const responses = [];
  const renders = [];
  runInNewContext(source, {
    document: { getElementById: get, querySelectorAll: () => [...nodes.values()], createElement: () => new Element() },
    sessionStorage: session, localStorage: local, location: { href: 'http://localhost/' },
    URL, AbortSignal, setTimeout() {}, configureGameUI() {}, syncGameControls() {}, renderGame: value => renders.push(value),
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body ?? '{}') });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error('Unexpected test request');
      return { ok: response.status < 400, status: response.status, json: async () => response.body };
    },
  });
  return { get, requests, responses, renders, session, click: id => get(id).listeners.click() };
}
const saved = { resumeToken: 'test-only-recovery', code: 'ABC123', name: '선장' };
function entry() {
  return { token: 'test-only-session', resumeToken: saved.resumeToken, state: {
    selfId: 'me', hostId: 'me', code: saved.code, capacity: 8,
    players: [{ id: 'me', name: saved.name, ready: true, isBot: false }], game: { phase: 'playing', hand: [{ id: 'card1' }] },
  } };
}

test('복귀 UI: 새 탭의 저장 정보 복원, 통신 실패·중복 방지·재시도·퇴장 후 복귀', async () => {
  const local = storage({ [resumeKey]: JSON.stringify(saved) });
  const ui = boot(local);
  assert.equal(ui.get('resume-panel').hidden, false);
  assert.match(ui.get('resume-help').textContent, /선장.*ABC123/);
  ui.responses.push(new Error('연결 오류'));
  const failed = ui.click('resume-seat');
  assert.equal(ui.get('resume-seat').disabled, true);
  await ui.click('resume-seat');
  await failed;
  assert.equal(ui.get('resume-seat').disabled, false);
  assert.equal(ui.requests.length, 1, 'busy handler must reject a second click');
  assert.match(ui.get('message').textContent, /연결 오류/);
  assert.equal(JSON.parse(local.getItem(resumeKey)).resumeToken, saved.resumeToken);
  ui.responses.push({ status: 200, body: entry() });
  await ui.click('resume-seat');
  assert.equal(ui.get('entry').hidden, true);
  assert.equal(ui.renders.at(-1).selfId, 'me');
  assert.equal(ui.session.getItem('skull-king-session'), 'test-only-session');
  assert.deepEqual(ui.requests.at(-1), { url: '/api/resume', body: { resumeToken: saved.resumeToken } });
  ui.responses.push({ status: 200, body: { ok: true } });
  await ui.click('leave');
  assert.equal(ui.session.getItem('skull-king-session'), null);
  assert.equal(ui.get('resume-panel').hidden, false);
  assert.match(ui.get('message').textContent, /AI가 자리를 이어받았습니다/);
  assert.equal(JSON.parse(local.getItem(resumeKey)).resumeToken, saved.resumeToken);
  const reopened = boot(local);
  assert.equal(reopened.get('resume-panel').hidden, false, 'closing a tab must not lose recovery');
});

test('복귀 UI: 만료 시 안내와 저장 정보 정리, 잘못된 저장 데이터는 무시', async () => {
  const local = storage({ [resumeKey]: JSON.stringify(saved) });
  const ui = boot(local);
  ui.responses.push({ status: 401, body: { error: '복귀할 자리가 만료되었습니다.' } });
  await ui.click('resume-seat');
  assert.equal(ui.get('resume-panel').hidden, true);
  assert.equal(local.getItem(resumeKey), null);
  assert.match(ui.get('message').textContent, /만료/);
  for (const invalid of ['{', 'null', '{}', JSON.stringify({ resumeToken: 123, code: 'ABC123', name: '선장' })]) {
    assert.equal(boot(storage({ [resumeKey]: invalid })).get('resume-panel').hidden, true);
  }
});

test('복귀 UI: 일반 참가 후 저장, 대기실 퇴장은 복귀 정보 삭제', async () => {
  const local = storage();
  const ui = boot(local);
  const response = entry();
  response.state.game = null;
  ui.responses.push({ status: 201, body: response });
  ui.get('name').value = saved.name;
  await ui.click('create');
  assert.equal(JSON.parse(local.getItem(resumeKey)).name, saved.name);
  ui.responses.push({ status: 200, body: { ok: true } });
  await ui.click('leave');
  assert.equal(local.getItem(resumeKey), null);
  assert.equal(ui.get('resume-panel').hidden, true);
});
