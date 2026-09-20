import { useEffect, useMemo } from 'react';
import { ErrorBanner } from '@/components/ErrorBanner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { defaultServerUrl, RoomClient } from '@/net/client';
import { RoomClientContext, useClientState } from '@/net/useRoomClient';
import { LobbyScreen } from '@/screens/LobbyScreen';
import { RoomScreen } from '@/screens/RoomScreen';

function Screens() {
  const { room, status } = useClientState();
  return (
    <>
      {room ? <RoomScreen key={room.id} room={room} /> : <LobbyScreen />}
      {status !== 'open' && (
        <div className="fixed inset-x-0 top-0 z-50 bg-amber-500 py-1 text-center text-sm font-medium text-black">
          {status === 'connecting' ? '서버에 연결하는 중...' : '연결이 끊겼습니다. 다시 연결하는 중...'}
        </div>
      )}
      <ErrorBanner />
    </>
  );
}

export function App() {
  const client = useMemo(() => new RoomClient(import.meta.env.VITE_WS_URL ?? defaultServerUrl()), []);

  useEffect(() => {
    client.connect();
    return () => client.dispose();
  }, [client]);

  return (
    <RoomClientContext.Provider value={client}>
      <TooltipProvider delayDuration={200}>
        <Screens />
      </TooltipProvider>
    </RoomClientContext.Provider>
  );
}
