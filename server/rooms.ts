import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  type ChatMessage,
  type ClientMessage,
  type ErrorCode,
  MAX_CHAT_LENGTH,
  MAX_MEMBERS,
  MAX_PASSWORD_LENGTH,
  MAX_TITLE_LENGTH,
  type Member,
  type RaceInfo,
  type RoomState,
  type RoomSummary,
  type ServerMessage,
} from '../shared/protocol';
import { countMarbles, DEFAULT_SETTINGS, type RoomSettings, splitNames, validateSettings } from '../shared/settings';
import { stages } from '../src/data/maps';

/** 시작 신호를 받고 실제로 굴러가기까지의 여유. 모든 참가자가 이 사이에 준비를 끝낸다 */
export const COUNTDOWN_MS = 3000;
const MAX_ROOMS = 200;
const CHAT_HISTORY = 100;
/** 방장이 결과를 보고하지 않아도 이 시간이 지나면 레이스를 끝난 것으로 본다 */
const RACE_TIMEOUT_MS = 30 * 60 * 1000;
const CHAT_WINDOW_MS = 5000;
const CHAT_LIMIT = 5;
const JOIN_FAIL_LIMIT = 5;
const JOIN_FAIL_WINDOW_MS = 60_000;

const NICK_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomNickname(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += NICK_CHARS[randomInt(NICK_CHARS.length)];
  return s;
}

function randomSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}

/** 한 연결. 소켓 종류와 무관하게 send만 알면 된다 */
export type Client = {
  member: Member;
  send: (message: ServerMessage) => void;
  roomId: string | null;
  chatTimes: number[];
  joinFailures: number[];
};

type Room = {
  id: string;
  title: string;
  password: { salt: Buffer; hash: Buffer } | null;
  hostId: string;
  members: Map<string, Client>;
  settings: RoomSettings;
  seed: number;
  race: RaceInfo | null;
  raceTimer: ReturnType<typeof setTimeout> | null;
  chat: ChatMessage[];
  nextChatId: number;
};

export class RoomManager {
  private rooms = new Map<string, Room>();
  private clients = new Set<Client>();
  private lobbyTimer: ReturnType<typeof setTimeout> | null = null;

  addClient(send: (message: ServerMessage) => void): Client {
    const client: Client = {
      member: { id: randomBytes(8).toString('hex'), nickname: randomNickname() },
      send,
      roomId: null,
      chatTimes: [],
      joinFailures: [],
    };
    this.clients.add(client);
    client.send({ t: 'hello', you: client.member });
    client.send({ t: 'rooms', rooms: this.summaries() });
    return client;
  }

  removeClient(client: Client): void {
    this.leaveRoom(client);
    this.clients.delete(client);
  }

  handle(client: Client, message: ClientMessage): void {
    switch (message.t) {
      case 'ping':
        if (typeof message.clientTime === 'number') {
          client.send({ t: 'pong', clientTime: message.clientTime, serverTime: Date.now() });
        }
        return;
      case 'create':
        this.createRoom(client, message.title, message.password);
        return;
      case 'join':
        this.joinRoom(client, message.roomId, message.password);
        return;
      case 'leave':
        this.leaveRoom(client);
        client.send({ t: 'left' });
        client.send({ t: 'rooms', rooms: this.summaries() });
        return;
      case 'chat':
        this.chat(client, message.text);
        return;
      case 'settings':
        this.updateSettings(client, message.settings);
        return;
      case 'shuffle':
        this.shuffle(client);
        return;
      case 'start':
        this.startRace(client);
        return;
      case 'finished':
        this.finishRace(client, message.winners);
        return;
      default:
        this.error(client, 'invalid', '알 수 없는 요청입니다');
        return;
    }
  }

  // ---- 방 목록 ----

  summaries(): RoomSummary[] {
    return [...this.rooms.values()]
      .map((room) => ({
        id: room.id,
        title: room.title,
        hasPassword: room.password !== null,
        memberCount: room.members.size,
        maxMembers: MAX_MEMBERS,
        racing: room.race !== null,
        hostNickname: room.members.get(room.hostId)?.member.nickname ?? '',
      }))
      .reverse();
  }

  /** 방이 생기고 사라지거나 인원이 바뀔 때 로비에 있는 사람들에게 알린다. 짧은 시간에 몰리면 한 번만 보낸다 */
  private scheduleLobbyBroadcast(): void {
    if (this.lobbyTimer) return;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      const rooms = this.summaries();
      for (const client of this.clients) {
        if (client.roomId === null) client.send({ t: 'rooms', rooms });
      }
    }, 150);
  }

  // ---- 방 생성/입장/퇴장 ----

  private createRoom(client: Client, titleRaw: unknown, passwordRaw: unknown) {
    if (client.roomId) return this.error(client, 'invalid', '이미 방에 들어와 있습니다');
    const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
    const password = typeof passwordRaw === 'string' ? passwordRaw : '';
    if (!title || title.length > MAX_TITLE_LENGTH) {
      return this.error(client, 'invalid', `방 제목은 1~${MAX_TITLE_LENGTH}자로 입력해주세요`);
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
      return this.error(client, 'invalid', `비밀번호는 ${MAX_PASSWORD_LENGTH}자 이하로 입력해주세요`);
    }
    if (this.rooms.size >= MAX_ROOMS)
      return this.error(client, 'too_many_rooms', '지금은 더 이상 방을 만들 수 없습니다');

    const room: Room = {
      id: randomBytes(6).toString('hex'),
      title,
      password: null,
      hostId: client.member.id,
      members: new Map(),
      settings: { ...DEFAULT_SETTINGS },
      seed: randomSeed(),
      race: null,
      raceTimer: null,
      chat: [],
      nextChatId: 1,
    };
    if (password) {
      const salt = randomBytes(16);
      room.password = { salt, hash: hashPassword(password, salt) };
    }
    this.rooms.set(room.id, room);
    this.enter(room, client);
  }

  private joinRoom(client: Client, roomId: unknown, passwordRaw: unknown) {
    if (client.roomId) return this.error(client, 'invalid', '이미 방에 들어와 있습니다');
    const room = typeof roomId === 'string' ? this.rooms.get(roomId) : undefined;
    if (!room) return this.error(client, 'room_not_found', '방을 찾을 수 없습니다');

    if (room.password) {
      const now = Date.now();
      client.joinFailures = client.joinFailures.filter((t) => now - t < JOIN_FAIL_WINDOW_MS);
      if (client.joinFailures.length >= JOIN_FAIL_LIMIT) {
        return this.error(client, 'rate_limited', '비밀번호를 너무 많이 틀렸습니다. 잠시 후 다시 시도해주세요');
      }
      const password = typeof passwordRaw === 'string' ? passwordRaw : '';
      const ok =
        password.length <= MAX_PASSWORD_LENGTH &&
        timingSafeEqual(hashPassword(password, room.password.salt), room.password.hash);
      if (!ok) {
        client.joinFailures.push(now);
        return this.error(client, 'wrong_password', '비밀번호가 맞지 않습니다');
      }
    }
    if (room.members.size >= MAX_MEMBERS) return this.error(client, 'room_full', '방이 가득 찼습니다');
    this.enter(room, client);
  }

  private enter(room: Room, client: Client): void {
    room.members.set(client.member.id, client);
    client.roomId = room.id;
    client.send({ t: 'joined', room: this.state(room) });
    this.systemChat(room, `${client.member.nickname}님이 입장했습니다`);
    this.broadcast(room, { t: 'members', members: this.members(room), hostId: room.hostId }, client);
    this.scheduleLobbyBroadcast();
  }

  private leaveRoom(client: Client): void {
    const room = client.roomId ? this.rooms.get(client.roomId) : undefined;
    client.roomId = null;
    if (!room) return;

    room.members.delete(client.member.id);
    if (room.members.size === 0) {
      if (room.raceTimer) clearTimeout(room.raceTimer);
      this.rooms.delete(room.id);
    } else {
      if (room.hostId === client.member.id) {
        // 가장 먼저 들어온 사람에게 방장을 넘긴다 (Map은 삽입 순서를 유지한다)
        const next = room.members.values().next().value as Client;
        room.hostId = next.member.id;
        this.systemChat(room, `${next.member.nickname}님이 새 방장이 되었습니다`);
      }
      this.systemChat(room, `${client.member.nickname}님이 나갔습니다`);
      this.broadcast(room, { t: 'members', members: this.members(room), hostId: room.hostId });
    }
    this.scheduleLobbyBroadcast();
  }

  // ---- 채팅 ----

  private chat(client: Client, textRaw: unknown) {
    const room = this.roomOf(client);
    if (!room) return this.error(client, 'not_in_room', '방에 들어가 있지 않습니다');
    // 제어 문자를 공백으로 바꾼다. 채팅은 React가 텍스트로 그리므로 HTML 이스케이프는 필요 없다
    const text = (typeof textRaw === 'string' ? textRaw : '')
      .split('')
      .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
      .join('')
      .trim();
    if (!text) return;
    if (text.length > MAX_CHAT_LENGTH)
      return this.error(client, 'invalid', `채팅은 ${MAX_CHAT_LENGTH}자까지 가능합니다`);

    const now = Date.now();
    client.chatTimes = client.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
    if (client.chatTimes.length >= CHAT_LIMIT) {
      return this.error(client, 'rate_limited', '메시지를 너무 빠르게 보내고 있습니다');
    }
    client.chatTimes.push(now);
    this.pushChat(room, client.member, text);
  }

  private systemChat(room: Room, text: string): void {
    this.pushChat(room, null, text);
  }

  private pushChat(room: Room, from: Member | null, text: string): void {
    const message: ChatMessage = { id: room.nextChatId++, from, text, at: Date.now() };
    room.chat.push(message);
    if (room.chat.length > CHAT_HISTORY) room.chat.shift();
    this.broadcast(room, { t: 'chat', message });
  }

  // ---- 방장 전용 ----

  private hostRoom(client: Client): Room | null {
    const room = this.roomOf(client);
    if (!room) {
      this.error(client, 'not_in_room', '방에 들어가 있지 않습니다');
      return null;
    }
    if (room.hostId !== client.member.id) {
      this.error(client, 'not_host', '방장만 할 수 있습니다');
      return null;
    }
    return room;
  }

  private updateSettings(client: Client, settings: unknown) {
    const room = this.hostRoom(client);
    if (!room) return;
    if (room.race) return this.error(client, 'invalid', '진행 중에는 설정을 바꿀 수 없습니다');
    const problem = validateSettings(settings, stages.length);
    if (problem) return this.error(client, 'invalid', problem);
    room.settings = settings as RoomSettings;
    this.broadcast(room, { t: 'settings', settings: room.settings }, client);
  }

  private shuffle(client: Client) {
    const room = this.hostRoom(client);
    if (!room) return;
    if (room.race) return this.error(client, 'invalid', '진행 중에는 섞을 수 없습니다');
    room.seed = randomSeed();
    this.broadcast(room, { t: 'seed', seed: room.seed });
  }

  private startRace(client: Client) {
    const room = this.hostRoom(client);
    if (!room) return;
    if (room.race) return this.error(client, 'invalid', '이미 진행 중입니다');
    if (countMarbles(splitNames(room.settings.names)) < 1) {
      return this.error(client, 'invalid', '참가자를 한 명 이상 입력해주세요');
    }

    room.race = {
      // 시작할 때마다 시드를 새로 뽑는다. 미리보기 배치와는 별개의 라운드다
      seed: randomSeed(),
      settings: { ...room.settings },
      startAt: Date.now() + COUNTDOWN_MS,
      speed: room.settings.fastForward ? 2 : 1,
    };
    room.raceTimer = setTimeout(() => this.endRace(room, []), RACE_TIMEOUT_MS);
    this.broadcast(room, { t: 'race', race: room.race });
    this.scheduleLobbyBroadcast();
  }

  private finishRace(client: Client, winnersRaw: unknown) {
    const room = this.hostRoom(client);
    if (!room || !room.race) return;
    // 카운트다운이 끝나기 전에 들어온 보고는 잘못된 것이다
    if (Date.now() < room.race.startAt) return;
    const winners = Array.isArray(winnersRaw)
      ? winnersRaw.filter((w): w is string => typeof w === 'string').slice(0, 1000)
      : [];
    this.endRace(
      room,
      winners.map((w) => w.slice(0, 60))
    );
  }

  private endRace(room: Room, winners: string[]): void {
    if (!room.race) return;
    if (room.raceTimer) clearTimeout(room.raceTimer);
    room.raceTimer = null;
    room.race = null;
    room.seed = randomSeed();
    this.broadcast(room, { t: 'finished', winners, nextSeed: room.seed });
    if (winners.length > 0) {
      const shown = winners.slice(0, 20).join(', ');
      this.systemChat(room, `당첨: ${shown}${winners.length > 20 ? ` 외 ${winners.length - 20}명` : ''}`);
    }
    this.scheduleLobbyBroadcast();
  }

  // ---- 공통 ----

  private roomOf(client: Client): Room | undefined {
    return client.roomId ? this.rooms.get(client.roomId) : undefined;
  }

  private members(room: Room): Member[] {
    return [...room.members.values()].map((c) => c.member);
  }

  private state(room: Room): RoomState {
    return {
      id: room.id,
      title: room.title,
      hostId: room.hostId,
      members: this.members(room),
      settings: room.settings,
      seed: room.seed,
      race: room.race,
      chat: room.chat,
    };
  }

  private broadcast(room: Room, message: ServerMessage, except?: Client): void {
    for (const client of room.members.values()) {
      if (client !== except) client.send(message);
    }
  }

  private error(client: Client, code: ErrorCode, message: string): void {
    client.send({ t: 'error', code, message });
  }

  /** 테스트와 종료 처리에서 타이머를 정리한다 */
  dispose(): void {
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    for (const room of this.rooms.values()) {
      if (room.raceTimer) clearTimeout(room.raceTimer);
    }
  }
}
