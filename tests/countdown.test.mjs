import test from 'node:test';
import assert from 'node:assert/strict';
import { updateTimer } from '../public/game-ui.js';

test('중앙 카운트다운: 5초 경계, 매초 감소, 만료·새 차례·결과·퇴장 시 숨김', () => {
  const original = globalThis.document;
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', hidden: true, classList: { toggle() {} } });
    return nodes.get(id);
  };
  globalThis.document = { getElementById: get };
  try {
    const game = { phase: 'bidding', deadlineAt: 20_000 };
    updateTimer(14_999, game);
    assert.equal(get('turn-timer').textContent, '6초');
    assert.ok(get('table-countdown').hidden);
    updateTimer(15_000, game);
    assert.equal(get('table-countdown').hidden, false);
    assert.equal(get('table-countdown-number').textContent, '5');
    assert.equal(get('table-countdown-label').textContent, '예측 마감');
    const overlay = get('table-countdown');
    for (let seconds = 4; seconds >= 1; seconds--) {
      updateTimer(20_000 - seconds * 1000, game);
      assert.equal(get('table-countdown-number').textContent, String(seconds));
      assert.equal(get('table-countdown'), overlay, 'timer ticks reuse the same DOM node');
    }
    updateTimer(20_000, game);
    assert.ok(overlay.hidden);
    assert.equal(get('turn-timer').textContent, '0초');
    updateTimer(25_000, game);
    assert.ok(overlay.hidden, 'expired polling responses cannot revive the warning');

    game.phase = 'playing'; game.deadlineAt = 40_000;
    updateTimer(35_000, game);
    assert.equal(overlay.hidden, false);
    assert.equal(get('table-countdown-label').textContent, '카드 제출 마감');
    game.deadlineAt = 50_000;
    updateTimer(35_000, game);
    assert.ok(overlay.hidden, 'a new turn clears the previous warning immediately');
    for (const phase of ['trick-result', 'round-result', 'finished']) {
      game.phase = phase;
      updateTimer(45_000, game);
      assert.ok(overlay.hidden, 'result phases never show a stale countdown');
    }
    game.phase = 'playing'; game.deadlineAt = null;
    updateTimer(45_000, game);
    assert.ok(overlay.hidden);
    updateTimer(45_000, null);
    assert.ok(overlay.hidden);
    assert.equal(get('turn-timer').textContent, '—');
  } finally {
    globalThis.document = original;
  }
});
