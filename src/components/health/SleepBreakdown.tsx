import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMinutes } from '@/lib/format'
import type { SleepScore } from '@/lib/health/sleepScore'
import { BreakdownCard, BreakdownRow } from './Breakdown'

const NEED_OPTIONS_MIN = Array.from({ length: 9 }, (_, i) => 360 + i * 30) // 6h … 10h

/** What the sleep score is made of, plus the one setting it depends on (sleep need). */
export default function SleepBreakdown({ score, onChangeNeed }: { score: SleepScore; onChangeNeed: (minutes: number) => void }) {
  const options = [...new Set([...NEED_OPTIONS_MIN, score.sleepNeedMinutes])].sort((a, b) => a - b)
  return (
    <BreakdownCard
      title="Sleep score"
      note={score.components.length === 0 ? score.note : undefined}
      aside={
        <span className="flex items-center gap-2">
          Need
          <Select value={String(score.sleepNeedMinutes)} onValueChange={(v) => onChangeNeed(Number(v))}>
            <SelectTrigger size="sm" aria-label="Sleep need">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {formatMinutes(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </span>
      }
    >
      {score.components.length > 0 && (
        <ul className="space-y-4">
          {score.components.map((c) => (
            <BreakdownRow key={c.id} label={c.label} aside={c.points === null ? 'not counted' : `${Math.round(c.points)} / ${c.max}`} detail={c.detail}>
              <Progress value={c.points === null ? 0 : (c.points / c.max) * 100} className="bg-background" />
            </BreakdownRow>
          ))}
        </ul>
      )}
      {score.note && score.components.length > 0 && <p className="text-xs text-muted-foreground">{score.note}</p>}
    </BreakdownCard>
  )
}
