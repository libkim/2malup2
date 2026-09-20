export type WinnerRange = { start: number; end: number };

/** 시뮬레이션이 읽는 전역 옵션. 방 설정이 바뀔 때 Roulette.applySetup이 채운다 */
class Options {
  useSkills: boolean = true;
}

const options = new Options();
export default options;
