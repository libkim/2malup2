import {
  countMarbles,
  MAX_MARBLES,
  normalizeNames,
  type RoomSettings,
  splitNames,
  type WinnerMode,
} from '@shared/settings';
import { Play, Shuffle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { stages } from '@/data/maps';
import { useClient } from '@/net/useRoomClient';

const WINNER_MODES: { value: WinnerMode; label: string }[] = [
  { value: 'first', label: '1등' },
  { value: 'last', label: '꼴등' },
  { value: 'custom', label: 'N등' },
  { value: 'multi', label: '범위' },
];

function NumberField({ id, value, onChange }: { id: string; value: number; onChange: (value: number) => void }) {
  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      min={1}
      max={MAX_MARBLES}
      value={value}
      onChange={(e) => {
        const n = Number.parseInt(e.target.value, 10);
        if (Number.isFinite(n)) onChange(Math.min(MAX_MARBLES, Math.max(1, n)));
      }}
      className="w-20"
    />
  );
}

/** 방장 전용. 바꾸는 즉시 모든 참가자의 화면에 미리보기로 반영된다 */
export function SettingsPanel({ settings, racing }: { settings: RoomSettings; racing: boolean }) {
  const client = useClient();
  const update = (patch: Partial<RoomSettings>) => client.updateSettings(patch);
  const marbleCount = countMarbles(splitNames(settings.names));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <fieldset
        disabled={racing}
        className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto p-3 disabled:opacity-60"
      >
        <div className="grid gap-2">
          <Label htmlFor="names" className="flex items-baseline justify-between">
            <span>참가자</span>
            <span className="text-xs font-normal text-muted-foreground">구슬 {marbleCount}개</span>
          </Label>
          <Textarea
            id="names"
            value={settings.names}
            onChange={(e) => update({ names: e.target.value })}
            // 같은 이름을 "이름*개수"로 합친다. 입력 중에 바뀌면 커서가 튀므로 포커스를 잃을 때만 한다
            onBlur={() => {
              const normalized = normalizeNames(settings.names);
              if (normalized !== settings.names) update({ names: normalized });
            }}
            placeholder={'쉼표나 줄바꿈으로 구분\n이름/가중치*개수 (예: 홍길동/3*2)'}
            rows={5}
            className="resize-y font-mono text-sm"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="stage">맵</Label>
          <Select value={String(settings.stageIndex)} onValueChange={(v) => update({ stageIndex: Number(v) })}>
            <SelectTrigger id="stage" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stages.map((stage, i) => (
                <SelectItem key={stage.title} value={String(i)}>
                  {stage.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>당첨자</Label>
          <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="당첨 방식">
            {WINNER_MODES.map((mode) => (
              <Button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={settings.winnerMode === mode.value}
                size="sm"
                variant={settings.winnerMode === mode.value ? 'default' : 'outline'}
                onClick={() => update({ winnerMode: mode.value })}
              >
                {mode.label}
              </Button>
            ))}
          </div>
          {settings.winnerMode === 'custom' && (
            <div className="flex items-center gap-2 text-sm">
              <NumberField id="rank" value={settings.rank} onChange={(rank) => update({ rank })} />
              <span>등</span>
            </div>
          )}
          {settings.winnerMode === 'multi' && (
            <div className="flex items-center gap-2 text-sm">
              <NumberField
                id="range-start"
                value={settings.rangeStart}
                onChange={(rangeStart) => update({ rangeStart, rangeEnd: Math.max(rangeStart, settings.rangeEnd) })}
              />
              <span>등 ~</span>
              <NumberField
                id="range-end"
                value={settings.rangeEnd}
                onChange={(rangeEnd) => update({ rangeEnd, rangeStart: Math.min(rangeEnd, settings.rangeStart) })}
              />
              <span>등</span>
            </div>
          )}
        </div>

        <div className="grid gap-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="skills">스킬 사용</Label>
            <Switch id="skills" checked={settings.useSkills} onCheckedChange={(useSkills) => update({ useSkills })} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="ff">2배속</Label>
            <Switch id="ff" checked={settings.fastForward} onCheckedChange={(fastForward) => update({ fastForward })} />
          </div>
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-2 border-t p-3">
        <Button variant="outline" onClick={() => client.shuffle()} disabled={racing}>
          <Shuffle />
          섞기
        </Button>
        <Button onClick={() => client.start()} disabled={racing || marbleCount < 1}>
          <Play />
          시작
        </Button>
      </div>
    </div>
  );
}
