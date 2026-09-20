/**
 * 결정론 검증. 같은 setup이면 어떤 이력을 거쳤든, 어떤 wasm 빌드든 결과가 같아야 한다.
 *
 *   yarn determinism [구슬 수] [맵 인덱스]
 *
 * 1. 같은 시드를 새 월드에서 두 번 돌려 비교한다
 * 2. 다른 라운드를 먼저 돌려 월드를 더럽힌 뒤 같은 시드로 돌려 비교한다 (resetWorld 검증)
 * 3. SIMD 빌드와 비교한다 (참가자가 어떤 빌드를 받더라도 같은지 참고용)
 */
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { stages } from '../src/data/maps';
import { type Box2DLoader, Box2dPhysics } from '../src/physics-box2d';
import { type SimSetup, Simulation } from '../src/simulation';

const require = createRequire(import.meta.url);
const MAX_STEPS = 60 * 100; // 100초

function loader(simd: boolean): Box2DLoader {
  const dir = new URL('../node_modules/box2d-wasm/dist/', import.meta.url);
  const factory = require(
    simd ? '../node_modules/box2d-wasm/dist/umd/Box2D.simd.js' : '../node_modules/box2d-wasm/dist/umd/Box2D.js'
  );
  const wasmBinary = fs.readFileSync(new URL(simd ? 'umd/Box2D.simd.wasm' : 'umd/Box2D.wasm', dir));
  return () => factory({ wasmBinary });
}

type Trace = { steps: number; winners: string[]; hash: string };

function run(sim: Simulation, setup: SimSetup): Trace {
  sim.setup(setup);
  sim.start();
  let hash = 0;
  while (sim.isRunning && sim.stepCount < MAX_STEPS) {
    sim.step();
    // 매 100스텝마다 구슬 위치를 해시에 섞는다. 최종 결과가 우연히 같아도 궤적이 다르면 잡힌다
    if (sim.stepCount % 100 === 0) {
      for (const m of sim.marbles) {
        hash = (Math.imul(hash, 31) + Math.round(m.x * 1e6) + Math.round(m.y * 1e6) * 7) | 0;
      }
    }
  }
  return {
    steps: sim.stepCount,
    winners: (sim.result ?? []).map((m) => m.name),
    hash: (hash >>> 0).toString(16),
  };
}

const same = (a: Trace, b: Trace) => a.steps === b.steps && a.hash === b.hash && a.winners.join() === b.winners.join();

async function main() {
  const n = Number(process.argv[2] ?? 60);
  const stageIndex = Number(process.argv[3] ?? 0);
  const names = Array.from({ length: n }, (_, i) => `p${i}`);
  const setup: SimSetup = { seed: 12345, names, stageIndex, winnerRange: { start: 0, end: 0 } };
  const other: SimSetup = {
    seed: 999,
    names: names.slice(0, 20),
    stageIndex: (stageIndex + 1) % stages.length,
    winnerRange: { start: 0, end: 2 },
  };

  const physics = new Box2dPhysics(loader(false));
  await physics.init();
  const sim = new Simulation(physics);

  const a = run(sim, setup);
  console.log('run A', a);
  const b = run(new Simulation(physicsFresh(await fresh(false))), setup);
  console.log('run B (fresh)', b);
  run(sim, other); // 월드를 더럽힌다
  const c = run(sim, setup);
  console.log('run C (dirty)', c);

  const simdPhysics = new Box2dPhysics(loader(true));
  await simdPhysics.init();
  const d = run(new Simulation(simdPhysics), setup);
  console.log('run D (simd)', d);

  const ok = same(a, b) && same(a, c);
  console.log(`\nA==B(fresh): ${same(a, b)}  A==C(dirty): ${same(a, c)}  A==D(simd): ${same(a, d)}`);
  process.exit(ok && a.winners.length > 0 ? 0 : 1);
}

async function fresh(simd: boolean) {
  const p = new Box2dPhysics(loader(simd));
  await p.init();
  return p;
}
const physicsFresh = (p: Box2dPhysics) => p;

main();
