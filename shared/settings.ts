import { parseName } from '../src/utils/utils';

/** 방장이 정하는 룰렛 설정. 방의 모든 참가자에게 그대로 전달된다 */
export type WinnerMode = 'first' | 'last' | 'custom' | 'multi';

export type RoomSettings = {
  /** 쉼표나 줄바꿈으로 구분한 참가자 입력 ("이름/가중치*개수") */
  names: string;
  stageIndex: number;
  winnerMode: WinnerMode;
  /** custom 모드의 순위 (1부터) */
  rank: number;
  /** multi 모드의 범위 (1부터, 양끝 포함) */
  rangeStart: number;
  rangeEnd: number;
  useSkills: boolean;
  /** 2배속 */
  fastForward: boolean;
};

export const DEFAULT_SETTINGS: RoomSettings = {
  names: '',
  stageIndex: 0,
  winnerMode: 'first',
  rank: 1,
  rangeStart: 1,
  rangeEnd: 3,
  useSkills: true,
  fastForward: false,
};

/** 한 라운드의 구슬 수 상한. 넘으면 느린 기기가 따라오지 못한다 */
export const MAX_MARBLES = 1000;
export const MAX_NAMES_LENGTH = 20000;

export function splitNames(text: string): string[] {
  return text
    .split(/[,\r\n]/g)
    .map((v) => v.trim())
    .filter((v) => !!v);
}

export function countMarbles(names: string[]): number {
  let total = 0;
  for (const raw of names) {
    const parsed = parseName(raw);
    if (parsed) total += parsed.count;
  }
  return total;
}

/** 같은 이름을 "이름*개수"로 합친다. 가중치가 다르면 다른 항목으로 본다 */
export function normalizeNames(text: string): string {
  const counts = new Map<string, number>();
  for (const raw of splitNames(text)) {
    const parsed = parseName(raw);
    if (!parsed) continue;
    const key = parsed.weight > 1 ? `${parsed.name}/${parsed.weight}` : parsed.name;
    counts.set(key, (counts.get(key) ?? 0) + parsed.count);
  }
  return [...counts.entries()].map(([key, count]) => (count > 1 ? `${key}*${count}` : key)).join(',');
}

/** 설정과 실제 구슬 수로부터 당첨 범위(0부터, 양끝 포함)를 정한다 */
export function resolveWinnerRange(settings: RoomSettings, marbleCount: number): { start: number; end: number } {
  const last = Math.max(0, marbleCount - 1);
  const clamp = (v: number) => Math.min(Math.max(0, Math.floor(v) - 1), last);
  switch (settings.winnerMode) {
    case 'first':
      return { start: 0, end: 0 };
    case 'last':
      return { start: last, end: last };
    case 'multi': {
      const start = clamp(settings.rangeStart);
      const end = Math.max(start, clamp(settings.rangeEnd));
      return { start, end };
    }
    default: {
      const rank = clamp(settings.rank);
      return { start: rank, end: rank };
    }
  }
}

/** 서버와 클라이언트가 같은 기준으로 설정을 검증한다. 문제가 있으면 사유를 돌려준다 */
export function validateSettings(value: unknown, stageCount: number): string | null {
  if (typeof value !== 'object' || value === null) return '설정 형식이 올바르지 않습니다';
  const s = value as Record<string, unknown>;
  if (typeof s.names !== 'string' || s.names.length > MAX_NAMES_LENGTH) return '참가자 목록이 너무 깁니다';
  if (countMarbles(splitNames(s.names)) > MAX_MARBLES) return `구슬은 최대 ${MAX_MARBLES}개까지 가능합니다`;
  if (!Number.isInteger(s.stageIndex) || (s.stageIndex as number) < 0 || (s.stageIndex as number) >= stageCount) {
    return '존재하지 않는 맵입니다';
  }
  if (!['first', 'last', 'custom', 'multi'].includes(s.winnerMode as string)) return '당첨 방식이 올바르지 않습니다';
  for (const key of ['rank', 'rangeStart', 'rangeEnd'] as const) {
    if (!Number.isInteger(s[key]) || (s[key] as number) < 1 || (s[key] as number) > MAX_MARBLES) {
      return '당첨 순위가 올바르지 않습니다';
    }
  }
  if (typeof s.useSkills !== 'boolean' || typeof s.fastForward !== 'boolean') return '설정 형식이 올바르지 않습니다';
  return null;
}
