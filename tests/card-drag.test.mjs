import test from 'node:test';
import assert from 'node:assert/strict';
import { configureCardDrag } from '../public/game-ui.js';

class Target {
  listeners = {}; dataset = {}; style = {}; className = 'playing-card'; capture = null;
  classList = { add() {}, remove() {}, toggle() {} };
  addEventListener(type, fn) { this.listeners[type] = fn; }
  fire(type, extra = {}) { this.listeners[type]?.({ target: this, pointerId: 1, button: 0, pointerType: 'mouse', clientX: 100, clientY: 400, preventDefault() {}, ...extra }); }
  closest(selector) { return selector === 'button[data-card-id]' ? this : null; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 200 }; }
  cloneNode() { return new Target(); }
  removeAttribute() {}
  setAttribute() {}
  remove() { this.removed = true; }
  setPointerCapture(id) { this.capture = id; }
  hasPointerCapture(id) { return this.capture === id; }
  releasePointerCapture() { this.capture = null; }
}

test('포인터 드래그: 테이블 제출, 밖/코너/취소/상태 변경 차단, 터치 스크롤 보존', () => {
  const original = globalThis.document;
  const doc = new Target(), hand = new Target(), card = new Target(), zone = new Target();
  card.dataset.cardId = 'king';
  let legal = true, version = 'round1:trick1', surface = 'table';
  const ghosts = [], picked = [], submitted = [];
  doc.getElementById = () => new Target();
  doc.body = { append: element => ghosts.push(element) };
  doc.elementFromPoint = () => ({ closest: selector => selector === '#round-table' && surface === 'table' ? zone : selector === '.score-player' && surface === 'seat' ? card : null });
  globalThis.document = doc;
  try {
    const drag = configureCardDrag({ hand, zone, canPlay: () => legal, context: () => version, pick: id => picked.push(id), submit: id => submitted.push(id) });
    const start = (extra = {}) => hand.fire('pointerdown', { target: card, ...extra });
    const move = (extra = {}) => doc.fire('pointermove', { clientX: 100, clientY: 100, ...extra });
    const release = (extra = {}) => doc.fire('pointerup', { clientX: 100, clientY: 100, ...extra });
    start(); move(); release(); release();
    assert.deepEqual(submitted, ['king'], 'one drop sends exactly one submission');
    assert.ok(ghosts[0].removed);
    assert.equal(card.capture, null);
    assert.ok(drag.consumeClick('king', 1), 'synthetic click after drop does not toggle selection');
    assert.equal(drag.consumeClick('king', 1), false);

    start(); move(); release({ clientX: 250 });
    start(); move(); release({ clientX: 1, clientY: 1 }); // ellipse's bounding-box corner is outside the table
    start(); move(); surface = 'seat'; release(); surface = 'table';
    assert.equal(submitted.length, 1);
    start(); move(); doc.fire('pointercancel'); release();
    start(); move(); doc.fire('keydown', { key: 'Escape' }); release();
    start(); move(); doc.fire('lostpointercapture'); hand.fire('lostpointercapture'); release();
    start(); move(); version = 'round1:trick2'; drag.validate(); release();
    assert.equal(submitted.length, 1, 'cancellation and changed server turn never submit');
    legal = false; start(); move(); release();
    assert.equal(submitted.length, 1, 'illegal/busy/expired cards cannot start a drag');
    legal = true;
    const count = picked.length;
    start({ pointerType: 'touch' }); move({ clientX: 150, clientY: 398 }); release();
    assert.equal(picked.length, count, 'horizontal touch belongs to native hand scrolling');
    start({ pointerType: 'touch' }); move(); release();
    assert.equal(submitted.length, 2, 'upward touch drag submits');
    start(); release();
    assert.equal(submitted.length, 2, 'a tap without a drag cannot submit');
    assert.equal(drag.consumeClick('king', 0), false, 'keyboard activation remains available');
    assert.ok(ghosts.every(ghost => ghost.removed));
  } finally { globalThis.document = original; }
});
