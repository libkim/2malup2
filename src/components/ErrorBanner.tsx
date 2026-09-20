import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useClient, useClientState } from '@/net/useRoomClient';

/** 다이얼로그 안에서 처리하는 오류(비밀번호)를 뺀 나머지 서버 오류를 잠깐 보여준다 */
const HANDLED_INLINE = new Set(['wrong_password']);

export function ErrorBanner() {
  const client = useClient();
  const { lastError } = useClientState();
  const visible = lastError && !HANDLED_INLINE.has(lastError.code);

  // 같은 오류가 다시 와도 타이머를 새로 시작하도록 오류 id를 의존성에 둔다
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastError?.id는 타이머 재시작용이다
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => client.clearError(), 4000);
    return () => clearTimeout(timer);
  }, [visible, lastError?.id, client]);

  if (!visible) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-lg border bg-destructive px-4 py-2 text-sm text-white shadow-lg"
    >
      <span>{lastError.message}</span>
      <button
        type="button"
        onClick={() => client.clearError()}
        aria-label="닫기"
        className="opacity-80 hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
