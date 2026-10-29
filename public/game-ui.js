const $ = id => document.getElementById(id);
const setText = (id, text) => { if ($(id).textContent !== text) $(id).textContent = text; };
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
let phaseSignature = '';
let uiBusy = false;
let drag;
const scoreboard = new Map();
const trickSlots = new Map();
const descriptions = { escape: '승부를 피해 가는 카드. 모두 도망이면 먼저 낸 사람이 이깁니다.', pirate: '숫자와 인어를 이기는 해적. 스컬킹을 조심하세요.', king: '모든 해적을 압도하는 스컬킹. 인어에게는 집니다.', mermaid: '스컬킹을 잡는 인어. 해적에게는 집니다.', tigress: '제출할 때 해적 또는 도망으로 사용할 수 있습니다.' };
// Original, code-native emblems. No external assets or hidden game information.
const emblems = {
  number: 'M50 13V75M48 20L20 57H48ZM55 29L78 57H55ZM15 65H85L72 80H28ZM10 88Q20 81 30 88T50 88T70 88T90 88',
  escape: 'M32 86V15M33 17Q48 8 60 20T83 19V52Q69 57 58 47T33 50M20 87H48',
  pirate: 'M20 13L69 65M80 13L31 65M14 13L22 35L65 78L78 65L35 22ZM86 13L78 35L35 78L22 65L65 22ZM57 82L83 56M17 56L43 82M23 81L15 89M77 81L85 89',
  king: 'M17 29L30 42L50 16L70 42L83 29L75 62H25ZM27 72H73M35 81H65M43 47L50 37L57 47L50 56Z',
  mermaid: 'M42 13Q70 23 57 45Q47 62 61 71Q70 58 83 65Q76 82 59 85Q26 83 28 58Q29 39 45 32Q52 25 42 13ZM17 91Q28 84 39 91T61 91T83 91',
  tigress: 'M25 19L43 30L57 30L75 19L81 54L69 77L50 89L31 77L19 54ZM32 44L43 49M68 44L57 49M43 63H57L50 70ZM50 70V79M22 56L35 60M78 56L65 60',
};
export function configureGameUI(submit) {
  send = submit;
  drag = configureCardDrag({ hand: $('hand'), zone: $('table-drop-zone'), canPlay,
    context: () => state?.game ? `${state.game.id}:${state.game.round}:${state.game.trickNumber}:${state.game.phase}:${state.game.turnId}:${state.game.deadlineAt}` : '',
    pick: cardId => { selected = cardId; updateSelection(); syncGameControls(uiBusy); }, submit: submitCard });
  $('bid-form').addEventListener('submit', event => {
    event.preventDefault();
    if (state?.game) send('game/bid', { ...stamp(), bid: Number($('bid-value').value) });
  });
  $('hand').addEventListener('click', event => {
    const button = event.target.closest('button[data-card-id]');
    if (!button || button.disabled) return;
    if (drag.consumeClick(button.dataset.cardId, event.detail)) return;
    selected = selected === button.dataset.cardId ? null : button.dataset.cardId;
    updateSelection();
    syncGameControls(uiBusy);
  });
  $('bid-options').addEventListener('click', event => {
    const option = event.target.closest('button[data-bid]');
    if (!option || option.disabled) return;
    $('bid-value').value = option.dataset.bid;
    updateBidOptions();
  });
  $('bid-value').addEventListener('input', updateBidOptions);
  $('tigress-mode').addEventListener('change', updateSelection);
  $('play-submit').addEventListener('click', () => submitCard(selected));
  $('next-round').addEventListener('click', () => {
    const game = state?.game;
    if (!uiBusy && game?.phase === 'round-result' && !game.roundAdvance?.ownSkipped) {
      send(game.roundAdvance ? 'game/skip' : 'game/next', stamp());
    }
  });
  $('return-lobby').addEventListener('click', () => { if (state?.game) send('game/lobby', stamp()); });
  setInterval(updateTimer, 250);
}
function canPlay(cardId) {
  const game = state?.game;
  return !uiBusy && Boolean(game && game.phase === 'playing' && game.turnId === state.selfId && game.playableCardIds.includes(cardId) && (!game.deadlineAt || game.deadlineAt > Date.now()));
}
function submitCard(cardId) {
  if (!canPlay(cardId)) return;
  send('game/play', { ...stamp(), trickNumber: state.game.trickNumber, cardId, mode: $('tigress-mode').value });
}
function seats() { return state.game.seatOrder ?? state.game.players.map(player => player.id); }
function positionAtSeat(element, playerId, cards = false) {
  const order = seats();
  const index = order.indexOf(playerId);
  const angle = -Math.PI / 2 + index * 2 * Math.PI / order.length;
  // The same absolute seat is shown to every player; the active seat never rotates the table.
  element.style.setProperty('--seat-x', Math.cos(angle));
  element.style.setProperty('--seat-y', Math.sin(angle));
  element.style.setProperty('--card-y', Math.sin(angle) * Math.abs(Math.sin(angle)));
  // Spread the two diagonal cards vertically on a shallow landscape table.
  element.style.setProperty('--wide-card-y', Math.sign(Math.sin(angle)) * Math.sqrt(Math.abs(Math.sin(angle))));
  element.dataset.seat = String(index + 1);
  if (!cards) element.setAttribute('aria-label', `${index + 1}번 좌석 · ${playerName(playerId)}`);
}
function updateBidOptions() {
  for (const button of $('bid-options').children) button.setAttribute('aria-pressed', String(button.dataset.bid === $('bid-value').value));
}
export function updateTimer(now = Date.now(), game = state?.game) {
  const seconds = game?.deadlineAt ? Math.max(0, Math.ceil((game.deadlineAt - now) / 1000)) : null;
  setText('turn-timer', seconds === null ? '—' : `${seconds}초`);
  $('turn-timer').classList.toggle('urgent', seconds !== null && seconds <= 5);
  const transition = game?.phase === 'round-result' ? game.roundAdvance : null;
  $('round-auto-timer').hidden = !transition;
  if (transition) {
    const remaining = Math.max(0, Math.ceil((transition.deadlineAt - now) / 1000));
    setText('round-auto-timer', remaining > 0 ? `${remaining}초 뒤 다음 라운드로 자동 이동합니다` : '다음 라운드로 이동 중입니다…');
  }
  const active = ['bidding', 'playing'].includes(game?.phase);
  const visible = active && seconds !== null && seconds > 0 && seconds <= 5;
  $('table-countdown').hidden = !visible;
  if (visible) {
    setText('table-countdown-number', String(seconds));
    const name = game.turnId ? state?.players.find(player => player.id === game.turnId)?.name : null;
    setText('table-countdown-label', game.phase === 'bidding' ? '예측 마감' : name ? `${name}님 차례` : '카드 제출 마감');
  }
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
  const art = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  art.setAttribute('viewBox', '0 0 100 100'); art.setAttribute('aria-hidden', 'true'); art.classList.add('card-art');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', emblems[card.type]); art.append(path);
  element.append(icon, value, art, label);
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
  const mode = card?.type === 'tigress' ? ` · ${$('tigress-mode').value === 'pirate' ? '해적' : '도망'}` : '';
  $('play-submit').textContent = card ? `${cardName(card)}${mode} 내기 ↗` : '카드를 선택해 주세요';
  const myTurn = state?.game?.phase === 'playing' && state.game.turnId === state.selfId;
  const unavailable = card && myTurn && !state.game.playableCardIds.includes(card.id);
  setText('card-inspect', card ? `${cardName(card)} — ${unavailable ? '먼저 나온 색을 따라야 하므로 지금은 낼 수 없습니다.' : descriptions[card.type] ?? (card.suit === 'black' ? '다른 숫자 색보다 강한 검정 카드입니다.' : '같은 색에서는 높은 숫자가 이깁니다.')}` : '카드를 선택해 자세히 살펴보세요.');
}
export function renderGame(next, busy) {
  state = next;
  updateTimer();
  drag?.validate();
  const game = next?.game;
  $('game').hidden = !game;
  document.querySelector('main').classList.toggle('is-playing', Boolean(game));
  if (!game) { handSignature = ''; trickSignature = ''; resultSignature = ''; roundSignature = ''; phaseSignature = ''; selected = null; scoreboard.clear(); trickSlots.clear(); $('scoreboard').replaceChildren(); $('trick-area').replaceChildren(); return; }
  const roundKey = `${game.id}:${game.round}`;
  if (roundSignature !== roundKey) {
    roundSignature = roundKey;
    $('bid-value').value = '0';
    selected = null;
    $('tigress-mode').value = 'pirate';
    $('bid-options').replaceChildren(...Array.from({ length: game.cardsDealt + 1 }, (_, bid) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.bid = String(bid); button.textContent = String(bid); button.setAttribute('aria-label', `${bid}회 예측`); return button;
    }));
    $('game-message').textContent = '';
  }
  $('round-title').textContent = `${game.round > 10 ? '연장 ' : ''}${game.round}라운드 · ${game.cardsDealt}장`;
  $('game-code').textContent = `방 ${next.code}`;
  for (const [id, row] of scoreboard) {
    if (!next.players.some(player => player.id === id)) { row.remove(); scoreboard.delete(id); }
  }
  for (const player of [...next.players].sort((a, b) => seats().indexOf(a.id) - seats().indexOf(b.id))) {
    const info = game.players.find(value => value.id === player.id);
    if (!info) continue;
    let row = scoreboard.get(player.id);
    if (!row) { row = document.createElement('div'); row.className = 'score-player'; row.append(document.createElement('strong')); scoreboard.set(player.id, row); $('scoreboard').append(row); }
    positionAtSeat(row, player.id);
    row.classList.toggle('my-seat', player.id === next.selfId);
    row.classList.toggle('active-seat', game.turnId === player.id);
    row.children[0].textContent = `${player.name}${player.id === next.selfId ? ' (나)' : ''}`;
    row.setAttribute('title', `${player.name}${player.isBot ? ' · AI' : ''}`);
  }
  const own = game.players.find(player => player.id === next.selfId);
  const limits = game.timeLimits ?? { bidSeconds: 45, playSeconds: 45 };
  const myTurn = game.phase === 'playing' && game.turnId === next.selfId;
  const resultPhase = ['round-result', 'finished'].includes(game.phase);
  const order = seats();
  const nextId = game.turnId ? order[(order.indexOf(game.turnId) + 1) % order.length] : null;
  setText('turn-order', game.turnId ? game.trick.length === order.length - 1
    ? `↻ ${playerName(game.turnId)} · 이번 트릭의 마지막 차례`
    : `↻ 시계 방향 · ${playerName(game.turnId)} → ${playerName(nextId)}`
    : '↻ 시계 방향 · 좌석은 이번 게임이 끝날 때까지 고정됩니다');
  $('game').classList.toggle('my-turn', myTurn);
  $('game').dataset.phase = game.phase;
  $('phase-badge').textContent = game.phase === 'bidding' ? '예측의 시간' : resultPhase ? '항해 기록' : `TRICK ${game.trickNumber} / ${game.cardsDealt}`;
  const phaseKey = `${game.id}:${game.round}:${game.phase}:${game.turnId}`;
  if (phaseKey !== phaseSignature) {
    phaseSignature = phaseKey;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) $('phase-title').animate([{ opacity: .3, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 320 });
  }
  setText('phase-title', game.phase === 'bidding' ? own.hasBid ? '다른 참가자의 예측을 기다립니다' : '이길 횟수를 예측해 주세요' : game.phase === 'playing' ? myTurn ? '내 차례입니다' : `${playerName(game.turnId)}님의 차례` : game.phase === 'trick-result' ? `${playerName(game.lastTrick.winnerId)}님이 트릭을 가져갑니다` : game.phase === 'finished' ? `${playerName(game.leaderIds[0])}님 우승!` : `${game.round}라운드 결과`);
  $('phase-help').textContent = game.phase === 'bidding' ? `${game.submittedCount} / ${next.players.length}명 제출 · 모두 제출하면 동시에 공개합니다.` : game.phase === 'playing' ? game.leadSuit ? `${suits[game.leadSuit]} 숫자 카드가 있으면 같은 색 또는 특수 카드를 내세요.` : '먼저 나온 숫자 색이 없습니다. 원하는 카드를 선택하세요.' : resultPhase ? game.phase === 'finished' ? '10라운드 이상의 합산 점수로 우승자를 결정했습니다.' : game.round >= 10 ? '공동 1위가 있어 연장 라운드를 진행합니다.' : '예측이 맞아야 보너스 점수를 받을 수 있습니다.' : '잠시 후 다음 트릭으로 진행합니다.';
  if (game.phase === 'playing') $('phase-help').textContent += ` 카드 제출 제한은 ${limits.playSeconds}초입니다.`;
  const trickKey = `${game.id}:${game.round}:${game.trickNumber}`;
  if (trickSignature !== trickKey) {
    trickSignature = trickKey;
    trickSlots.clear(); $('trick-area').replaceChildren();
  }
  for (const play of game.trick) {
    let slot = trickSlots.get(play.playerId);
    if (!slot) {
      slot = document.createElement('div'); slot.className = 'trick-slot';
      const label = document.createElement('span'); label.textContent = playerName(play.playerId);
      slot.append(label, cardElement(play.card));
      trickSlots.set(play.playerId, slot); $('trick-area').append(slot);
      positionAtSeat(slot, play.playerId, true);
    }
    slot.classList.toggle('winner', game.phase === 'trick-result' && game.lastTrick?.winnerId === play.playerId);
  }
  $('trick-area').hidden = game.phase === 'bidding' || resultPhase;
  setText('last-trick', game.lastTrick ? `트릭 ${game.lastTrick.number}: ${playerName(game.lastTrick.winnerId)}님 획득 · 보너스 후보 ${game.lastTrick.bonus}점` : '');
  $('bid-form').hidden = game.phase !== 'bidding';
  $('bid-value').max = game.cardsDealt;
  updateBidOptions();
  $('bid-help').textContent = own.hasBid ? `내 예측: ${game.ownBid}회${game.ownAutoBid ? ' (시간 만료로 자동 제출)' : ''} · 제출 후에는 바꿀 수 없습니다.` : `0~${game.cardsDealt}회로 입력해 주세요. ${limits.bidSeconds}초 후 자동 제출합니다.`;
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
    const progress = game.roundAdvance;
    setText('result-help', progress ? `스킵 ${progress.skippedCount} / ${progress.requiredCount}명 · 사람 ${progress.eligibleCount}명 중 3분의 2 이상이면 즉시 이동합니다. AI는 투표에서 제외합니다.` : next.selfId === next.hostId ? game.phase === 'finished' ? '대기실로 돌아가 같은 참가자들과 다시 시작하실 수 있습니다.' : '점수를 확인하신 뒤 다음 라운드를 눌러 주세요.' : '방장이 다음 진행을 선택할 때까지 기다려 주세요.');
    setText('next-round', progress ? `${progress.ownSkipped ? '스킵 동의 완료' : '스킵'} · ${progress.skippedCount} / ${progress.requiredCount}명` : '다음 라운드');
  }
  $('next-round').hidden = game.phase !== 'round-result' || (!game.roundAdvance && next.selfId !== next.hostId);
  $('return-lobby').hidden = game.phase !== 'finished' || next.selfId !== next.hostId;
  syncGameControls(busy);
  updateTimer();
}
export function syncGameControls(busy) {
  uiBusy = busy;
  drag?.validate();
  const game = state?.game;
  if (!game) return;
  const own = game.players.find(player => player.id === state.selfId);
  $('bid-submit').disabled = busy || game.phase !== 'bidding' || own.hasBid;
  $('bid-value').disabled = busy || own.hasBid;
  for (const button of $('bid-options').children) button.disabled = busy || own.hasBid || game.phase !== 'bidding';
  $('tigress-mode').disabled = busy;
  const myTurn = game.phase === 'playing' && game.turnId === state.selfId;
  for (const button of $('hand').children) {
    button.disabled = busy;
    button.classList.toggle('playable', myTurn && game.playableCardIds.includes(button.dataset.cardId));
    button.classList.toggle('unplayable', myTurn && !game.playableCardIds.includes(button.dataset.cardId));
  }
  $('play-submit').disabled = !canPlay(selected);
  $('play-submit').classList.toggle('ready-to-play', !$('play-submit').disabled);
  $('next-round').disabled = busy || game.phase !== 'round-result' || (game.roundAdvance ? game.roundAdvance.ownSkipped : state.selfId !== state.hostId);
  $('return-lobby').disabled = busy || state.selfId !== state.hostId || game.phase !== 'finished';
}

// Pointer events support mouse, pen and an upward touch drag. Horizontal touch
// movement remains the browser's native hand scrolling (touch-action: pan-x).
export function configureCardDrag({ hand, zone, canPlay, context, pick, submit }) {
  let gesture = null;
  let suppressClick = null;
  const hint = document.getElementById('drop-hint');
  function clean() {
    const old = gesture;
    gesture = null;
    old?.ghost?.remove();
    old?.button.classList.remove('drag-source');
    zone.classList.remove('drop-ready', 'drop-over');
    if (old?.button.hasPointerCapture(old.pointerId)) old.button.releasePointerCapture(old.pointerId);
    hint.textContent = '내 차례에 카드를 끌어 놓으세요';
    return old;
  }
  function overTable(x, y) {
    const r = zone.getBoundingClientRect();
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit?.closest('#round-table') && !hit.closest('.score-player')) &&
      ((x - r.left - r.width / 2) / (r.width / 2)) ** 2 + ((y - r.top - r.height / 2) / (r.height / 2)) ** 2 <= 1;
  }
  hand.addEventListener('pointerdown', event => {
    if (gesture || event.button !== 0 || event.isPrimary === false) return;
    const button = event.target.closest('button[data-card-id]');
    if (!button || button.disabled || !canPlay(button.dataset.cardId)) return;
    suppressClick = null;
    gesture = { button, cardId: button.dataset.cardId, pointerId: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY, context: context(), ghost: null };
  });
  document.addEventListener('pointermove', event => {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId) return;
    if (g.context !== context() || !canPlay(g.cardId)) { cancel(); return; }
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (!g.ghost) {
      if (Math.hypot(dx, dy) < 9) return;
      if (g.type === 'touch' && (Math.abs(dx) > Math.abs(dy) || dy > 0)) { clean(); return; }
      pick(g.cardId);
      const r = g.button.getBoundingClientRect();
      g.ghost = g.button.cloneNode(true);
      g.ghost.removeAttribute('data-card-id');
      g.ghost.removeAttribute('aria-pressed');
      g.ghost.setAttribute('aria-hidden', 'true');
      g.ghost.tabIndex = -1;
      g.ghost.className = `${g.button.className} card-drag-ghost`;
      g.ghost.style.width = `${r.width}px`; g.ghost.style.height = `${r.height}px`;
      document.body.append(g.ghost);
      g.button.classList.add('drag-source');
      g.button.setPointerCapture(event.pointerId);
      zone.classList.add('drop-ready');
    }
    event.preventDefault();
    g.ghost.style.left = `${event.clientX}px`; g.ghost.style.top = `${event.clientY}px`;
    const over = overTable(event.clientX, event.clientY);
    zone.classList.toggle('drop-over', over);
    hint.textContent = over ? '여기에 놓으면 제출됩니다' : '원탁 안으로 끌어 놓으세요';
  }, { passive: false });
  document.addEventListener('pointerup', event => {
    const g = gesture;
    if (!g || g.pointerId !== event.pointerId) return;
    const dragged = Boolean(g.ghost);
    const valid = dragged && g.context === context() && canPlay(g.cardId) && overTable(event.clientX, event.clientY);
    if (dragged) suppressClick = g.cardId;
    clean();
    if (valid) submit(g.cardId);
  });
  const interrupted = event => { if (gesture?.pointerId === event.pointerId) cancel(); };
  document.addEventListener('pointercancel', interrupted);
  hand.addEventListener('lostpointercapture', interrupted);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') cancel(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  globalThis.addEventListener?.('blur', cancel);
  function cancel() {
    if (gesture?.ghost) suppressClick = gesture.cardId;
    clean();
  }
  return {
    cancel,
    validate() { if (gesture && (gesture.context !== context() || !canPlay(gesture.cardId))) cancel(); },
    consumeClick(cardId, detail) {
      const suppress = detail !== 0 && suppressClick === cardId;
      suppressClick = null;
      return suppress;
    },
  };
}
