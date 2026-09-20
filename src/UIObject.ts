import type { RenderParameters } from './rouletteRenderer';

/** 캔버스 위에 그려지는 HUD 요소 */
export interface UIObject {
  update(deltaTime: number): void;

  render(ctx: CanvasRenderingContext2D, params: RenderParameters, width: number, height: number): void;
}
