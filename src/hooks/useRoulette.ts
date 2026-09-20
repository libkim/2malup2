import { type RefObject, useEffect, useState } from 'react';
import { loadBox2D } from '@/physics-loader';
import { Roulette } from '@/roulette';
import { useTheme } from './useTheme';

/** 컨테이너 안에 룰렛 캔버스를 만들고, 준비되면 인스턴스를 돌려준다 */
export function useRoulette(containerRef: RefObject<HTMLElement | null>): Roulette | null {
  const [roulette, setRoulette] = useState<Roulette | null>(null);
  const [theme] = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const instance = new Roulette(loadBox2D);
    let cancelled = false;
    instance.mount(container).then(() => {
      if (cancelled) return;
      // ?debug 를 붙이면 콘솔에서 window.__roulette로 접근할 수 있다 (동기화 검증용)
      if (new URLSearchParams(location.search).has('debug')) (window as any).__roulette = instance;
      setRoulette(instance);
    });
    return () => {
      cancelled = true;
      instance.destroy();
      setRoulette(null);
    };
  }, [containerRef]);

  useEffect(() => {
    roulette?.setTheme(theme);
  }, [roulette, theme]);

  return roulette;
}
