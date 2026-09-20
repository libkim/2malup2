import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

export function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={theme === 'dark' ? '라이트 모드로' : '다크 모드로'}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}
