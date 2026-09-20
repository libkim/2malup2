import type { ChatMessage } from '@shared/protocol';
import { MAX_CHAT_LENGTH } from '@shared/protocol';
import { Send } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useClient } from '@/net/useRoomClient';

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function ChatPanel({ messages, hostId, youId }: { messages: ChatMessage[]; hostId: string; youId: string }) {
  const client = useClient();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // 위로 스크롤해서 지난 대화를 읽는 중이면 새 메시지가 와도 끌어내리지 않는다
  // biome-ignore lint/correctness/useExhaustiveDependencies: 새 메시지가 올 때마다 실행해야 한다
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    client.sendChat(value);
    setText('');
    stickToBottom.current = true;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">첫 메시지를 남겨보세요.</p>
        )}
        <ul className="grid gap-1.5">
          {messages.map((m) =>
            m.from === null ? (
              <li key={m.id} className="py-0.5 text-center text-xs text-muted-foreground">
                {m.text}
              </li>
            ) : (
              <li key={m.id} className="text-sm leading-snug">
                <span className="mr-1.5 inline-flex items-center gap-1 align-baseline">
                  <span className="font-mono font-semibold">{m.from.nickname}</span>
                  {m.from.id === hostId && (
                    <Badge variant="outline" className="h-4 px-1 text-[10px]">
                      방장
                    </Badge>
                  )}
                  {m.from.id === youId && <Badge className="h-4 px-1 text-[10px]">나</Badge>}
                </span>
                <span className="break-words">{m.text}</span>
                <span className="ml-1.5 text-[10px] text-muted-foreground">{formatTime(m.at)}</span>
              </li>
            )
          )}
        </ul>
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t p-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="메시지 입력"
          aria-label="채팅 메시지"
          autoComplete="off"
        />
        <Button type="submit" size="icon" disabled={!text.trim()} aria-label="보내기">
          <Send />
        </Button>
      </form>
    </div>
  );
}
