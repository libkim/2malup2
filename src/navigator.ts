import { initialZoom } from './data/constants';
import type { Roulette } from './roulette';
import type { ColorTheme } from './types/ColorTheme';
import type { MapEntityState } from './types/MapEntity.type';

/** 세트장 가로 폭(월드 단위) */
const STAGE_WIDTH = 26;
const PADDING = 8;
const MAX_PIXEL_RATIO = 2;

type Layout = { scale: number; originX: number; originY: number };

/**
 * 세트장 전체를 미리 보여주는 패널.
 * 포토샵이나 클립스튜디오의 네비게이터처럼 누르거나 끌 때만 화면이 옮겨간다.
 * 마우스를 올려두기만 해서는 움직이지 않고, 보정(이징)도 없어 카메라가 즉시 따라온다.
 */
export class Navigator {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private pixelRatio = 1;
  private draggingPointer: number | null = null;

  constructor(private roulette: Roulette) {}

  /** 캔버스를 연결한다. 해제 함수를 돌려준다 */
  attach(canvas: HTMLCanvasElement): () => void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'crosshair';

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      this.cssWidth = rect.width;
      this.cssHeight = rect.height;
      canvas.width = Math.round(rect.width * this.pixelRatio);
      canvas.height = Math.round(rect.height * this.pixelRatio);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const moveTo = (e: PointerEvent) => {
      const layout = this.layout();
      if (!layout) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - layout.originX) / layout.scale;
      const y = (e.clientY - rect.top - layout.originY) / layout.scale;
      this.roulette.camera.setView(x, y);
      this.roulette.dispatchEvent(new Event('followchange'));
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      this.draggingPointer = e.pointerId;
      moveTo(e);
    };
    const onMove = (e: PointerEvent) => {
      if (this.draggingPointer === e.pointerId) moveTo(e);
    };
    const onUp = (e: PointerEvent) => {
      if (this.draggingPointer === e.pointerId) this.draggingPointer = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    const unregister = this.roulette.registerNavigator(this);

    return () => {
      unregister();
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      this.canvas = null;
      this.ctx = null;
    };
  }

  /** 세트장 전체가 패널 안에 들어오도록 배율을 정한다 */
  private layout(): Layout | null {
    if (!this.roulette.ready || this.cssWidth <= 0) return null;
    const height = this.roulette.stage.goalY;
    const scale = Math.min((this.cssWidth - PADDING * 2) / STAGE_WIDTH, (this.cssHeight - PADDING * 2) / height);
    if (!(scale > 0)) return null;
    return {
      scale,
      originX: (this.cssWidth - STAGE_WIDTH * scale) / 2,
      originY: (this.cssHeight - height * scale) / 2,
    };
  }

  render() {
    const ctx = this.ctx;
    const layout = this.layout();
    if (!ctx || !layout || !this.canvas) return;

    const theme = this.roulette.getTheme();
    const { scale, originX, originY } = layout;
    const k = this.pixelRatio;
    const stage = this.roulette.stage;

    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

    ctx.save();
    ctx.translate(originX, originY);
    ctx.scale(scale, scale);

    ctx.fillStyle = theme.minimapBackground;
    ctx.fillRect(0, 0, STAGE_WIDTH, stage.goalY);

    // 선 굵기는 화면 기준 1px 안팎으로 유지한다
    ctx.lineWidth = 1.5 / scale;
    this.drawEntities(ctx, this.roulette.getEntities(), theme);
    this.drawMarbles(ctx, scale);
    this.drawViewport(ctx, theme, scale);
    ctx.restore();

    ctx.strokeStyle = theme.minimapViewport;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(originX, originY, STAGE_WIDTH * scale, stage.goalY * scale);
    ctx.globalAlpha = 1;
  }

  private drawViewport(ctx: CanvasRenderingContext2D, theme: ColorTheme, scale: number) {
    const { camera } = this.roulette;
    const { width, height } = this.roulette.viewSize;
    const zoom = camera.zoom * initialZoom;
    const w = width / zoom;
    const h = height / zoom;
    ctx.save();
    ctx.strokeStyle = theme.minimapViewport;
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(camera.x - w / 2, camera.y - h / 2, w, h);
    ctx.restore();
  }

  private drawMarbles(ctx: CanvasRenderingContext2D, scale: number) {
    // 구슬이 너무 작아 안 보이지 않게 화면 기준 최소 반지름을 둔다
    const radius = Math.max(0.5, 2 / scale);
    for (const marble of this.roulette.simulation.marbles) {
      ctx.fillStyle = marble.color;
      ctx.beginPath();
      ctx.arc(marble.x, marble.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawEntities(ctx: CanvasRenderingContext2D, entities: MapEntityState[], theme: ColorTheme) {
    for (const entity of entities) {
      ctx.save();
      ctx.fillStyle = entity.shape.color ?? theme.entity[entity.shape.type].fill;
      ctx.strokeStyle = entity.shape.color ?? theme.entity[entity.shape.type].outline;
      ctx.translate(entity.x, entity.y);
      ctx.rotate(entity.angle);

      const shape = entity.shape;
      switch (shape.type) {
        case 'box': {
          const w = shape.width * 2;
          const h = shape.height * 2;
          ctx.rotate(shape.rotation);
          ctx.fillRect(-w / 2, -h / 2, w, h);
          break;
        }
        case 'circle':
          ctx.beginPath();
          ctx.arc(0, 0, shape.radius, 0, Math.PI * 2, false);
          ctx.stroke();
          break;
        case 'polyline':
          if (shape.points.length > 0) {
            ctx.beginPath();
            ctx.moveTo(shape.points[0][0], shape.points[0][1]);
            for (let i = 1; i < shape.points.length; i++) {
              ctx.lineTo(shape.points[i][0], shape.points[i][1]);
            }
            ctx.stroke();
          }
          break;
      }
      ctx.restore();
    }
  }
}
