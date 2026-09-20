import type {
  ChatMessage,
  ClientMessage,
  ErrorCode,
  Member,
  RoomState,
  RoomSummary,
  ServerMessage,
} from '@shared/protocol';
import type { RoomSettings } from '@shared/settings';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export type ClientError = { id: number; code: ErrorCode; message: string };

export type ClientState = {
  status: ConnectionStatus;
  you: Member | null;
  rooms: RoomSummary[];
  room: RoomState | null;
  /** 방장이 결과를 확정한 직후. 새 설정이나 섞기가 오기 전까지 결과 화면을 유지한다 */
  showingResult: boolean;
  lastError: ClientError | null;
};

const INITIAL: ClientState = {
  status: 'connecting',
  you: null,
  rooms: [],
  room: null,
  showingResult: false,
  lastError: null,
};

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const SETTINGS_DEBOUNCE_MS = 250;
const CLOCK_SAMPLES = 10;

type ClockSample = { rtt: number; offset: number };

/**
 * 서버와의 연결과 방 상태를 들고 있는 스토어. React에서는 useSyncExternalStore로 읽는다.
 * 방 상태는 서버가 보낸 메시지로만 바뀐다. 예외는 방장 본인의 설정 편집으로, 입력이 끊기지 않게 먼저 반영하고
 * 잠시 모아서 서버로 보낸다.
 */
export class RoomClient {
  private state: ClientState = INITIAL;
  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private settingsTimer: ReturnType<typeof setTimeout> | null = null;
  private clockSamples: ClockSample[] = [];
  private clockOffset = 0;
  private errorId = 0;
  private disposed = false;

  constructor(private url: string) {}

  // ---- 스토어 ----

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<ClientState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private setRoom(update: (room: RoomState) => RoomState, patch: Partial<ClientState> = {}) {
    if (!this.state.room) return;
    this.set({ room: update(this.state.room), ...patch });
  }

  /** 서버 시계 기준 현재 시각(ms) */
  serverNow = () => Date.now() + this.clockOffset;

  // ---- 연결 ----

  connect() {
    this.disposed = false;
    this.open();
  }

  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.ws?.close();
  }

  private open() {
    this.set({ status: 'connecting' });
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.set({ status: 'open' });
      this.startClockSync();
    };
    ws.onmessage = (event) => {
      try {
        this.receive(JSON.parse(event.data as string) as ServerMessage);
      } catch (e) {
        console.error('[net] bad message', e);
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      // 연결이 끊기면 서버는 이 참가자를 방에서 내보낸다. 로비로 돌아가 다시 시작한다
      this.set({
        ...INITIAL,
        status: 'closed',
        lastError: this.state.room ? this.makeError('invalid', '서버와의 연결이 끊겼습니다') : null,
      });
      if (this.disposed) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(this.retry++, RECONNECT_DELAYS_MS.length - 1)];
      this.reconnectTimer = setTimeout(() => this.open(), delay);
    };
  }

  private makeError(code: ErrorCode, message: string): ClientError {
    return { id: ++this.errorId, code, message };
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  // ---- 시계 동기화 ----

  /**
   * 서버 시각과의 차이를 잰다. 왕복이 가장 짧았던 표본이 가장 정확하다(양방향 지연이 대칭에 가깝다).
   * 모든 참가자가 같은 서버 시각 기준으로 시뮬레이션 스텝을 세므로 이 값이 곧 화면 동기화 정확도다.
   */
  private startClockSync() {
    this.clockSamples = [];
    const ping = () => this.send({ t: 'ping', clientTime: Date.now() });
    for (let i = 0; i < 5; i++) setTimeout(ping, i * 200);
    this.pingTimer = setInterval(ping, 10_000);
  }

  private onPong(clientTime: number, serverTime: number) {
    const now = Date.now();
    const rtt = now - clientTime;
    this.clockSamples.push({ rtt, offset: serverTime + rtt / 2 - now });
    if (this.clockSamples.length > CLOCK_SAMPLES) this.clockSamples.shift();
    const best = this.clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.clockOffset = best.offset;
  }

  // ---- 수신 ----

  private receive(message: ServerMessage) {
    switch (message.t) {
      case 'hello':
        this.set({ you: message.you });
        break;
      case 'pong':
        this.onPong(message.clientTime, message.serverTime);
        break;
      case 'rooms':
        this.set({ rooms: message.rooms });
        break;
      case 'joined':
        this.set({ room: message.room, showingResult: false });
        break;
      case 'left':
        this.set({ room: null, showingResult: false });
        break;
      case 'members':
        this.setRoom((room) => ({ ...room, members: message.members, hostId: message.hostId }));
        break;
      case 'settings':
        this.setRoom((room) => ({ ...room, settings: message.settings }), { showingResult: false });
        break;
      case 'seed':
        this.setRoom((room) => ({ ...room, seed: message.seed }), { showingResult: false });
        break;
      case 'race':
        this.setRoom((room) => ({ ...room, race: message.race }), { showingResult: false });
        break;
      case 'finished':
        this.setRoom((room) => ({ ...room, race: null, seed: message.nextSeed }), { showingResult: true });
        break;
      case 'chat':
        this.setRoom((room) => ({ ...room, chat: [...room.chat, message.message].slice(-200) }));
        break;
      case 'error':
        this.set({ lastError: this.makeError(message.code, message.message) });
        break;
    }
  }

  clearError() {
    this.set({ lastError: null });
  }

  // ---- 동작 ----

  createRoom(title: string, password: string) {
    this.send({ t: 'create', title, password });
  }

  joinRoom(roomId: string, password: string) {
    this.send({ t: 'join', roomId, password });
  }

  leaveRoom() {
    this.send({ t: 'leave' });
  }

  sendChat(text: string) {
    this.send({ t: 'chat', text });
  }

  shuffle() {
    this.send({ t: 'shuffle' });
    // 결과 화면을 바로 치우고 새 배치를 보여준다. 시드는 서버가 정해서 곧 돌려준다
    this.set({ showingResult: false });
  }

  start() {
    this.flushSettings();
    this.send({ t: 'start' });
  }

  reportFinished(winners: string[]) {
    this.send({ t: 'finished', winners });
  }

  /** 방장의 설정 편집. 화면에는 바로 반영하고 서버에는 입력이 멈춘 뒤 보낸다 */
  updateSettings(patch: Partial<RoomSettings>) {
    const room = this.state.room;
    if (!room) return;
    this.setRoom((r) => ({ ...r, settings: { ...r.settings, ...patch } }), { showingResult: false });
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => this.flushSettings(), SETTINGS_DEBOUNCE_MS);
  }

  private flushSettings() {
    if (!this.settingsTimer) return;
    clearTimeout(this.settingsTimer);
    this.settingsTimer = null;
    const room = this.state.room;
    if (room) this.send({ t: 'settings', settings: room.settings });
  }
}

export function defaultServerUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}/ws`;
}

export type { ChatMessage };
