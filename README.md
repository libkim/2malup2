# 2말없2

구슬을 굴려 당첨자를 뽑는 추첨기. 방을 만들어 여러 사람이 같은 화면을 보며 함께 즐길 수 있다.

## 기능

- 방 만들기(제목, 선택 비밀번호), 방 목록, 비밀번호 입장
- 입장하면 무작위 닉네임이 자동으로 붙는다. 내 닉네임과 방장은 화면에 표시된다
- 방장만 설정(참가자, 맵, 당첨 방식, 스킬, 2배속)과 시작을 할 수 있고, 방장이 나가면 다음 사람이 이어받는다
- 모두 채팅 가능
- 룰렛은 모든 참가자에게 실시간으로 동기화되지만, 어디를 볼지는 각자 정한다
  - 드래그: 화면 이동, 휠 또는 `+` / `-`: 확대·축소, 방향키: 화면 이동
  - 왼쪽 미리보기(네비게이터)를 누르거나 끌면 그 위치로 이동

## 동기화 방식

서버는 방 상태와 시작 신호만 중계한다. 물리 시뮬레이션은 각 브라우저가 돌린다.
시작할 때 서버가 정한 **시드**와 **시작 시각**을 모두가 받고, 같은 시드로 같은 설정을 고정 스텝(10ms)으로 계산하므로
화면과 결과가 같다. 중간에 입장한 사람은 이미 지난 시간만큼 빠르게 따라잡는다.

결과가 같으려면 시뮬레이션이 결정적이어야 한다. 그래서 난수는 `src/utils/random.ts`만 쓰고, 라운드마다 Box2D 월드를 새로 만들고,
SIMD 미사용 wasm을 고정해서 쓴다. `yarn determinism`으로 검증할 수 있다.

## 스택

TypeScript, React, Tailwind CSS v4, shadcn/ui, Vite, box2d-wasm. 서버는 Node.js와 `ws` 하나다.

## 개발

```shell
yarn
yarn dev
```

웹(`http://localhost:1235`)과 서버(`:8787`)가 함께 뜬다. 웹의 `/ws` 요청은 서버로 프록시된다.

```shell
yarn typecheck       # 타입 검사
yarn lint            # biome
yarn test:server     # 서버 프로토콜 E2E
yarn determinism     # 시뮬레이션 결정론 검증
```

## 빌드와 실행

```shell
yarn build           # dist/(클라이언트) + dist-server/(서버 번들)
yarn start           # http://localhost:8787 (PORT 환경변수로 변경)
```

## Docker

```shell
docker build -t roulette .
docker run -p 8080:8080 roulette
```

`PORT`로 포트를 바꿀 수 있고, 기본값은 프록시 뒤를 전제로 `TRUST_PROXY=1`(`X-Forwarded-For`를 클라이언트 IP로 사용)이다. 프록시 없이 직접 노출할 때는 `TRUST_PROXY=0`으로 바꾼다.
방 정보는 서버 메모리에만 있어서 재시작하면 사라진다. WebSocket이 필요하므로 정적 호스팅(Vercel 등)에는 올릴 수 없고,
컨테이너를 돌릴 수 있는 곳(Railway, Render, Fly.io, Cloud Run 등)에 올려야 한다.

## 감사의 말

이 프로젝트는 [LazyGyu](https://github.com/lazygyu)의 오픈소스 [roulette](https://github.com/lazygyu/roulette)를 수정해서 만들었습니다. 훌륭한 원본을 공개해 주셔서 감사합니다.

## License

[MIT License](./LICENSE)
