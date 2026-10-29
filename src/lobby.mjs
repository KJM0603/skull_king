import { randomBytes, randomUUID } from 'node:crypto';

export class Lobby {
  rooms = new Map();
  sessions = new Map();

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
    if (room.players.length >= 8) throw new Error('방의 정원은 8명입니다.');
    if (room.players.some(player => player.name === name)) throw new Error('이미 사용 중인 이름입니다.');
    return this.enter(room, name);
  }

  enter(room, name) {
    const player = { id: randomUUID(), name, ready: false };
    const token = randomBytes(32).toString('hex');
    room.players.push(player);
    room.hostId ??= player.id;
    this.sessions.set(token, { room, player });
    return { token, state: this.state(token) };
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
    return {
      code: room.code, hostId: room.hostId, selfId: player.id,
      phase: 'lobby', capacity: 8,
      players: room.players.map(value => ({ ...value })),
    };
  }

  ready(token, ready) {
    if (typeof ready !== 'boolean') throw new Error('준비 상태가 올바르지 않습니다.');
    this.session(token).player.ready = ready;
    return this.state(token);
  }

  leave(token) {
    const { room, player } = this.session(token);
    room.players = room.players.filter(value => value.id !== player.id);
    this.sessions.delete(token);
    if (room.players.length === 0) this.rooms.delete(room.code);
    else if (room.hostId === player.id) room.hostId = room.players[0].id;
  }
}
