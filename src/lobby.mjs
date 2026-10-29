import { randomBytes, randomUUID } from 'node:crypto';
import { createGame, dealRound, bid, play, advanceTrick, chooseBid, choosePlay, gameView } from './game.mjs';

export const VACANT_ROOM_MS = 10 * 60_000;

export class Lobby {
  rooms = new Map();
  sessions = new Map();
  resumptions = new Map();

  ensureLobby(room) {
    if (room.game) throw new Error('게임 진행 중에는 참가자 구성을 바꿀 수 없습니다.');
  }

  name(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 20) {
      throw new Error('이름은 1~20자로 입력해 주세요.');
    }
    return value.trim();
  }

  create(name) {
    name = this.name(name);
    if (this.rooms.size >= 100) throw new Error('현재 만들 수 있는 방의 수를 초과했습니다.');
    let code;
    do { code = randomBytes(3).toString('hex').toUpperCase(); } while (this.rooms.has(code));
    const room = { code, hostId: null, players: [] };
    this.rooms.set(code, room);
    return this.enter(room, name);
  }

  join(code, name) {
    name = this.name(name);
    const room = this.rooms.get(String(code ?? '').trim().toUpperCase());
    if (!room) throw new Error('방을 찾을 수 없습니다. 방 코드를 확인해 주세요.');
    this.ensureLobby(room);
    if (room.players.length >= 8) throw new Error('방의 정원은 8명입니다.');
    if (room.players.some(player => player.name === name)) throw new Error('이미 사용 중인 이름입니다.');
    return this.enter(room, name);
  }

  enter(room, name) {
    const player = { id: randomUUID(), name, ready: false, isBot: false };
    const token = randomBytes(32).toString('hex');
    room.players.push(player);
    room.hostId ??= player.id;
    this.sessions.set(token, { room, player });
    const resumeToken = randomBytes(32).toString('hex');
    this.resumptions.set(resumeToken, { room, player, token });
    return { token, resumeToken, state: this.state(token) };
  }

  resume(resumeToken, now = Date.now()) {
    const record = this.resumptions.get(resumeToken);
    if (!record || this.rooms.get(record.room.code) !== record.room ||
        !record.room.players.includes(record.player) ||
        (record.room.vacantUntil != null && now >= record.room.vacantUntil)) {
      if (record && record.room.vacantUntil != null && now >= record.room.vacantUntil) this.removeRoom(record.room);
      const error = new Error('복귀할 자리가 만료되었습니다. 새 방에 참가해 주세요.');
      error.status = 401;
      throw error;
    }
    const { room, player } = record;
    // Rotate the active session so an old tab cannot also control this seat.
    this.sessions.delete(record.token);
    record.token = randomBytes(32).toString('hex');
    this.sessions.set(record.token, { room, player });
    player.isBot = false;
    delete player.departed;
    delete room.vacantUntil;
    room.hostId ??= player.id;
    return { token: record.token, resumeToken, state: this.state(record.token) };
  }

  removeRoom(room) {
    this.rooms.delete(room.code);
    for (const [key, record] of this.resumptions) {
      if (record.room === room) {
        this.sessions.delete(record.token);
        this.resumptions.delete(key);
      }
    }
  }

  forgetPlayer(player) {
    for (const [key, record] of this.resumptions) {
      if (record.player === player) {
        this.sessions.delete(record.token);
        this.resumptions.delete(key);
      }
    }
  }

  session(token) {
    const session = this.sessions.get(token);
    if (!session) {
      const error = new Error('참가 정보가 만료되었습니다. 다시 입장해 주세요.');
      error.status = 401;
      throw error;
    }
    return session;
  }

  state(token) {
    const { room, player } = this.session(token);
    const game = room.game ? gameView(room.game, player.id) : null;
    if (game) game.roundAdvance = this.roundAdvance(room, player.id);
    return {
      code: room.code, hostId: room.hostId, selfId: player.id,
      phase: room.game?.phase ?? 'lobby', capacity: 8,
      players: room.players.map(value => ({ ...value })),
      game,
    };
  }

  ready(token, ready) {
    if (typeof ready !== 'boolean') throw new Error('준비 상태가 올바르지 않습니다.');
    this.ensureLobby(this.session(token).room);
    this.session(token).player.ready = ready;
    return this.state(token);
  }

  hostSession(token) {
    const session = this.session(token);
    if (session.room.hostId !== session.player.id) {
      const error = new Error('방장만 할 수 있는 작업입니다.');
      error.status = 403;
      throw error;
    }
    return session;
  }

  addBot(token) {
    const { room } = this.hostSession(token);
    this.ensureLobby(room);
    if (room.players.length >= 8) throw new Error('방의 정원은 AI를 포함해 8명입니다.');
    let number = 1;
    while (room.players.some(player => player.name === `AI 선원 ${number}`)) number++;
    room.players.push({ id: randomUUID(), name: `AI 선원 ${number}`, ready: true, isBot: true });
    return this.state(token);
  }

  removeBot(token, playerId) {
    const { room } = this.hostSession(token);
    this.ensureLobby(room);
    const bot = room.players.find(player => player.id === playerId && player.isBot);
    if (!bot) throw new Error('삭제할 AI 플레이어를 찾을 수 없습니다.');
    room.players = room.players.filter(player => player.id !== bot.id);
    return this.state(token);
  }

  start(token, withBots = false, now = Date.now()) {
    const { room, player } = this.hostSession(token);
    this.ensureLobby(room);
    if (room.players.some(value => value.id !== player.id && !value.ready)) throw new Error('다른 참가자가 모두 준비해야 시작할 수 있습니다.');
    if (withBots === true) while (room.players.length < 4) this.addBot(token);
    if (room.players.length < 3) throw new Error('AI를 추가해 총 3명 이상으로 시작해 주세요.');
    room.game = createGame(room.players, now);
    player.ready = true;
    return this.state(token);
  }

  gameSession(token, input) {
    const session = this.session(token);
    const game = session.room.game;
    if (!game || input.gameId !== game.id || input.round !== game.round) throw new Error('게임 상태가 변경되었습니다. 최신 화면에서 다시 시도해 주세요.');
    return { ...session, game };
  }

  submitBid(token, input, now = Date.now()) {
    const { game, player } = this.gameSession(token, input);
    bid(game, player.id, input.bid, now);
    return this.state(token);
  }

  playCard(token, input, now = Date.now()) {
    const { game, player } = this.gameSession(token, input);
    if (input.trickNumber !== game.trickNumber) throw new Error('다음 트릭으로 넘어갔습니다. 카드를 다시 선택해 주세요.');
    play(game, player.id, input.cardId, input.mode, now);
    return this.state(token);
  }

  roundAdvance(room, playerId) {
    const game = room.game;
    if (game?.phase !== 'round-result') return null;
    const humans = room.players.filter(player => !player.isBot && !player.departed);
    const votes = new Set(game.roundSkips);
    return {
      deadlineAt: game.deadlineAt,
      eligibleCount: humans.length,
      requiredCount: Math.max(1, Math.ceil(humans.length * 2 / 3)),
      skippedCount: humans.filter(player => votes.has(player.id)).length,
      ownSkipped: votes.has(playerId),
    };
  }

  advanceRoundIfReady(room, now) {
    const progress = this.roundAdvance(room);
    if (progress && (now >= progress.deadlineAt || progress.skippedCount >= progress.requiredCount)) {
      dealRound(room.game, now);
    }
  }

  skipRound(token, input, now = Date.now()) {
    const { room, game, player } = this.gameSession(token, input);
    if (game.phase !== 'round-result') throw new Error('라운드 결과를 확인하는 동안에만 스킵할 수 있습니다.');
    if (player.isBot || player.departed) throw new Error('사람 참가자만 스킵할 수 있습니다.');
    if (!game.roundSkips.includes(player.id)) game.roundSkips.push(player.id);
    this.advanceRoundIfReady(room, now);
    return this.state(token);
  }

  // Older clients may still call this path; it cannot bypass the skip threshold.
  nextRound(token, input, now = Date.now()) { return this.skipRound(token, input, now); }

  returnToLobby(token, input) {
    this.hostSession(token);
    const { room, game } = this.gameSession(token, input);
    if (game.phase !== 'finished') throw new Error('게임 종료 후 대기실로 돌아갈 수 있습니다.');
    room.players.filter(player => player.departed).forEach(player => this.forgetPlayer(player));
    room.players = room.players.filter(player => !player.departed);
    room.game = null;
    room.players.forEach(player => { player.ready = player.isBot; });
    return this.state(token);
  }

  tick(now = Date.now()) {
    for (const room of this.rooms.values()) {
      if (room.vacantUntil != null && now >= room.vacantUntil) { this.removeRoom(room); continue; }
      const game = room.game;
      if (!game) continue;
      if (game.phase === 'bidding') {
        for (const player of room.players) {
          if (Object.hasOwn(game.bids, player.id)) continue;
          if ((player.isBot && now >= game.autoAt) || now >= game.deadlineAt) {
            bid(game, player.id, chooseBid(game.hands[player.id]), now, !player.isBot);
          }
        }
      } else if (game.phase === 'playing') {
        const player = room.players.find(value => value.id === game.turnId);
        if ((player.isBot && now >= game.autoAt) || now >= game.deadlineAt) {
          const card = choosePlay(game.hands[player.id], game.trick, game.won[player.id] < game.bids[player.id]);
          play(game, player.id, card.id, card.mode, now);
        }
      } else if (game.phase === 'trick-result' && now >= game.autoAt) advanceTrick(game, now);
      else if (game.phase === 'round-result') this.advanceRoundIfReady(room, now);
    }
  }

  leave(token, now = Date.now()) {
    const { room, player } = this.session(token);
    if (room.game) {
      player.isBot = true; player.departed = true; player.ready = true;
      room.game.roundSkips = room.game.roundSkips.filter(id => id !== player.id);
    } else {
      room.players = room.players.filter(value => value.id !== player.id);
      this.forgetPlayer(player);
    }
    this.sessions.delete(token);
    const humans = room.players.filter(value => !value.isBot);
    if (humans.length === 0) {
      if (room.game) { room.vacantUntil = now + VACANT_ROOM_MS; room.hostId = null; }
      else this.removeRoom(room);
    }
    else {
      if (room.hostId === player.id) room.hostId = humans[0].id;
      this.advanceRoundIfReady(room, now);
    }
  }
}
