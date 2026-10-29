const $ = id => document.getElementById(id);
const storageKey = 'skull-king-session';
let token = sessionStorage.getItem(storageKey);
let state = null;
let busy = false;
let lastPlayers = '';
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
  if (!next) { lastPlayers = ''; return; }
  $('room-code').textContent = next.code;
  $('count').textContent = `${next.players.length} / ${next.capacity}명 · 준비 ${next.players.filter(player => player.ready).length}명`;
  const signature = JSON.stringify([next.players, next.hostId, next.selfId]);
  if (signature !== lastPlayers) {
    lastPlayers = signature;
    const rows = next.players.map(player => {
      const row = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${player.name}${player.id === next.selfId ? ' (나)' : ''}${player.id === next.hostId ? ' · 방장' : ''}`;
      const status = document.createElement('small');
      status.textContent = player.ready ? '준비 완료' : '대기 중';
      row.append(name, status);
      return row;
    });
    $('players').replaceChildren(...rows);
  }
  $('ready').textContent = next.players.find(player => player.id === next.selfId)?.ready ? '준비 취소' : '준비하기';
}

async function action(work) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  $('message').textContent = '';
  try { await work(); }
  catch (error) { $('message').textContent = error.name === 'TimeoutError' ? '응답이 지연되고 있습니다. 다시 시도해 주세요.' : error.message; }
  finally {
    busy = false;
    document.querySelectorAll('button').forEach(button => { button.disabled = false; });
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
