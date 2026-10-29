import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../src/lobby.mjs';
import { bid, play, advanceTrick, ROUND_RESULT_MS } from '../src/game.mjs';

function roomWith(humans, bots = 0) {
  const lobby = new Lobby();
  const host = lobby.create('선장');
  const people = [host];
  for (let i = 1; i < humans; i++) {
    const person = lobby.join(host.state.code, `선원 ${i}`);
    lobby.ready(person.token, true);
    people.push(person);
  }
  for (let i = 0; i < bots; i++) lobby.addBot(host.token);
  lobby.start(host.token, false, 0);
  const room = lobby.session(host.token).room;
  return { lobby, people, room, game: room.game };
}

function endFirstRound(game, now = 1000) {
  for (const id of game.players) bid(game, id, 0, now);
  while (game.phase === 'playing') {
    const id = game.turnId;
    play(game, id, game.hands[id][0].id, 'escape', now);
  }
  advanceTrick(game, now);
}

const stamp = game => ({ gameId: game.id, round: game.round });

test('라운드 결과 진입부터 정확히 10초 뒤 한 번만 자동 배분, 새 예측은 20초', () => {
  const { lobby, people, game } = roomWith(3);
  endFirstRound(game);
  assert.equal(ROUND_RESULT_MS, 10_000);
  assert.equal(game.phase, 'round-result');
  assert.equal(game.deadlineAt, 11_000);
  const before = lobby.state(people[0].token).game.roundAdvance;
  assert.deepEqual(before, { deadlineAt: 11_000, eligibleCount: 3, requiredCount: 2, skippedCount: 0, ownSkipped: false });
  lobby.tick(10_999);
  assert.equal(game.phase, 'round-result');
  lobby.tick(11_000);
  assert.equal(game.round, 2);
  assert.equal(game.phase, 'bidding');
  assert.equal(game.deadlineAt, 31_000);
  assert.equal(game.history.length, 1);
  assert.deepEqual(game.roundSkips, []);
  assert.equal(lobby.state(people[0].token).game.roundAdvance, null);
  lobby.tick(11_000);
  assert.equal(game.round, 2);
});

test('사람 3~8명의 스킵은 2/3 올림, 중복·위조·이전 라운드 요청은 추가 표가 되지 않음', () => {
  for (const [count, required] of [[3, 2], [4, 3], [5, 4], [6, 4], [7, 5], [8, 6]]) {
    const { lobby, people, game } = roomWith(count);
    assert.throws(() => lobby.skipRound(people[0].token, stamp(game), 0));
    endFirstRound(game);
    const input = stamp(game);
    assert.throws(() => lobby.skipRound(people[0].token, { ...input, gameId: 'old' }, 1001));
    assert.throws(() => lobby.skipRound(people[0].token, { ...input, round: 0 }, 1001));
    for (let i = 0; i < required; i++) {
      const view = lobby.skipRound(people[i].token, { ...input, playerId: people.at(-1).state.selfId }, 1001);
      if (i < required - 1) {
        assert.equal(game.phase, 'round-result');
        assert.equal(view.game.roundAdvance.skippedCount, i + 1);
        assert.equal(view.game.roundAdvance.requiredCount, required);
        assert.equal(view.game.roundAdvance.ownSkipped, true);
        assert.equal(lobby.skipRound(people[i].token, input, 1002).game.roundAdvance.skippedCount, i + 1);
        assert.equal(game.deadlineAt, 11_000, 'votes never extend the original deadline');
      }
    }
    assert.equal(game.phase, 'bidding');
    assert.equal(game.round, 2);
    assert.equal(game.history.length, 1);
    assert.throws(() => lobby.skipRound(people.at(-1).token, input, 1003));
  }
});

test('AI는 정족수와 투표에서 제외, 1인 AI 게임도 결과 확인 후 직접 스킵 가능', () => {
  const { lobby, people, game } = roomWith(1, 3);
  endFirstRound(game);
  lobby.tick(1001);
  const progress = lobby.state(people[0].token).game.roundAdvance;
  assert.equal(progress.eligibleCount, 1);
  assert.equal(progress.requiredCount, 1);
  assert.equal(progress.skippedCount, 0);
  assert.equal(game.phase, 'round-result');
  lobby.nextRound(people[0].token, stamp(game), 1002);
  assert.equal(game.round, 2, 'legacy next path uses the same skip mechanism');
});

test('퇴장 시 사람 인원과 유효 표를 다시 계산하며 정족수 충족 시 즉시 이동', () => {
  const first = roomWith(4);
  endFirstRound(first.game);
  const input = stamp(first.game);
  first.lobby.skipRound(first.people[0].token, input, 1001);
  first.lobby.skipRound(first.people[1].token, input, 1001);
  first.lobby.leave(first.people[3].token, 1002);
  assert.equal(first.game.round, 2, '2 / 3 remaining people reaches the threshold');

  const second = roomWith(4);
  endFirstRound(second.game);
  second.lobby.skipRound(second.people[0].token, stamp(second.game), 1001);
  second.lobby.skipRound(second.people[1].token, stamp(second.game), 1001);
  second.lobby.leave(second.people[0].token, 1002);
  const view = second.lobby.state(second.people[1].token);
  assert.equal(view.game.roundAdvance.eligibleCount, 3);
  assert.equal(view.game.roundAdvance.skippedCount, 1, 'departed voter is not counted');
  assert.equal(view.game.roundAdvance.requiredCount, 2);
  assert.equal(view.hostId, second.people[1].state.selfId);
  assert.equal(second.game.phase, 'round-result');
  second.lobby.tick(11_000);
  assert.equal(second.game.round, 2);
});

test('만료와 스킵이 겹쳐도 한 번만 진행하며 최종 우승 결과에는 자동 진행·스킵 없음', () => {
  const { lobby, people, game } = roomWith(3);
  endFirstRound(game);
  const input = stamp(game);
  lobby.skipRound(people[0].token, input, 11_000);
  lobby.tick(11_000);
  assert.equal(game.round, 2);
  assert.throws(() => lobby.skipRound(people[1].token, input, 11_000));

  const final = roomWith(3);
  final.game.round = 10;
  final.game.scores[final.people[0].state.selfId] = 10_000;
  endFirstRound(final.game);
  assert.equal(final.game.phase, 'finished');
  assert.equal(final.game.deadlineAt, null);
  assert.equal(final.lobby.state(final.people[0].token).game.roundAdvance, null);
  assert.throws(() => final.lobby.skipRound(final.people[0].token, stamp(final.game), 1001));
  final.lobby.tick(100_000);
  assert.equal(final.game.round, 10);
  assert.equal(final.game.phase, 'finished');

  const tied = roomWith(3);
  tied.game.round = 10;
  endFirstRound(tied.game);
  assert.equal(tied.game.phase, 'round-result');
  assert.equal(tied.game.leaderIds.length, 2);
  tied.lobby.tick(11_000);
  assert.equal(tied.game.round, 11, 'a tied final round advances to overtime after the same 10 seconds');
  assert.equal(tied.game.phase, 'bidding');
  assert.equal(tied.game.cardsDealt, 10);
});
