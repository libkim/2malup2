import { Skills, zoomThreshold } from './data/constants';
import { type StageDef, stages } from './data/maps';
import type { IPhysics } from './IPhysics';
import { Marble } from './marble';
import type { WinnerRange } from './options';
import { setSeed } from './utils/random';
import { parseName, shuffle } from './utils/utils';

/** 시뮬레이션 1스텝이 나타내는 시간. 모든 참가자가 같아야 한다 */
export const STEP_MS = 10;
/** 골인한 구슬의 물리 몸체는 이 스텝 수만큼 더 남겨둔다 */
const REMOVE_DELAY_STEPS = 50;

/** 입력 범위를 실제 구슬 수에 맞춰 자른다. 범위를 넘기면 뒤쪽이 잘린다 */
export function clipWinnerRange({ start, end }: WinnerRange, marbleCount: number): WinnerRange {
  const last = Math.max(0, marbleCount - 1);
  const clippedStart = Math.min(Math.max(0, start), last);
  return { start: clippedStart, end: Math.min(Math.max(clippedStart, end), last) };
}

export type SimSetup = {
  seed: number;
  /** "이름/가중치*개수" 형식의 입력 그대로 */
  names: string[];
  stageIndex: number;
  winnerRange: WinnerRange;
};

export type SimEvents = {
  /** 당첨 순위의 구슬이 골인했다 (축하 연출용) */
  onWinningGoal?: () => void;
  /** 스킬 발동 (이펙트 연출용) */
  onSkill?: (marble: Marble) => void;
  /** 당첨자가 모두 확정됐다 */
  onFinish?: (winners: Marble[]) => void;
};

/**
 * 렌더링과 무관한 게임 로직. DOM 없이 돌아가므로 Node에서 결정론을 검증할 수 있다.
 *
 * 같은 setup으로 같은 횟수만큼 step()을 부르면 누가 언제 어디서 돌려도 결과가 같아야 한다.
 * 그래서 이 안에서는 벽시계(Date, setTimeout)를 쓰지 않고, 난수는 utils/random만 쓴다.
 */
export class Simulation {
  marbles: Marble[] = [];
  winners: Marble[] = [];
  /** 진행 중에는 null, 당첨자가 모두 확정되면 당첨자 배열 */
  result: Marble[] | null = null;
  stage: StageDef = stages[0];
  winnerRange: WinnerRange = { start: 0, end: 0 };
  isRunning = false;
  goalDist = Infinity;
  timeScale = 1;
  stepCount = 0;
  /** 결과가 확정된 스텝. 참가자마다 같아야 한다 (동기화 검증용) */
  finishStep: number | null = null;
  events: SimEvents = {};

  private pendingRemovals: { atStep: number; id: number }[] = [];

  constructor(private physics: IPhysics) {}

  setup({ seed, names, stageIndex, winnerRange }: SimSetup): void {
    setSeed(seed);
    this.physics.resetWorld();
    this.stage = stages[stageIndex] ?? stages[0];
    this.physics.createStage(this.stage);

    this.marbles = [];
    this.winners = [];
    this.result = null;
    this.isRunning = false;
    this.goalDist = Infinity;
    this.timeScale = 1;
    this.stepCount = 0;
    this.finishStep = null;
    this.pendingRemovals = [];

    this.createMarbles(names);
    this.winnerRange = clipWinnerRange(winnerRange, this.marbles.length);
  }

  private createMarbles(names: string[]): void {
    let maxWeight = -Infinity;
    let minWeight = Infinity;

    const members = names
      .map((nameString) => {
        const parsed = parseName(nameString);
        if (!parsed) return null;
        if (parsed.weight > maxWeight) maxWeight = parsed.weight;
        if (parsed.weight < minWeight) minWeight = parsed.weight;
        return { ...parsed };
      })
      .filter((member) => !!member);

    const gap = maxWeight - minWeight;

    let totalCount = 0;
    for (const member of members) {
      member.weight = 0.1 + (gap ? (member.weight - minWeight) / gap : 0);
      totalCount += member.count;
    }

    const orders = shuffle(Array.from({ length: totalCount }, (_, i) => i));
    for (const member of members) {
      for (let j = 0; j < member.count; j++) {
        const order = orders.pop() || 0;
        this.marbles.push(new Marble(this.physics, order, totalCount, member.name, member.weight));
      }
    }
  }

  start(): void {
    this.isRunning = true;
    this.winnerRange = clipWinnerRange(this.winnerRange, this.marbles.length);
    this.physics.start();
    for (const marble of this.marbles) marble.isActive = true;
  }

  step(): void {
    this.physics.step((STEP_MS / 1000) * this.timeScale);
    this.stepCount++;

    // 정렬은 스텝마다 한다. 프레임마다 하면 프레임 속도에 따라 순회 순서가 달라지고,
    // 그 순서대로 난수를 뽑으므로 참가자마다 결과가 갈린다
    this.sortMarblesByY();
    this.updateMarbles();
    this.removeFinishedBodies();
  }

  private sortMarblesByY(): void {
    if (this.marbles.length < 2) return;
    // 비교 함수 안에서 물리 좌표를 읽으면 wasm 호출이 비교 횟수만큼 생긴다. y를 한 번만 읽는다
    const keyed = this.marbles.map((marble) => ({ marble, y: marble.y }));
    keyed.sort((a, b) => b.y - a.y);
    this.marbles = keyed.map((entry) => entry.marble);
  }

  private updateMarbles(): void {
    // 이 스텝의 timeScale은 스텝 시작값으로 고정한다.
    // 구슬 정지 판정도 같은 값을 써야 실제 진행된 물리 시간과 맞는다
    const timeScale = this.timeScale;

    for (const marble of this.marbles) {
      marble.update(STEP_MS, timeScale);
      if (marble.skill === Skills.Impact) {
        this.events.onSkill?.(marble);
        this.physics.impact(marble.id);
      }
      if (marble.y > this.stage.goalY) {
        this.winners.push(marble);
        if (this.isRunning && this.isWinningRank(this.winners.length - 1)) {
          this.events.onWinningGoal?.();
        }
        this.pendingRemovals.push({ atStep: this.stepCount + REMOVE_DELAY_STEPS, id: marble.id });
      }
    }

    const targetIndex = this.targetIndex;
    const topY = this.marbles[targetIndex] ? this.marbles[targetIndex].y : 0;
    this.goalDist = Math.abs(this.stage.zoomY - topY);
    this.timeScale = this.calcTimeScale();

    this.marbles = this.marbles.filter((marble) => marble.y <= this.stage.goalY);

    this.checkFinish();
  }

  private removeFinishedBodies(): void {
    while (this.pendingRemovals.length > 0 && this.pendingRemovals[0].atStep <= this.stepCount) {
      const removal = this.pendingRemovals.shift();
      if (removal) this.physics.removeMarble(removal.id);
    }
  }

  /** 카메라와 슬로우모션이 주목할 구슬 = 당첨 커트라인에 걸쳐있는 구슬 */
  get targetIndex(): number {
    return this.winnerRange.end - this.winners.length;
  }

  isWinningRank(rank: number): boolean {
    return rank >= this.winnerRange.start && rank <= this.winnerRange.end;
  }

  private checkFinish(): void {
    if (!this.isRunning) return;
    const { start, end } = this.winnerRange;

    // 남은 구슬이 1개면 그 등수는 골인하지 않아도 확정된다. 2개 이상 남았다면 그들 사이의
    // 순위는 물리로만 정해지므로 예측하지 않는다 (당첨 범위 안에서도 순위는 의미를 가진다)
    const early = this.winners.length > 0 && this.marbles.length === 1;
    const ranked = early ? [...this.winners, this.marbles[0]] : this.winners;
    if (ranked.length <= end) return;

    if (early && this.isWinningRank(this.winners.length)) {
      this.events.onWinningGoal?.();
    }

    this.result = ranked.slice(start, end + 1);
    this.finishStep = this.stepCount;
    this.isRunning = false;
    this.events.onFinish?.(this.result);
  }

  private calcTimeScale(): number {
    const targetIndex = this.targetIndex;
    if (this.winners.length < this.winnerRange.end + 1 && this.goalDist < zoomThreshold) {
      if (
        this.marbles[targetIndex].y > this.stage.zoomY - zoomThreshold * 1.2 &&
        (this.marbles[targetIndex - 1] || this.marbles[targetIndex + 1])
      ) {
        return Math.max(0.2, this.goalDist / zoomThreshold);
      }
    }
    return 1;
  }
}
