import type { RaceInfo } from '@shared/protocol';
import { Crosshair, Keyboard, Loader2, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useClient } from '@/net/useRoomClient';
import { MAX_ZOOM, MIN_ZOOM, type Roulette } from '@/roulette';

/** 시작 신호를 받은 뒤 실제로 굴러가기 전까지의 남은 초. 카운트다운이 아니면 null */
function useCountdown(race: RaceInfo | null): number | null {
  const client = useClient();
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!race) {
      setRemaining(null);
      return;
    }
    const tick = () => {
      const ms = race.startAt - client.serverNow();
      setRemaining(ms > 0 ? Math.ceil(ms / 1000) : null);
    };
    tick();
    const timer = setInterval(tick, 100);
    return () => clearInterval(timer);
  }, [race, client]);

  return remaining;
}

function useRouletteFlag(roulette: Roulette | null) {
  const [following, setFollowing] = useState(false);
  const [catchingUp, setCatchingUp] = useState(false);

  useEffect(() => {
    if (!roulette) return;
    const onFollow = () => setFollowing(roulette.isFollowing);
    const onSync = (e: Event) => setCatchingUp((e as CustomEvent<{ catchingUp: boolean }>).detail.catchingUp);
    roulette.addEventListener('followchange', onFollow);
    roulette.addEventListener('sync', onSync);
    onFollow();
    return () => {
      roulette.removeEventListener('followchange', onFollow);
      roulette.removeEventListener('sync', onSync);
    };
  }, [roulette]);

  return { following, catchingUp };
}

/** 가운데 화면 위에 얹는 조작 버튼과 상태 표시. 캔버스 자체는 useRoulette가 컨테이너 안에 만든다 */
export function StageOverlay({ roulette, race }: { roulette: Roulette | null; race: RaceInfo | null }) {
  const countdown = useCountdown(race);
  const { following, catchingUp } = useRouletteFlag(roulette);

  const zoomBy = (factor: number) => {
    if (!roulette) return;
    roulette.camera.zoomAt(factor, 0, 0);
    roulette.dispatchEvent(new Event('followchange'));
  };

  return (
    <>
      {countdown !== null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span
            className="text-8xl font-black text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]"
            aria-live="assertive"
          >
            {countdown}
          </span>
        </div>
      )}

      {catchingUp && (
        <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1 text-sm text-white">
          <Loader2 className="size-4 animate-spin" />
          진행 중인 화면에 맞추는 중...
        </div>
      )}

      <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-lg border bg-background/85 p-1 shadow-sm backdrop-blur">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant={following ? 'default' : 'ghost'}
              className="size-8"
              onClick={() => roulette?.setFollow(!following)}
              aria-pressed={following}
              aria-label="구슬 따라가기"
            >
              <Crosshair />
            </Button>
          </TooltipTrigger>
          <TooltipContent>구슬 따라가기</TooltipContent>
        </Tooltip>
        <Button size="icon" variant="ghost" className="size-8" onClick={() => zoomBy(1 / 1.25)} aria-label="축소">
          <Minus />
        </Button>
        <Button size="icon" variant="ghost" className="size-8" onClick={() => zoomBy(1.25)} aria-label="확대">
          <Plus />
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8" aria-label="조작 방법">
              <Keyboard />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-56 text-xs leading-relaxed">
            드래그: 화면 이동
            <br />휠 또는 + / − 키: 확대·축소 ({MIN_ZOOM}~{MAX_ZOOM}배)
            <br />
            방향키: 화면 이동
          </TooltipContent>
        </Tooltip>
      </div>
    </>
  );
}
