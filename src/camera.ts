import { initialZoom, zoomThreshold } from './data/constants';
import type { StageDef } from './data/maps';
import type { Marble } from './marble';
import type { VectorLike } from './types/VectorLike';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;
/** 세트장 가로 폭(월드 단위). 카메라가 이 밖으로 멀리 나가지 못하게 한다 */
const STAGE_WIDTH = 26;
const STAGE_MARGIN = 10;

export type CameraMode = 'follow' | 'free';

/**
 * 화면 중심(월드 좌표)과 배율을 가진다.
 * - free: 참여자가 직접 움직인다. 입력이 곧바로 반영되고 보간(이징)은 없다.
 * - follow: 골인 지점에 가까운 구슬을 따라간다. 이때만 부드럽게 따라붙는다.
 */
export class Camera {
  private _x = 0;
  private _y = 0;
  private _zoom = 1;
  private _targetX = 0;
  private _targetY = 0;
  private _targetZoom = 1;
  private _mode: CameraMode = 'free';
  private _stageHeight = 0;

  get x() {
    return this._x;
  }

  get y() {
    return this._y;
  }

  get zoom() {
    return this._zoom;
  }

  get mode() {
    return this._mode;
  }

  get position(): VectorLike {
    return { x: this._x, y: this._y };
  }

  setStageHeight(height: number) {
    this._stageHeight = height;
  }

  private clampCenter(x: number, y: number): VectorLike {
    const maxY = this._stageHeight > 0 ? this._stageHeight + STAGE_MARGIN : Infinity;
    return {
      x: Math.min(Math.max(x, -STAGE_MARGIN), STAGE_WIDTH + STAGE_MARGIN),
      y: Math.min(Math.max(y, -STAGE_MARGIN * 2), maxY),
    };
  }

  /** 즉시 이동한다. 참여자 조작은 전부 여기로 들어오며 free 모드가 된다 */
  setView(x: number, y: number, zoom: number = this._zoom) {
    const c = this.clampCenter(x, y);
    this._x = this._targetX = c.x;
    this._y = this._targetY = c.y;
    this._zoom = this._targetZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this._mode = 'free';
  }

  /** 화면 기준 픽셀 이동량(논리 px)만큼 화면을 끌어당긴다 */
  panByPixels(dx: number, dy: number) {
    const scale = initialZoom * this._zoom;
    this.setView(this._x - dx / scale, this._y - dy / scale);
  }

  /** 화면 위의 한 점(논리 px, 화면 중심 기준 오프셋)을 고정한 채 배율을 바꾼다 */
  zoomAt(factor: number, anchorX: number, anchorY: number) {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this._zoom * factor));
    const before = initialZoom * this._zoom;
    const after = initialZoom * next;
    // 앵커가 가리키는 월드 좌표가 배율 변경 전후로 같아야 한다
    const worldX = this._x + anchorX / before;
    const worldY = this._y + anchorY / before;
    this.setView(worldX - anchorX / after, worldY - anchorY / after, next);
  }

  follow() {
    this._mode = 'follow';
  }

  /** 라운드가 새로 시작될 때 화면을 잡아준다 */
  initializePosition(center?: VectorLike, zoom?: number) {
    this.setView(center?.x ?? 12.95, center?.y ?? 2, zoom ?? 1);
  }

  update({
    marbles,
    stage,
    needToZoom,
    targetIndex,
  }: {
    marbles: Marble[];
    stage: StageDef;
    needToZoom: boolean;
    targetIndex: number;
  }) {
    if (this._mode !== 'follow') return;

    this._calcTarget(marbles, stage, needToZoom, targetIndex);
    this._x = this._interpolation(this._x, this._targetX, 120);
    this._y = this._interpolation(this._y, this._targetY);
    this._zoom = this._interpolation(this._zoom, this._targetZoom);
  }

  private _calcTarget(marbles: Marble[], stage: StageDef, needToZoom: boolean, targetIndex: number) {
    if (marbles.length === 0) {
      this._targetZoom = 1;
      return;
    }
    const targetMarble = marbles[targetIndex] ? marbles[targetIndex] : marbles[0];
    const p = this.clampCenter(targetMarble.position.x, targetMarble.position.y);
    this._targetX = p.x;
    this._targetY = p.y;
    if (needToZoom) {
      const goalDist = Math.abs(stage.zoomY - this._y);
      this._targetZoom = Math.max(1, (1 - goalDist / zoomThreshold) * 4);
    } else {
      this._targetZoom = 1;
    }
  }

  private _interpolation(current: number, target: number, delta: number = 10) {
    const d = target - current;
    if (Math.abs(d) < 1 / initialZoom) {
      return target;
    }
    return current + d / delta;
  }

  /** 논리 크기(width x height)의 화면에 월드를 그리도록 변환을 설정하고 callback을 실행한다 */
  renderScene(ctx: CanvasRenderingContext2D, width: number, height: number, callback: () => void) {
    ctx.save();
    ctx.translate(width / 2, height / 2);
    const scale = initialZoom * this._zoom;
    ctx.scale(scale, scale);
    ctx.translate(-this._x, -this._y);
    callback();
    ctx.restore();
  }
}
