import type { RoomState } from '@shared/protocol';
import { ArrowLeft, Crown, Map as MapIcon, MessageSquare, Settings, Users } from 'lucide-react';
import { useRef } from 'react';
import { ChatPanel } from '@/components/room/ChatPanel';
import { MemberList } from '@/components/room/MemberList';
import { NavigatorPanel } from '@/components/room/NavigatorPanel';
import { SettingsPanel } from '@/components/room/SettingsPanel';
import { StageOverlay } from '@/components/room/StageView';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useRoomSync } from '@/hooks/useRoomSync';
import { useRoulette } from '@/hooks/useRoulette';
import { useClient, useClientState } from '@/net/useRoomClient';

/**
 * 3열 구성. 넓은 화면(lg 이상)에서는 왼쪽 미리보기 | 가운데 룰렛 | 오른쪽 참여자·채팅·설정이고,
 * 좁은 화면에서는 룰렛이 위, 나머지가 아래 탭으로 쌓인다.
 * 룰렛 캔버스가 다시 만들어지지 않도록 트리 구조는 화면 크기와 무관하게 하나로 유지하고 CSS로만 배치를 바꾼다.
 */
export function RoomScreen({ room }: { room: RoomState }) {
  const client = useClient();
  const { you } = useClientState();
  const stageRef = useRef<HTMLDivElement>(null);
  const roulette = useRoulette(stageRef);

  const youId = you?.id ?? '';
  const isHost = room.hostId === youId;
  const hostNickname = room.members.find((m) => m.id === room.hostId)?.nickname ?? '';
  useRoomSync(roulette, room, isHost);

  const racing = room.race !== null;

  return (
    <div className="flex h-dvh flex-col lg:flex-row">
      {/* 왼쪽: 방 나가기 + 세트장 미리보기 (넓은 화면 전용) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r lg:flex">
        <div className="flex items-center gap-2 border-b p-2">
          <Button variant="outline" size="sm" onClick={() => client.leaveRoom()}>
            <ArrowLeft />방 나가기
          </Button>
        </div>
        <div className="border-b px-3 py-2">
          <h2 className="truncate text-sm font-semibold" title={room.title}>
            {room.title}
          </h2>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Crown className="size-3 text-amber-500" />
            <span className="truncate font-mono">{hostNickname}</span>
          </p>
        </div>
        <div className="min-h-0 flex-1 p-2">
          <NavigatorPanel roulette={roulette} />
        </div>
      </aside>

      {/* 좁은 화면 상단 바 */}
      <header className="flex items-center gap-2 border-b p-2 lg:hidden">
        <Button variant="outline" size="sm" onClick={() => client.leaveRoom()}>
          <ArrowLeft />
          나가기
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{room.title}</h2>
        <ThemeToggle />
      </header>

      {/* 가운데: 룰렛 화면 */}
      <main className="relative h-[52dvh] shrink-0 overflow-hidden bg-background lg:h-auto lg:min-w-0 lg:flex-1 lg:shrink">
        <div ref={stageRef} className="absolute inset-0" />
        <StageOverlay roulette={roulette} race={room.race} />
      </main>

      {/* 오른쪽: 참여자, 채팅, (방장) 설정 */}
      <aside className="flex min-h-0 flex-1 flex-col border-t lg:w-80 lg:flex-none lg:border-l lg:border-t-0">
        {/* 넓은 화면에서는 참여자 목록을 항상 보여준다. 좁은 화면에서는 아래 탭으로 들어간다 */}
        <section className="hidden max-h-[30%] shrink-0 flex-col border-b lg:flex">
          <div className="flex items-center justify-between px-3 py-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Users className="size-4" />
              참여자 {room.members.length}
            </h3>
            <ThemeToggle />
          </div>
          <div className="min-h-0 overflow-y-auto px-2 pb-2">
            <MemberList members={room.members} hostId={room.hostId} youId={youId} />
          </div>
        </section>
        <Tabs defaultValue={isHost ? 'settings' : 'chat'} className="min-h-0 flex-1 gap-0">
          <div className="flex items-center gap-2 border-b p-2">
            <TabsList className="flex-1">
              {isHost && (
                <TabsTrigger value="settings">
                  <Settings />
                  설정
                </TabsTrigger>
              )}
              <TabsTrigger value="chat">
                <MessageSquare />
                채팅
              </TabsTrigger>
              <TabsTrigger value="members" className="lg:hidden">
                <Users />
                {room.members.length}
              </TabsTrigger>
              <TabsTrigger value="map" className="lg:hidden">
                <MapIcon />
                지도
              </TabsTrigger>
            </TabsList>
          </div>
          {isHost && (
            <TabsContent value="settings" className="flex min-h-0 flex-1 flex-col">
              <SettingsPanel settings={room.settings} racing={racing} />
            </TabsContent>
          )}
          <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col">
            <ChatPanel messages={room.chat} hostId={room.hostId} youId={youId} />
          </TabsContent>
          <TabsContent value="members" className="min-h-0 flex-1 overflow-y-auto p-2 lg:hidden">
            <MemberList members={room.members} hostId={room.hostId} youId={youId} />
          </TabsContent>
          <TabsContent value="map" className="min-h-0 flex-1 p-2 lg:hidden">
            <NavigatorPanel roulette={roulette} />
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  );
}
