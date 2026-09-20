// server/index.ts 를 dist-server/index.js 하나로 묶는다. ws까지 들어가므로 런타임에 node_modules가 필요 없다.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist-server/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // ws의 선택적 네이티브 가속 모듈. 없어도 순수 JS로 동작한다
  external: ['bufferutil', 'utf-8-validate'],
  // ESM 번들 안에서 require를 쓰는 CJS 의존성(ws)을 위해
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
