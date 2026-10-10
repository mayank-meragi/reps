import { formatMinutes } from '@/lib/format'
import type { StrainScore } from '@/lib/health/strainScore'
import { BreakdownCard, BreakdownRow } from './Breakdown'
import IndicatorBar from './IndicatorBar'

const THRESHOLDS = [110, 130, 150] as const

/** Today's strain against the range recovery suggests, and the heart-rate effort behind it. */
export default function StrainBreakdown({ score }: { score: StrainScore }) {
  const t = score.target
  const above = score.minutesAbove
  return (
    <BreakdownCard title="Strain" note={score.note} aside={score.load !== null && `load ${score.load}`}>
      {score.score !== null && (
        <div className="space-y-2">
          <IndicatorBar value={score.score / 100} band={t ? [t.low / 100, t.high / 100] : undefined} tone="strain" />
          <p className="text-xs text-muted-foreground">
            {t ? `Today's target is ${t.low}–${t.high}% because recovery is ${t.basedOn}${t.provisional ? ' (early estimate)' : ''}. You're at ${score.score}%.` : `You're at ${score.score}%. A target needs today's recovery score.`}
          </p>
        </div>
      )}
      {above && (
        <ul className="space-y-2">
          {THRESHOLDS.map((bpm) => (
            <BreakdownRow key={bpm} label={`Above ${bpm} bpm`} aside={formatMinutes(above[bpm])} />
          ))}
          <li className="pt-1 text-xs text-muted-foreground">
            Each minute counts by how far it is over {score.params.thresholdBpm} bpm; sleep, rest and easy walking count as zero.
            {score.minutesRecorded !== null && score.minutesRecorded < 1380 && ` Only ${formatMinutes(score.minutesRecorded)} recorded so far today.`}
          </li>
        </ul>
      )}
    </BreakdownCard>
  )
}
