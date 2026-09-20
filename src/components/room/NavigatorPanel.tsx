import { useEffect, useRef } from 'react';
import { Navigator } from '@/navigator';
import type { Roulette } from '@/roulette';

/** 세트장 전체 미리보기. 누르거나 끌면 그 위치로 화면이 이동한다 */
export function NavigatorPanel({ roulette }: { roulette: Roulette | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !roulette) return;
    return new Navigator(roulette).attach(canvas);
  }, [roulette]);

  return (
    <canvas ref={canvasRef} className="block size-full" aria-label="세트장 미리보기. 누르면 그 위치로 이동합니다" />
  );
}
