import test from 'node:test';
import assert from 'node:assert/strict';

// A small DOM double exercises state transitions without adding runtime packages.
class Element {
  children = []; dataset = {}; attributes = {}; listeners = {}; value = ''; hidden = false; disabled = false; textContent = '';
  classes = new Set();
  style = { setProperty: (key, value) => { this.attributes[key] = value; } };
  classList = {
    add: name => this.classes.add(name),
    remove: (...names) => names.forEach(name => this.classes.delete(name)),
    contains: name => this.classes.has(name),
    toggle: (name, on) => { if (on ?? !this.classes.has(name)) this.classes.add(name); else this.classes.delete(name); },
  };
  set className(value) { this.classes = new Set(value.split(' ')); }
  append(...elements) { elements.forEach(element => { element.parent = this; this.children.push(element); }); }
  replaceChildren(...elements) { this.children = []; this.append(...elements); }
  remove() { this.parent.children = this.parent.children.filter(element => element !== this); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  animate() {}
  closest() { return this; }
  fire(name, target = this) { this.listeners[name]?.({ target, preventDefault() {} }); }
}

test('게임 UI: 예측·선택 보존, 제출 권한, 트릭 승리와 라운드 초기화', async () => {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const original = { document: globalThis.document, matchMedia: globalThis.matchMedia, setInterval: globalThis.setInterval };
  globalThis.document = { getElementById: get, querySelector: get, createElement: () => new Element(), createElementNS: () => new Element(), addEventListener() {} };
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.setInterval = () => 0;
  try {
    const { configureGameUI, renderGame, syncGameControls } = await import('../public/game-ui.js');
    const requests = [];
    configureGameUI((path, body) => requests.push({ path, body }));
    const tigress = { id: 't', type: 'tigress' };
    const green = { id: 'g', type: 'number', suit: 'green', value: 14 };
    const state = {
      selfId: 'me', hostId: 'me', code: 'TEST01', players: [{ id: 'me', name: '선장' }, { id: 'other', name: '선원' }],
      game: { id: 'game1', round: 2, cardsDealt: 2, phase: 'bidding', trickNumber: 1, trick: [], hand: [tigress, green], seatOrder: ['other', 'me'],
        players: [{ id: 'me', score: 0, hasBid: false, cardCount: 2, bid: null, won: 0 }, { id: 'other', score: 0, hasBid: false, cardCount: 2, bid: null, won: 0 }],
        playableCardIds: [], submittedCount: 0, timeLimits: { bidSeconds: 20, playSeconds: 15 } },
    };
    renderGame(state, false);
    const ownSeat = get('scoreboard').children.find(row => row.classList.contains('my-seat'));
    assert.equal(ownSeat.dataset.seat, '2', 'server seat order takes precedence over lobby order');
    const ownPosition = [ownSeat.attributes['--seat-x'], ownSeat.attributes['--seat-y']];
    assert.equal(get('bid-options').children.length, 3);
    get('bid-options').fire('click', get('bid-options').children[2]);
    const hand = get('hand').children;
    get('hand').fire('click', hand[0]);
    assert.equal(hand[0].attributes['aria-pressed'], 'true');
    get('hand').fire('click', hand[0]);
    assert.equal(hand[0].attributes['aria-pressed'], 'false', 'second click clears selection');
    assert.ok(get('tigress-choice').hidden);
    assert.ok(get('play-submit').disabled);
    get('hand').fire('click', hand[0]);
    assert.equal(get('play-submit').disabled, true, 'inspection during bidding must not allow play');
    get('tigress-mode').value = 'escape';
    state.game.submittedCount = 1;
    renderGame(state, false);
    assert.equal(get('bid-value').value, '2');
    assert.deepEqual([ownSeat.attributes['--seat-x'], ownSeat.attributes['--seat-y']], ownPosition);
    assert.equal(get('hand').children, hand, 'progress updates preserve the actual hand DOM');
    assert.equal(get('tigress-mode').value, 'escape');
    get('bid-form').fire('submit');
    assert.deepEqual(requests.at(-1), { path: 'game/bid', body: { gameId: 'game1', round: 2, bid: 2 } });
    state.game.players[0].hasBid = true;
    renderGame(state, false);
    assert.ok(get('bid-options').children.every(button => button.disabled));

    state.game.phase = 'playing'; state.game.turnId = 'me'; state.game.playableCardIds = ['t'];
    renderGame(state, false);
    assert.equal(get('play-submit').disabled, false);
    assert.ok(hand[0].classList.contains('playable'));
    assert.ok(hand[1].classList.contains('unplayable'));
    syncGameControls(true);
    assert.ok(get('play-submit').disabled);
    assert.ok(hand.every(button => button.disabled));
    syncGameControls(false); // failed requests return here, retaining card and mode for retry
    assert.equal(get('tigress-mode').value, 'escape');
    assert.equal(hand[0].attributes['aria-pressed'], 'true');
    get('play-submit').fire('click');
    assert.deepEqual(requests.at(-1), { path: 'game/play', body: { gameId: 'game1', round: 2, trickNumber: 1, cardId: 't', mode: 'escape' } });
    get('hand').fire('click', hand[1]);
    assert.ok(get('play-submit').disabled, 'inspecting an illegal card cannot enable submission');
    assert.match(get('card-inspect').textContent, /지금은 낼 수 없습니다/);

    state.game.trick = [{ playerId: 'other', card: green }];
    renderGame(state, false);
    const slot = get('trick-area').children[0];
    assert.equal(slot.dataset.seat, '1', 'submitted card stays at its owner seat');
    assert.match(get('turn-order').textContent, /마지막 차례/);
    state.game.phase = 'trick-result'; state.game.lastTrick = { number: 1, winnerId: 'other', bonus: 10 };
    renderGame(state, false);
    assert.equal(get('trick-area').children[0], slot, 'same trick nodes survive result transition');
    assert.ok(slot.classList.contains('winner'), 'winner updates even when trick cards did not change');
    assert.ok(get('play-submit').disabled);
    state.game.round = 3; state.game.cardsDealt = 3; state.game.phase = 'bidding'; state.game.trick = []; state.game.players[0].hasBid = false;
    renderGame(state, false);
    assert.equal(get('bid-value').value, '0');
    assert.equal(get('tigress-mode').value, 'pirate');
    assert.equal(get('trick-area').children.length, 0);
    assert.equal(get('bid-options').children.length, 4);
    renderGame(null, false);
    assert.equal(get('scoreboard').children.length, 0);
    renderGame(state, false);
    assert.equal(get('scoreboard').children.length, 2, 'reentry has no stale or duplicated seats');
  } finally {
    Object.assign(globalThis, original);
  }
});
