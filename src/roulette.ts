import { Camera, MAX_ZOOM, MIN_ZOOM } from './camera';
import { initialZoom, Themes } from './data/constants';
import type { StageDef } from './data/maps';
import type { GameObject } from './gameObject';
import options from './options';
import { ParticleManager } from './particleManager';
import { type Box2DLoader, Box2dPhysics } from './physics-box2d';
import { RankRenderer } from './rankRenderer';
import { RouletteRenderer } from './rouletteRenderer';
import { type SimSetup, Simulation, STEP_MS } from './simulation';
import { SkillEffect } from './skillEffect';
import type { ColorTheme } from './types/ColorTheme';
import type { UIObject } from './UIObject';
import { bound } from './utils/bound.decorator';

/** 한 프레임에 시뮬레이션에 쓸 수 있는 시간. 이걸 넘기면 남은 스텝은 다음 프레임에 이어서 따라잡는다 */
const FRAME_BUDGET_MS = 12;
/** 이 이상 뒤처지면 "동기화 중"으로 본다 */
const CATCH_UP_THRESHOLD_STEPS = 100;
/** 키보드로 화면을 움직이는 속도 (css px/초) */
const KEY_PAN_SPEED = 700;
/** 키보드 확대/축소 속도 (초당 배율의 지수) */
const KEY_ZOOM_SPEED = 1.4;
const WHEEL_ZOOM_SPEED = 0.0015;
/** 이 거리(px) 이상 움직였으면 클릭이 아니라 드래그로 본다 */
const DRAG_THRESHOLD = 4;
/** 순위 목록이 오른쪽에 그려지는 폭(논리 px). 이 위에서 휠을 돌리면 화면 확대가 아니라 목록 스크롤이다 */
const RANK_LIST_WIDTH = 150;

export type RaceClock = {
  /** 방 기준 시각(ms). 서버 시계에 맞춰진 값을 돌려준다 */
  now: () => number;
  /** 이 시각(방 기준)에 시뮬레이션 0스텝이 시작된다 */
  startAt: number;
  /** 배속. 시작한 뒤에는 바꾸지 않는다 */
  speed: number;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export class Roulette extends EventTarget {
  readonly camera = new Camera();
  private renderer = new RouletteRenderer();
  private physics!: Box2dPhysics;
  private sim!: Simulation;
  private particleManager = new ParticleManager();
  private effects: GameObject[] = [];
  private uiObjects: UIObject[] = [];
  private rankRenderer = new RankRenderer();
  private theme: ColorTheme = Themes.dark;
  private navigators = new Set<{ render: () => void }>();

  private clock: RaceClock | null = null;
  private stepsRun = 0;
  private lastFrameTime = 0;
  private catchingUp = false;

  private keys = new Set<string>();
  private drag: { pointerId: number; lastX: number; lastY: number; moved: number } | null = null;
  private stopped = false;
  private cleanups: (() => void)[] = [];

  ready = false;

  constructor(private loadBox2D: Box2DLoader) {
    super();
  }

  async mount(container: HTMLElement): Promise<void> {
    await this.renderer.init(container);
    if (this.stopped) {
      // 마운트가 끝나기 전에 파기됐다 (React StrictMode의 이중 실행 등)
      this.renderer.canvas.remove();
      return;
    }
    this.physics = new Box2dPhysics(this.loadBox2D);
    await this.physics.init();
    if (this.stopped) {
      this.renderer.canvas.remove();
      return;
    }

    this.sim = new Simulation(this.physics);
    this.sim.events = {
      onWinningGoal: () => this.particleManager.shot(this.renderer.width, this.renderer.height),
      onSkill: (marble) => this.effects.push(new SkillEffect(marble.x, marble.y)),
      onFinish: (winners) => {
        this.dispatchEvent(
          new CustomEvent('goal', { detail: { winner: winners[0]?.name, winners: winners.map((m) => m.name) } })
        );
      },
    };

    this.uiObjects.push(this.rankRenderer);
    this.attachInput(this.renderer.canvas);
    this.ready = true;
    this.dispatchEvent(new Event('ready'));
    window.requestAnimationFrame(this.frame);
  }

  destroy() {
    this.stopped = true;
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.renderer.canvas.remove();
  }

  get simulation(): Simulation {
    return this.sim;
  }

  get stage(): StageDef {
    return this.sim.stage;
  }

  /** 논리 좌표계 화면 크기. 카메라가 보는 월드 범위를 계산할 때 쓴다 */
  get viewSize() {
    return { width: this.renderer.width, height: this.renderer.height };
  }

  getEntities() {
    return this.physics.getEntities();
  }

  getTheme(): ColorTheme {
    return this.theme;
  }

  setTheme(themeName: keyof typeof Themes) {
    this.theme = Themes[themeName];
  }

  registerNavigator(navigator: { render: () => void }): () => void {
    this.navigators.add(navigator);
    return () => this.navigators.delete(navigator);
  }

  /** 방 설정을 화면에 반영한다. 시작 전 미리보기와 시작 직전 초기화에 모두 쓴다 */
  applySetup(setup: SimSetup & { useSkills: boolean }) {
    options.useSkills = setup.useSkills;
    this.clock = null;
    this.stepsRun = 0;
    this.catchingUp = false;
    this.effects = [];
    this.particleManager = new ParticleManager();
    this.sim.setup(setup);
    this.camera.setStageHeight(this.sim.stage.goalY);
    this.frameSpawnArea();
    this.dispatchEvent(new Event('setup'));
  }

  /** 구슬이 놓인 자리가 한눈에 보이도록 화면을 잡는다 */
  private frameSpawnArea() {
    const total = this.sim.marbles.length;
    if (total === 0) {
      this.camera.initializePosition();
      return;
    }
    const cols = Math.min(total, 10);
    const rows = Math.ceil(total / 10);
    const lineDelta = -Math.max(0, Math.ceil(rows - 5));
    const centerX = 10.25 + (cols - 1) * 0.3;
    const centerY = (1 + rows) / 2 + lineDelta;

    const spawnWidth = Math.max((cols - 1) * 0.6, 1);
    const spawnHeight = Math.max(rows - 1, 1);
    const margin = 3;
    const viewW = this.renderer.width / initialZoom;
    const viewH = this.renderer.height / initialZoom;
    const zoom = Math.max(
      1.5,
      Math.min(Math.min(viewW / (spawnWidth + margin * 2), viewH / (spawnHeight + margin * 2)), 3)
    );
    this.camera.initializePosition({ x: centerX, y: centerY }, zoom);
  }

  /** 정해진 시각에 시뮬레이션을 시작한다. 모든 참가자가 같은 clock으로 호출한다 */
  startRace(clock: RaceClock) {
    this.clock = clock;
    this.stepsRun = 0;
    this.sim.start();
    this.setFollow(true);
  }

  get isRaceRunning(): boolean {
    return this.sim?.isRunning ?? false;
  }

  setFollow(follow: boolean) {
    if (follow) {
      this.camera.follow();
    } else if (this.camera.mode === 'follow') {
      this.camera.setView(this.camera.x, this.camera.y);
    }
    this.dispatchEvent(new Event('followchange'));
  }

  get isFollowing(): boolean {
    return this.camera.mode === 'follow';
  }

  /** 사용자 조작으로 카메라가 free가 되면 UI가 알 수 있게 알린다 */
  private notifyManualView() {
    this.dispatchEvent(new Event('followchange'));
  }

  // ---- 프레임 루프 ----

  @bound
  private frame() {
    if (this.stopped) return;
    const now = performance.now();
    const dt = this.lastFrameTime ? Math.min(now - this.lastFrameTime, 100) : 16;
    this.lastFrameTime = now;

    this.applyKeyboard(dt);
    this.advanceSimulation(now);

    if (!this.clock) {
      // 레이스 전에는 시뮬레이션이 멈춰 있지만 목록 스크롤 같은 화면 연출은 계속 돌아야 한다
      this.tickVisuals(dt);
    }

    this.camera.update({
      marbles: this.sim.marbles,
      stage: this.sim.stage,
      needToZoom: this.sim.goalDist < 5,
      targetIndex: this.sim.winners.length > 0 ? this.sim.targetIndex : 0,
    });

    this.render();
    this.navigators.forEach((nav) => nav.render());
    window.requestAnimationFrame(this.frame);
  }

  private advanceSimulation(frameStart: number) {
    if (!this.clock) return;
    const elapsed = this.clock.now() - this.clock.startAt;
    if (elapsed < 0) return;

    const due = Math.floor((elapsed * this.clock.speed) / STEP_MS);
    while (this.stepsRun < due) {
      this.sim.step();
      this.stepsRun++;
      this.tickVisuals(STEP_MS);
      // 늦게 들어왔거나 느린 기기면 한 프레임에 다 못 돌린다. 나머지는 다음 프레임에 이어간다
      if (performance.now() - frameStart > FRAME_BUDGET_MS) break;
    }

    const behind = due - this.stepsRun;
    const catching = behind > CATCH_UP_THRESHOLD_STEPS;
    if (catching !== this.catchingUp) {
      this.catchingUp = catching;
      this.dispatchEvent(new CustomEvent('sync', { detail: { catchingUp: catching } }));
    }
  }

  private tickVisuals(deltaTime: number) {
    this.particleManager.update(deltaTime);
    this.effects.forEach((effect) => effect.update(deltaTime));
    this.effects = this.effects.filter((effect) => !effect.isDestroy);
    this.uiObjects.forEach((obj) => obj.update(deltaTime));
  }

  private render() {
    this.renderer.render(
      {
        camera: this.camera,
        stage: this.sim.stage,
        entities: this.physics.getEntities(),
        marbles: this.sim.marbles,
        winners: this.sim.winners,
        particleManager: this.particleManager,
        effects: this.effects,
        winnerRange: this.sim.winnerRange,
        result: this.sim.result,
        size: { x: this.renderer.width, y: this.renderer.height },
        theme: this.theme,
      },
      this.uiObjects
    );
  }

  // ---- 입력: 드래그 이동, 휠 확대/축소, 키보드 ----

  private attachInput(canvas: HTMLCanvasElement) {
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement,
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions
    ) => {
      el.addEventListener(type, handler, opts);
      this.cleanups.push(() => el.removeEventListener(type, handler, opts));
    };
    const onWindow = <K extends keyof WindowEventMap>(type: K, handler: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, handler);
      this.cleanups.push(() => window.removeEventListener(type, handler));
    };

    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';

    on(canvas, 'pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      canvas.setPointerCapture(e.pointerId);
      this.drag = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: 0 };
      canvas.style.cursor = 'grabbing';
    });

    on(canvas, 'pointermove', (e) => {
      const drag = this.drag;
      if (drag && drag.pointerId === e.pointerId) {
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > DRAG_THRESHOLD) {
          const k = this.renderer.sizeFactor;
          this.camera.panByPixels(dx * k, dy * k);
          this.notifyManualView();
        }
        return;
      }
      canvas.style.cursor = this.resultCloseHitAt(e) ? 'pointer' : 'grab';
    });

    const endDrag = (e: PointerEvent) => {
      if (this.drag?.pointerId !== e.pointerId) return;
      const wasClick = this.drag.moved <= DRAG_THRESHOLD;
      this.drag = null;
      canvas.style.cursor = 'grab';
      if (wasClick && e.type === 'pointerup' && this.resultCloseHitAt(e)) {
        this.renderer.closeResultPopup();
      }
    };
    on(canvas, 'pointerup', endDrag);
    on(canvas, 'pointercancel', endDrag);
    on(canvas, 'contextmenu', (e) => e.preventDefault());

    on(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        const k = this.renderer.sizeFactor;
        const x = e.offsetX * k;
        if (x > this.renderer.width - RANK_LIST_WIDTH) {
          this.rankRenderer.onWheel(e);
          return;
        }
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        this.camera.zoomAt(
          Math.exp(-delta * WHEEL_ZOOM_SPEED),
          x - this.renderer.width / 2,
          e.offsetY * k - this.renderer.height / 2
        );
        this.notifyManualView();
      },
      { passive: false }
    );

    onWindow('keydown', (e) => {
      if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (MOVE_KEYS.has(e.key) || ZOOM_KEYS.has(e.key)) {
        e.preventDefault();
        this.keys.add(e.key);
      }
    });
    onWindow('keyup', (e) => this.keys.delete(e.key));
    onWindow('blur', () => this.keys.clear());
  }

  private applyKeyboard(dtMs: number) {
    if (this.keys.size === 0) return;
    const dt = dtMs / 1000;
    const k = this.renderer.sizeFactor;

    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowLeft')) dx += 1;
    if (this.keys.has('ArrowRight')) dx -= 1;
    if (this.keys.has('ArrowUp')) dy += 1;
    if (this.keys.has('ArrowDown')) dy -= 1;
    // panByPixels는 "화면을 끌어당기는" 방향이라 키 방향과 반대다 (오른쪽 키 = 월드가 왼쪽으로)
    if (dx !== 0 || dy !== 0) {
      this.camera.panByPixels(dx * KEY_PAN_SPEED * dt * k, dy * KEY_PAN_SPEED * dt * k);
    }

    let zoomDir = 0;
    if ([...this.keys].some((key) => ZOOM_IN_KEYS.has(key))) zoomDir += 1;
    if ([...this.keys].some((key) => ZOOM_OUT_KEYS.has(key))) zoomDir -= 1;
    if (zoomDir !== 0) {
      this.camera.zoomAt(Math.exp(zoomDir * KEY_ZOOM_SPEED * dt), 0, 0);
    }
    if (dx !== 0 || dy !== 0 || zoomDir !== 0) this.notifyManualView();
  }

  private resultCloseHitAt(e: MouseEvent): boolean {
    const k = this.renderer.sizeFactor;
    return this.renderer.getResultCloseHitAt(e.offsetX * k, e.offsetY * k);
  }
}

const ZOOM_IN_KEYS = new Set(['+', '=']);
const ZOOM_OUT_KEYS = new Set(['-', '_']);
const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const ZOOM_KEYS = new Set([...ZOOM_IN_KEYS, ...ZOOM_OUT_KEYS]);

export { MAX_ZOOM, MIN_ZOOM };
