import type { Member } from '@shared/protocol';
import { Crown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function MemberList({ members, hostId, youId }: { members: Member[]; hostId: string; youId: string }) {
  // 방장을 맨 위, 그 다음 나, 나머지는 입장 순서대로 보여준다
  const rank = (m: Member) => (m.id === hostId ? 0 : m.id === youId ? 1 : 2);
  const sorted = [...members].sort((a, b) => rank(a) - rank(b));

  return (
    <ul className="grid gap-1">
      {sorted.map((member) => (
        <li key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
          {member.id === hostId ? (
            <Crown className="size-4 shrink-0 text-amber-500" aria-label="방장" />
          ) : (
            <span className="size-4 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate font-mono">{member.nickname}</span>
          {member.id === hostId && <Badge variant="outline">방장</Badge>}
          {member.id === youId && <Badge>나</Badge>}
        </li>
      ))}
    </ul>
  );
}
