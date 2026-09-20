/**
 * 시뮬레이션 결과에 영향을 주는 난수는 전부 여기서 뽑는다.
 * 방의 모든 참가자가 같은 시드로 같은 순서로 호출해야 같은 결과가 나온다.
 * (파티클 같은 연출용 난수는 Math.random을 그대로 써도 된다)
 */
let state = 0;

export function setSeed(seed: number): void {
  state = seed >>> 0;
}

/** mulberry32 */
export function random(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
