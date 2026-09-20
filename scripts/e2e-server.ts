/**
 * 서버 프로토콜 E2E. 서버를 자식 프로세스로 띄우고 실제 WebSocket으로 붙는다.
 *
 *   yarn test:server
 */

import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../shared/protocol';
import { DEFAULT_SETTINGS } from '../shared/settings';

const PORT = 18787;

class Peer {
  ws: WebSocket;
  inbox: ServerMessage[] = [];
  waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  constructor() {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      const waiter = this.waiters.findIndex((w) => w.pred(message));
      if (waiter >= 0) this.waiters.splice(waiter, 1)[0].resolve(message);
      else this.inbox.push(message);
    });
  }

  open() {
    return new Promise<void>((resolve) => this.ws.once('open', () => resolve()));
  }

  send(message: ClientMessage) {
    this.ws.send(JSON.stringify(message));
  }

  /** 조건에 맞는 다음 메시지를 기다린다. 이미 받아 둔 것이 있으면 그걸 쓴다 */
  next<T extends ServerMessage['t']>(t: T, timeout = 2000): Promise<Extract<ServerMessage, { t: T }>> {
    const pred = (m: ServerMessage) => m.t === t;
    const idx = this.inbox.findIndex(pred);
    if (idx >= 0) return Promise.resolve(this.inbox.splice(idx, 1)[0] as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), timeout);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  async error() {
    return (await this.next('error')).code;
  }

  /** 잠시 기다려서 원치 않는 메시지가 없는지 확인할 때 쓴다 */
  drain() {
    this.inbox = [];
  }

  close() {
    this.ws.close();
  }
}

async function connect(): Promise<Peer> {
  const peer = new Peer();
  await peer.open();
  await peer.next('hello');
  return peer;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server: ChildProcess = spawn('node_modules/.bin/tsx', ['server/index.ts'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((resolve) =>
    server.stdout?.on('data', (d) => d.toString().includes('listening') && resolve())
  );

  const checks: string[] = [];
  const ok = (name: string) => {
    checks.push(name);
    console.log(`  ✓ ${name}`);
  };

  try {
    const host = await connect();
    const guest = await connect();

    // 방 만들기
    host.send({ t: 'create', title: '  ', password: '' });
    assert.equal(await host.error(), 'invalid');
    ok('빈 제목은 거부');

    host.send({ t: 'create', title: '테스트 방', password: 'secret' });
    const joined = await host.next('joined');
    assert.equal(joined.room.title, '테스트 방');
    assert.equal(joined.room.hostId, joined.room.members[0].id);
    ok('방 생성 시 방장으로 입장');

    // 로비 목록
    await sleep(300);
    guest.drain();
    guest.send({ t: 'leave' }); // 로비에서 목록을 새로 받는다
    const rooms = await guest.next('rooms');
    const summary = rooms.rooms.find((r) => r.id === joined.room.id);
    assert.ok(summary);
    assert.equal(summary.hasPassword, true);
    assert.equal(summary.memberCount, 1);
    assert.equal('password' in summary, false);
    ok('로비 목록에 방이 보이고 비밀번호는 노출되지 않음');

    // 입장
    guest.send({ t: 'join', roomId: joined.room.id, password: 'wrong' });
    assert.equal(await guest.error(), 'wrong_password');
    ok('틀린 비밀번호 거부');

    guest.send({ t: 'join', roomId: 'nope', password: '' });
    assert.equal(await guest.error(), 'room_not_found');
    ok('없는 방 거부');

    guest.send({ t: 'join', roomId: joined.room.id, password: 'secret' });
    const guestJoined = await guest.next('joined');
    assert.equal(guestJoined.room.members.length, 2);
    assert.notEqual(guestJoined.room.hostId, guestJoined.room.members[1].id);
    ok('맞는 비밀번호로 입장, 방장은 그대로');

    const members = await host.next('members');
    assert.equal(members.members.length, 2);
    ok('기존 참가자에게 입장 알림');

    // 권한
    guest.send({ t: 'start' });
    assert.equal(await guest.error(), 'not_host');
    guest.send({ t: 'settings', settings: DEFAULT_SETTINGS });
    assert.equal(await guest.error(), 'not_host');
    guest.send({ t: 'shuffle' });
    assert.equal(await guest.error(), 'not_host');
    ok('방장이 아니면 설정/시작/섞기 불가');

    // 설정
    host.send({ t: 'settings', settings: { ...DEFAULT_SETTINGS, names: 'a,b,c*3', stageIndex: 99 } });
    assert.equal(await host.error(), 'invalid');
    host.send({ t: 'settings', settings: { ...DEFAULT_SETTINGS, names: 'a,b,c*3' } });
    const settings = await guest.next('settings');
    assert.equal(settings.settings.names, 'a,b,c*3');
    ok('설정 검증과 전파');

    host.send({ t: 'settings', settings: { ...DEFAULT_SETTINGS, names: 'x*5000' } });
    assert.equal(await host.error(), 'invalid');
    ok('구슬 수 상한');

    // 채팅
    guest.drain();
    host.send({ t: 'chat', text: '안녕하세요' });
    const chat = await guest.next('chat');
    assert.equal(chat.message.text, '안녕하세요');
    assert.equal(chat.message.from?.id, joined.room.hostId);
    ok('채팅 전파');

    for (let i = 0; i < 6; i++) guest.send({ t: 'chat', text: `spam ${i}` });
    assert.equal(await guest.error(), 'rate_limited');
    ok('채팅 도배 제한');

    // 시작
    const before = Date.now();
    host.send({ t: 'start' });
    const raceHost = (await host.next('race')).race;
    const raceGuest = (await guest.next('race')).race;
    assert.deepEqual(raceHost, raceGuest);
    assert.ok(raceHost.startAt >= before + 2500, '카운트다운이 있어야 한다');
    assert.equal(raceHost.speed, 1);
    ok('시작 신호에 같은 시드와 시작 시각을 전달');

    host.send({ t: 'settings', settings: DEFAULT_SETTINGS });
    assert.equal(await host.error(), 'invalid');
    ok('진행 중에는 설정 변경 불가');

    host.send({ t: 'finished', winners: ['a'] }); // 카운트다운 중 보고는 무시된다
    await sleep(100);
    host.send({ t: 'shuffle' });
    assert.equal(await host.error(), 'invalid');
    ok('카운트다운 중 완료 보고는 무시');

    // 늦은 입장자는 진행 중인 레이스 정보를 받는다
    const late = await connect();
    late.send({ t: 'join', roomId: joined.room.id, password: 'secret' });
    const lateJoined = await late.next('joined');
    assert.deepEqual(lateJoined.room.race, raceHost);
    ok('중간 입장자가 진행 중인 레이스 정보를 받음');

    // 완료
    await sleep(raceHost.startAt - Date.now() + 100);
    guest.send({ t: 'finished', winners: ['a'] });
    assert.equal(await guest.error(), 'not_host');
    host.send({ t: 'finished', winners: ['a', 'b'] });
    const fin = await guest.next('finished');
    assert.deepEqual(fin.winners, ['a', 'b']);
    assert.equal(typeof fin.nextSeed, 'number');
    ok('방장의 완료 보고로 종료');

    // 방장 위임
    guest.drain();
    host.close();
    const handover = await guest.next('members');
    assert.equal(handover.members.length, 2);
    assert.equal(handover.hostId, guestJoined.room.members[1].id);
    ok('방장이 나가면 가장 오래된 참가자에게 위임');

    guest.send({ t: 'leave' });
    late.send({ t: 'leave' });
    await sleep(400);
    const lobby = await connect();
    const empty = await lobby.next('rooms');
    assert.equal(empty.rooms.length, 0);
    ok('모두 나가면 방이 사라짐');

    console.log(`\n${checks.length}개 통과`);
  } finally {
    server.kill();
  }
}

main().catch((e) => {
  console.error('\n실패:', e);
  process.exit(1);
});
