const $ = id => document.getElementById(id);
const storageKey = 'skull-king-session';
let token = sessionStorage.getItem(storageKey);
let state = null;
let busy = false;
const playerRows = new Map();
const invitedCode = new URL(location.href).searchParams.get('room');
if (invitedCode) $('code').value = invitedCode.slice(0, 6).toUpperCase();

async function api(path, body) {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error);
    error.status = response.status;
    throw error;
  }
  return result;
}

function show(next) {
  state = next;
  $('entry').hidden = Boolean(next);
  $('room').hidden = !next;
  if (!next) { playerRows.clear(); $('players').replaceChildren(); return; }
  $('room-code').textContent = next.code;
  $('count').textContent = `${next.players.length} / ${next.capacity}명 · 준비 ${next.players.filter(player => player.ready).length}명`;
  for (const [id, record] of playerRows) {
    if (!next.players.some(player => player.id === id)) { record.row.remove(); playerRows.delete(id); }
  }
  for (const player of next.players) {
    let record = playerRows.get(player.id);
    if (!record) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'player-name';
      const details = document.createElement('div');
      details.className = 'player-details';
      const status = document.createElement('small');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-bot';
      remove.dataset.botId = player.id;
      remove.textContent = '삭제';
      details.append(status, remove);
      row.append(name, details);
      record = { row, name, status, remove };
      playerRows.set(player.id, record);
      $('players').append(row);
    }
    record.name.textContent = `${player.name}${player.isBot ? ' · AI' : ''}${player.id === next.selfId ? ' (나)' : ''}${player.id === next.hostId ? ' · 방장' : ''}`;
    record.status.textContent = player.ready ? '준비 완료' : '대기 중';
    record.remove.hidden = !player.isBot || next.selfId !== next.hostId;
    record.remove.setAttribute('aria-label', `${player.name} 삭제`);
  }
  $('ai-controls').hidden = next.selfId !== next.hostId;
  $('ai-capacity').textContent = next.players.length >= next.capacity ? '정원이 가득 찼습니다.' : `AI 포함 최대 ${next.capacity}명`;
  $('ready').textContent = next.players.find(player => player.id === next.selfId)?.ready ? '준비 취소' : '준비하기';
  syncControls();
}

function syncControls() {
  document.querySelectorAll('button').forEach(button => { button.disabled = busy; });
  $('add-bot').disabled = busy || !state || state.selfId !== state.hostId || state.players.length >= state.capacity;
}

async function action(work) {
  if (busy) return;
  busy = true;
  syncControls();
  $('message').textContent = '';
  try { await work(); }
  catch (error) { $('message').textContent = error.name === 'TimeoutError' ? '응답이 지연되고 있습니다. 다시 시도해 주세요.' : error.message; }
  finally {
    busy = false;
    syncControls();
  }
}

async function enter(path) {
  const result = await api(path, { name: $('name').value, code: $('code').value });
  token = result.token;
  sessionStorage.setItem(storageKey, token);
  show(result.state);
}
$('create').addEventListener('click', () => action(() => enter('rooms')));
$('join-form').addEventListener('submit', event => { event.preventDefault(); action(() => enter('join')); });
$('add-bot').addEventListener('click', () => action(async () => {
  show(await api('bots/add', {}));
}));
$('players').addEventListener('click', event => {
  const remove = event.target.closest('button[data-bot-id]');
  if (remove) action(async () => { show(await api('bots/remove', { playerId: remove.dataset.botId })); });
});
$('ready').addEventListener('click', () => action(async () => {
  const self = state.players.find(player => player.id === state.selfId);
  show(await api('ready', { ready: !self.ready }));
}));
$('leave').addEventListener('click', () => action(async () => {
  await api('leave', {});
  token = null;
  sessionStorage.removeItem(storageKey);
  show(null);
}));
$('copy').addEventListener('click', () => action(async () => {
  const url = new URL(location.href);
  url.searchParams.set('room', state.code);
  try { await navigator.clipboard.writeText(url.href); $('message').textContent = '초대 링크를 복사했습니다.'; }
  catch { $('message').textContent = `방 코드 ${state.code}를 친구에게 알려주세요.`; }
}));

// The lobby polls once per second. Gameplay transport is a later development step.
async function refresh() {
  if (token && !busy) {
    const currentToken = token;
    try {
      const next = await api('state');
      if (currentToken === token && !busy) {
        show(next);
        if ($('message').dataset.connection === 'lost') {
          $('message').textContent = '서버에 다시 연결되었습니다.';
          delete $('message').dataset.connection;
        }
      }
    } catch (error) {
      if (currentToken === token && !busy) {
        if (error.status === 401) { token = null; sessionStorage.removeItem(storageKey); show(null); }
        $('message').textContent = error.status === 401 ? error.message : '서버 연결을 확인하고 있습니다. 잠시 기다려 주세요.';
        $('message').dataset.connection = 'lost';
      }
    }
  }
  setTimeout(refresh, 1000);
}
refresh();
