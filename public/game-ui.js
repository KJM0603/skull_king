const $ = id => document.getElementById(id);
const suits = { green: '초록', yellow: '노랑', purple: '보라', black: '검정' };
const symbols = { green: '♣', yellow: '◆', purple: '✦', black: '♠', escape: '⚑', pirate: '⚔', king: '♛', mermaid: '≈', tigress: 'T' };
const names = { escape: '도망', pirate: '해적', king: '스컬킹', mermaid: '인어', tigress: '티그리스' };
export const cardName = card => card.type === 'number' ? `${suits[card.suit]} ${card.value}` : `${names[card.type]}${card.mode ? card.mode === 'pirate' ? ' (해적)' : ' (도망)' : ''}`;
let state;
let send;
let selected = null;
let handSignature = '';
let trickSignature = '';
let resultSignature = '';
let roundSignature = '';
const scoreboard = new Map();
export function configureGameUI(submit) {
  send = submit;
  $('bid-form').addEventListener('submit', event => {
    event.preventDefault();
    if (state?.game) send('game/bid', { ...stamp(), bid: Number($('bid-value').value) });
  });
  $('hand').addEventListener('click', event => {
    const button = event.target.closest('button[data-card-id]');
    if (!button || button.disabled) return;
    selected = button.dataset.cardId;
    updateSelection();
    syncGameControls(false);
  });
  $('play-submit').addEventListener('click', () => {
    if (selected && state?.game) send('game/play', { ...stamp(), trickNumber: state.game.trickNumber, cardId: selected, mode: $('tigress-mode').value });
  });
  $('next-round').addEventListener('click', () => { if (state?.game) send('game/next', stamp()); });
  $('return-lobby').addEventListener('click', () => { if (state?.game) send('game/lobby', stamp()); });
  setInterval(() => {
    const deadline = state?.game?.deadlineAt;
    $('turn-timer').textContent = deadline ? `${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}초` : '';
  }, 250);
}
function stamp() { return { gameId: state.game.id, round: state.game.round }; }
function playerName(id) { return state.players.find(player => player.id === id)?.name ?? '참가자'; }
function cardElement(card, button = false) {
  const element = document.createElement(button ? 'button' : 'div');
  element.className = `playing-card card-${card.suit ?? card.type}`;
  if (button) { element.type = 'button'; element.dataset.cardId = card.id; element.setAttribute('aria-label', cardName(card)); }
  const icon = document.createElement('span');
  icon.className = 'card-symbol'; icon.textContent = symbols[card.suit ?? card.type];
  const value = document.createElement('strong'); value.textContent = card.type === 'number' ? card.value : symbols[card.type];
  const label = document.createElement('small'); label.textContent = cardName(card);
  element.append(icon, value, label);
  return element;
}
function updateSelection() {
  for (const element of $('hand').children) {
    const isSelected = element.dataset.cardId === selected;
    element.classList.toggle('selected', isSelected);
    element.setAttribute('aria-pressed', String(isSelected));
  }
  const card = state?.game?.hand.find(value => value.id === selected);
  $('tigress-choice').hidden = card?.type !== 'tigress';
  $('play-submit').textContent = card ? `${cardName(card)} 내기` : '카드를 선택해 주세요';
}
export function renderGame(next, busy) {
  state = next;
  const game = next?.game;
  $('game').hidden = !game;
  document.querySelector('main').classList.toggle('is-playing', Boolean(game));
  if (!game) { handSignature = ''; trickSignature = ''; resultSignature = ''; roundSignature = ''; selected = null; return; }
  const roundKey = `${game.id}:${game.round}`;
  if (roundSignature !== roundKey) {
    roundSignature = roundKey;
    $('bid-value').value = '0';
    selected = null;
    $('game-message').textContent = '';
  }
  $('round-title').textContent = `${game.round > 10 ? '연장 ' : ''}${game.round}라운드 · ${game.cardsDealt}장`;
  $('game-code').textContent = `방 ${next.code}`;
  for (const [id, row] of scoreboard) {
    if (!next.players.some(player => player.id === id)) { row.remove(); scoreboard.delete(id); }
  }
  for (const player of next.players) {
    const info = game.players.find(value => value.id === player.id);
    if (!info) continue;
    let row = scoreboard.get(player.id);
    if (!row) { row = document.createElement('div'); row.className = 'score-player'; row.append(document.createElement('strong'), document.createElement('span'), document.createElement('small')); scoreboard.set(player.id, row); $('scoreboard').append(row); }
    row.classList.toggle('my-seat', player.id === next.selfId);
    row.classList.toggle('active-seat', game.turnId === player.id);
    row.children[0].textContent = `${player.name}${player.isBot ? ' · AI' : ''}${player.id === next.selfId ? ' (나)' : ''}`;
    row.children[1].textContent = `${info.score}점`;
    row.children[2].textContent = game.phase === 'bidding' ? info.hasBid ? '예측 제출 완료' : '예측 중' : `예측 ${info.bid} / 획득 ${info.won} · ${info.cardCount}장`;
  }
  const own = game.players.find(player => player.id === next.selfId);
  const myTurn = game.phase === 'playing' && game.turnId === next.selfId;
  const resultPhase = ['round-result', 'finished'].includes(game.phase);
  $('phase-title').textContent = game.phase === 'bidding' ? own.hasBid ? '다른 참가자의 예측을 기다립니다' : '이길 횟수를 예측해 주세요' : game.phase === 'playing' ? myTurn ? '내 차례입니다' : `${playerName(game.turnId)}님의 차례` : game.phase === 'trick-result' ? `${playerName(game.lastTrick.winnerId)}님이 트릭을 가져갑니다` : game.phase === 'finished' ? `${playerName(game.leaderIds[0])}님 우승!` : `${game.round}라운드 결과`;
  $('phase-help').textContent = game.phase === 'bidding' ? `${game.submittedCount} / ${next.players.length}명 제출 · 모두 제출하면 동시에 공개합니다.` : game.phase === 'playing' ? game.leadSuit ? `${suits[game.leadSuit]} 숫자 카드가 있으면 같은 색 또는 특수 카드를 내세요.` : '먼저 나온 숫자 색이 없습니다. 원하는 카드를 선택하세요.' : resultPhase ? game.phase === 'finished' ? '10라운드 이상의 합산 점수로 우승자를 결정했습니다.' : game.round >= 10 ? '공동 1위가 있어 연장 라운드를 진행합니다.' : '예측이 맞아야 보너스 점수를 받을 수 있습니다.' : '잠시 후 다음 트릭으로 진행합니다.';
  const trickKey = JSON.stringify([game.id, game.round, game.trickNumber, game.trick]);
  if (trickSignature !== trickKey) {
    trickSignature = trickKey;
    $('trick-area').replaceChildren(...game.trick.map(play => {
      const slot = document.createElement('div'); slot.className = 'trick-slot';
      const label = document.createElement('span'); label.textContent = playerName(play.playerId);
      slot.append(label, cardElement(play.card));
      if (game.phase === 'trick-result' && game.lastTrick.winnerId === play.playerId) slot.classList.add('winner');
      return slot;
    }));
  }
  $('trick-area').hidden = game.phase === 'bidding' || resultPhase;
  $('last-trick').textContent = game.lastTrick ? `트릭 ${game.lastTrick.number}: ${playerName(game.lastTrick.winnerId)}님 획득 · 보너스 후보 ${game.lastTrick.bonus}점` : '';
  $('bid-form').hidden = game.phase !== 'bidding';
  $('bid-value').max = game.cardsDealt;
  $('bid-help').textContent = own.hasBid ? `내 예측: ${game.ownBid}회${game.ownAutoBid ? ' (시간 만료로 자동 제출)' : ''} · 제출 후에는 바꿀 수 없습니다.` : `0~${game.cardsDealt}회로 입력해 주세요. 45초 후 자동 제출합니다.`;
  const handKey = JSON.stringify([game.id, game.round, game.hand]);
  if (handSignature !== handKey) {
    handSignature = handKey;
    if (!game.hand.some(card => card.id === selected)) selected = null;
    $('hand').replaceChildren(...game.hand.map(card => cardElement(card, true)));
  }
  $('hand-area').hidden = resultPhase;
  $('hand-count').textContent = `${game.hand.length}장 · 나에게만 보입니다`;
  $('play-controls').hidden = game.phase !== 'playing';
  updateSelection();
  $('round-results').hidden = !resultPhase;
  if (resultPhase) {
    const last = game.history.at(-1);
    const key = JSON.stringify([game.id, last]);
    if (resultSignature !== key) {
      resultSignature = key;
      $('result-title').textContent = '라운드 점수';
      $('result-rows').replaceChildren(...last.results.map(result => {
        const row = document.createElement('tr');
        for (const value of [playerName(result.playerId), `${result.bid} / ${result.won}`, result.base, result.bonus, result.points, result.total]) {
          const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
        }
        return row;
      }));
    }
    $('result-help').textContent = next.selfId === next.hostId ? game.phase === 'finished' ? '대기실로 돌아가 같은 참가자들과 다시 시작하실 수 있습니다.' : '점수를 확인하신 뒤 다음 라운드를 눌러 주세요.' : '방장이 다음 진행을 선택할 때까지 기다려 주세요.';
  }
  $('next-round').hidden = game.phase !== 'round-result' || next.selfId !== next.hostId;
  $('return-lobby').hidden = game.phase !== 'finished' || next.selfId !== next.hostId;
  syncGameControls(busy);
}
export function syncGameControls(busy) {
  const game = state?.game;
  if (!game) return;
  const own = game.players.find(player => player.id === state.selfId);
  $('bid-submit').disabled = busy || game.phase !== 'bidding' || own.hasBid;
  $('bid-value').disabled = busy || own.hasBid;
  $('tigress-mode').disabled = busy;
  for (const button of $('hand').children) button.disabled = busy || !game.playableCardIds.includes(button.dataset.cardId);
  $('play-submit').disabled = busy || !selected || !game.playableCardIds.includes(selected);
  $('next-round').disabled = busy || state.selfId !== state.hostId || game.phase !== 'round-result';
  $('return-lobby').disabled = busy || state.selfId !== state.hostId || game.phase !== 'finished';
}
