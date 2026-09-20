import type { RoomState } from '@shared/protocol';
import { countMarbles, type RoomSettings, resolveWinnerRange, splitNames } from '@shared/settings';
import { useEffect, useRef } from 'react';
import { useClient, useClientState } from '@/net/useRoomClient';
import type { Roulette } from '@/roulette';

/** 방 설정 + 시드로 룰렛 상태를 만든다. 같은 입력이면 참가자 누구의 화면에서든 같은 배치가 된다 */
function applyToRoulette(roulette: Roulette, seed: number, settings: RoomSettings) {
  const names = splitNames(settings.names);
  roulette.applySetup({
    seed,
    names,
    stageIndex: settings.stageIndex,
    winnerRange: resolveWinnerRange(settings, countMarbles(names)),
    useSkills: settings.useSkills,
  });
}

/**
 * 서버에서 받은 방 상태를 룰렛에 반영한다.
 * - 레이스가 없으면 설정을 미리보기로 보여준다 (방장이 고치는 동안 바로바로).
 * - 레이스가 시작되면 같은 시드로 처음부터 세팅하고, 서버 시계에 맞춰 시작한다.
 *   중간에 들어온 사람은 이미 지난 시간만큼 빠르게 따라잡는다.
 * - 방장이 결과를 확정한 직후에는 결과 화면을 그대로 둔다.
 */
export function useRoomSync(roulette: Roulette | null, room: RoomState, isHost: boolean) {
  const client = useClient();
  const { showingResult } = useClientState();
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const { race, seed, settings } = room;
  const settingsKey = JSON.stringify(settings);

  // race, settings 객체가 아니라 그 값을 대표하는 키를 의존성으로 쓴다. 참조가 바뀌어도 내용이 같으면 다시 만들지 않는다
  // biome-ignore lint/correctness/useExhaustiveDependencies: 위 이유로 세부 값 대신 키를 쓴다
  useEffect(() => {
    if (!roulette) return;

    if (race) {
      applyToRoulette(roulette, race.seed, race.settings);
      roulette.startRace({ now: client.serverNow, startAt: race.startAt, speed: race.speed });
      return;
    }
    if (showingResult) return;

    // 설정을 타이핑하는 동안 매 글자마다 월드를 다시 만들지 않도록 잠깐 모은다
    const timer = setTimeout(() => applyToRoulette(roulette, seed, settings), 150);
    return () => clearTimeout(timer);
  }, [roulette, client, race?.startAt, race?.seed, showingResult, seed, settingsKey]);

  useEffect(() => {
    if (!roulette) return;
    const onGoal = (e: Event) => {
      // 결과 보고는 방장만 한다. 참가자 전원의 화면에서 같은 결과가 나오므로 한 명이면 충분하다
      if (isHostRef.current) client.reportFinished((e as CustomEvent<{ winners: string[] }>).detail.winners);
    };
    roulette.addEventListener('goal', onGoal);
    return () => roulette.removeEventListener('goal', onGoal);
  }, [roulette, client]);
}
