import type { RoomSummary } from '@shared/protocol';
import { MAX_PASSWORD_LENGTH, MAX_TITLE_LENGTH } from '@shared/protocol';
import { Crown, Lock, Plus, Users } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useClient, useClientState } from '@/net/useRoomClient';

function CreateRoomDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useClient();
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    client.createRoom(title.trim(), password);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>방 만들기</DialogTitle>
            <DialogDescription>만든 사람이 방장이 되어 설정과 시작을 맡습니다.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="room-title">방 제목</Label>
            <Input
              id="room-title"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 점심 메뉴 뽑기"
              autoFocus
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="room-password">비밀번호 (선택)</Label>
            <Input
              id="room-password"
              type="password"
              value={password}
              maxLength={MAX_PASSWORD_LENGTH}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비워두면 누구나 입장할 수 있습니다"
              autoComplete="new-password"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              만들기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function JoinRoomDialog({ room, onClose }: { room: RoomSummary | null; onClose: () => void }) {
  const client = useClient();
  const { lastError } = useClientState();
  const [password, setPassword] = useState('');

  // 다른 방을 열면 이전에 입력한 비밀번호를 지운다
  // biome-ignore lint/correctness/useExhaustiveDependencies: room?.id가 바뀔 때마다 실행해야 한다
  useEffect(() => {
    setPassword('');
    client.clearError();
  }, [room?.id, client]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (room) client.joinRoom(room.id, password);
  };

  const wrong = lastError?.code === 'wrong_password' || lastError?.code === 'rate_limited';

  return (
    <Dialog open={room !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{room?.title}</DialogTitle>
            <DialogDescription>이 방은 비밀번호가 필요합니다.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="join-password">비밀번호</Label>
            <Input
              id="join-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (wrong) client.clearError();
              }}
              aria-invalid={wrong}
              autoFocus
              autoComplete="off"
            />
            {wrong && <p className="text-sm text-destructive">{lastError?.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              취소
            </Button>
            <Button type="submit">입장</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoomCard({ room, onJoin }: { room: RoomSummary; onJoin: (room: RoomSummary) => void }) {
  const full = room.memberCount >= room.maxMembers;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-start justify-between gap-2">
          <span className="min-w-0 break-words">{room.title}</span>
          {room.hasPassword && (
            <Lock className="mt-1 size-4 shrink-0 text-muted-foreground" aria-label="비밀번호 있음" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="size-4" />
          {room.memberCount} / {room.maxMembers}
        </span>
        <span className="inline-flex items-center gap-1">
          <Crown className="size-4" />
          {room.hostNickname}
        </span>
        {room.racing && <Badge variant="secondary">진행 중</Badge>}
      </CardContent>
      <CardFooter>
        <Button className="w-full" disabled={full} onClick={() => onJoin(room)}>
          {full ? '가득 참' : '입장'}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function LobbyScreen() {
  const client = useClient();
  const { rooms, you, status } = useClientState();
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState<RoomSummary | null>(null);

  const join = (room: RoomSummary) => {
    if (room.hasPassword) setJoining(room);
    else client.joinRoom(room.id, '');
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">2말없2</h1>
          {you && (
            <p className="text-sm text-muted-foreground">
              내 닉네임 <span className="font-mono text-foreground">{you.nickname}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button onClick={() => setCreating(true)} disabled={status !== 'open'}>
            <Plus />방 만들기
          </Button>
        </div>
      </header>

      <main className="flex-1">
        {rooms.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center text-muted-foreground">
            <p>열려 있는 방이 없습니다.</p>
            <Button variant="outline" onClick={() => setCreating(true)} disabled={status !== 'open'}>
              첫 방 만들기
            </Button>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((room) => (
              <li key={room.id}>
                <RoomCard room={room} onJoin={join} />
              </li>
            ))}
          </ul>
        )}
      </main>

      <CreateRoomDialog open={creating} onOpenChange={setCreating} />
      <JoinRoomDialog room={joining} onClose={() => setJoining(null)} />
    </div>
  );
}
