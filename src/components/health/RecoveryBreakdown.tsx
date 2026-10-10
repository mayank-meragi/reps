import { Alert, AlertDescription } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import type { RecoveryScore, RecoveryZone } from '@/lib/health/recoveryScore'
import { BreakdownCard, BreakdownRow } from './Breakdown'
import IndicatorBar from './IndicatorBar'

const ZONE: Record<RecoveryZone, { label: string; text: string }> = {
  green: { label: 'Well recovered', text: 'text-zone-green' },
  yellow: { label: 'Moderate', text: 'text-zone-yellow' },
  red: { label: 'Low recovery', text: 'text-zone-red' },
}

/** z-scores are clamped to ±3, so the diverging bar maps ±3 onto the full track */
const zToPosition = (z: number) => 0.5 + z / 6

const weightLabel = (c: RecoveryScore['components'][number]) =>
  c.effectiveWeight !== null ? `${Math.round(c.effectiveWeight * 100)}% weight` : c.status === 'calibrating' ? 'calibrating' : 'no reading'

/** What the recovery score is made of: each input against the user's own baseline, and any illness flags. */
export default function RecoveryBreakdown({ score }: { score: RecoveryScore }) {
  const zone = score.zone ? ZONE[score.zone] : null
  const flagged = score.flags.filter((f) => f.penalty > 0)
  return (
    <BreakdownCard title="Recovery score" note={score.note} aside={zone ? <span className={cn('font-semibold', zone.text)}>{zone.label}</span> : score.provisionalScore !== null && `Early estimate ${score.provisionalScore}`}>
      <ul className="space-y-4">
        {score.components.map((c) => (
          <BreakdownRow key={c.id} label={c.label} aside={weightLabel(c)} detail={c.detail}>
            <IndicatorBar value={c.z === null ? null : zToPosition(c.z)} fillFrom={0.5} tone={c.z !== null && c.z < 0 ? 'attention' : 'normal'} className="h-1.5" />
          </BreakdownRow>
        ))}
      </ul>
      {flagged.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            {flagged.map((f) => (
              <p key={f.id}>
                {f.label}: {f.detail} (−{Math.round(f.penalty)})
              </p>
            ))}
          </AlertDescription>
        </Alert>
      )}
    </BreakdownCard>
  )
}
