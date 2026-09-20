import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'dark' | 'light';

const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem('theme', theme);
  } catch {
    // 저장이 막힌 환경에서도 이번 세션 동안은 적용된다
  }
  for (const listener of listeners) listener();
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, current);
  const toggle = useCallback(() => setTheme(current() === 'dark' ? 'light' : 'dark'), []);
  return [theme, toggle];
}
