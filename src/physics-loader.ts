import Box2DFactory from 'box2d-wasm/dist/es/Box2D.js';
import type { Box2DLoader } from './physics-box2d';

// entry.js는 브라우저마다 SIMD 여부로 빌드를 골라서, 참가자마다 다른 바이너리를 쓰게 된다.
// 결정론을 위해 SIMD 미사용 빌드를 직접 가져온다.
const wasmUrl = new URL('../node_modules/box2d-wasm/dist/es/Box2D.wasm', import.meta.url).href;

export const loadBox2D: Box2DLoader = () =>
  Box2DFactory({ locateFile: () => wasmUrl }) as unknown as ReturnType<Box2DLoader>;
