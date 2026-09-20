import type { RoomSettings } from './settings';

export const MAX_TITLE_LENGTH = 40;
export const MAX_PASSWORD_LENGTH = 32;
export const MAX_CHAT_LENGTH = 300;
export const MAX_MEMBERS = 30;

export type Member = {
  id: string;
  /** 서버가 정해주는 무작위 닉네임 */
  nickname: string;
};

export type ChatMessage = {
  id: number;
  /** null이면 시스템 메시지 */
  from: Member | null;
  text: string;
  at: number;
};

/** 로비에 보이는 방 정보 */
export type RoomSummary = {
  id: string;
  title: string;
  hasPassword: boolean;
  memberCount: number;
  maxMembers: number;
  racing: boolean;
  hostNickname: string;
};

/** 진행 중인 레이스. 이것만 있으면 누구든 처음부터 다시 계산해 같은 화면을 얻는다 */
export type RaceInfo = {
  seed: number;
  settings: RoomSettings;
  /** 서버 시계 기준 시작 시각(ms) */
  startAt: number;
  speed: number;
};

export type RoomState = {
  id: string;
  title: string;
  hostId: string;
  members: Member[];
  settings: RoomSettings;
  /** 시작 전 미리보기에 쓰는 시드 */
  seed: number;
  race: RaceInfo | null;
  chat: ChatMessage[];
};

export type ErrorCode =
  | 'wrong_password'
  | 'room_not_found'
  | 'room_full'
  | 'not_host'
  | 'invalid'
  | 'rate_limited'
  | 'too_many_rooms'
  | 'not_in_room';

export type ClientMessage =
  | { t: 'ping'; clientTime: number }
  | { t: 'create'; title: string; password: string }
  | { t: 'join'; roomId: string; password: string }
  | { t: 'leave' }
  | { t: 'chat'; text: string }
  | { t: 'settings'; settings: RoomSettings }
  | { t: 'shuffle' }
  | { t: 'start' }
  | { t: 'finished'; winners: string[] };

export type ServerMessage =
  | { t: 'hello'; you: Member }
  | { t: 'pong'; clientTime: number; serverTime: number }
  | { t: 'rooms'; rooms: RoomSummary[] }
  | { t: 'joined'; room: RoomState }
  | { t: 'left' }
  | { t: 'members'; members: Member[]; hostId: string }
  | { t: 'settings'; settings: RoomSettings }
  | { t: 'seed'; seed: number }
  | { t: 'race'; race: RaceInfo }
  | { t: 'finished'; winners: string[]; nextSeed: number }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'error'; code: ErrorCode; message: string };
