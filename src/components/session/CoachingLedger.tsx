import { Activity, ArrowRight, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionPrescription } from '@/lib/types'

const CODE_LABELS: Record<string, string> = {
  SAFETY_CONSTRAINT: 'Safety',
  USER_REQUEST: 'Your request',
  PROGRAM_CONTINUITY: 'Program continuity',
  WEEKLY_TARGET_GAP: 'Weekly target',
  RECENT_MUSCLE_STIMULUS: 'Recent training',
  RECOVERY_REDUCED: 'Recovery adjustment',
  NORMAL_READINESS: 'Readiness',
  VOLUME_BELOW_TARGET: 'Volume opportunity',
  VOLUME_ABOVE_TARGET: 'Volume limit',
  EXERCISE_CONTINUITY: 'Exercise continuity',
  LOAD_PROGRESSION_AVAILABLE: 'Progression',
  TIME_CONSTRAINT: 'Time',
  VENUE_CONSTRAINT: 'Venue',
  PREFERENCE: 'Preference',
  MODALITY_CHANGED: 'Modality change',
}

export default function CoachingLedger({ prescription, dark = false }: { prescription: SessionPrescription; dark?: boolean }) {
  const assessment = prescription.stimulusAssessment
  if (!assessment) return null
  const evidence = prescription.reasonCodes ?? assessment.evidence
  const decisions = prescription.exerciseDecisions ?? []

  return (
    <details className={cn(
      'group overflow-hidden rounded-xl ring-1',
      dark ? 'bg-white/[0.06] ring-white/10' : 'bg-[var(--surface-sunken)] ring-foreground/[0.06]',
    )}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', dark ? 'bg-[var(--emerald-300)]/15 text-[var(--emerald-300)]' : 'bg-primary/10 text-primary')}>
            <Activity className="size-4" />
          </span>
          <span className="min-w-0">
            <span className={cn('block text-[10px] font-bold uppercase tracking-[0.13em]', dark ? 'text-white/45' : 'text-muted-foreground')}>Coaching ledger</span>
            <span className={cn('block truncate text-xs font-semibold capitalize', dark ? 'text-white/90' : 'text-foreground')}>
              {assessment.primaryAdaptation} · {assessment.systemicFatigue} fatigue
            </span>
          </span>
        </span>
        <ArrowRight className={cn('size-4 shrink-0 transition-transform group-open:rotate-90', dark ? 'text-white/40' : 'text-muted-foreground')} />
      </summary>

      <div className={cn('space-y-4 border-t px-3 pb-3 pt-3', dark ? 'border-white/10' : 'border-border')}>
        {assessment.muscleTargets.length > 0 && (
          <div>
            <p className={cn('text-[9px] font-bold uppercase tracking-[0.12em]', dark ? 'text-white/40' : 'text-muted-foreground')}>Intended stimulus</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {assessment.muscleTargets.map((target) => (
                <span key={`${target.muscle}-${target.stimulus}`} className={cn(
                  'rounded-full px-2 py-1 text-[10px] font-semibold capitalize',
                  dark ? 'bg-white/[0.08] text-white/75' : 'bg-background text-foreground ring-1 ring-border',
                )}>{target.muscle} · {target.stimulus}</span>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className={cn('flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em]', dark ? 'text-white/40' : 'text-muted-foreground')}><ShieldCheck className="size-3" /> Evidence</p>
          <div className="mt-2 space-y-2">
            {evidence.map((item, index) => (
              <div key={`${item.code}-${item.subject ?? ''}-${index}`} className="grid grid-cols-[6.5rem_1fr] gap-2 text-[10px] leading-relaxed">
                <span className={cn('font-bold', dark ? 'text-[var(--emerald-300)]' : 'text-primary')}>{CODE_LABELS[item.code] ?? item.code}</span>
                <span className={dark ? 'text-white/60' : 'text-muted-foreground'}>{item.subject ? `${item.subject}: ` : ''}{item.detail}</span>
              </div>
            ))}
          </div>
        </div>

        {decisions.length > 0 && (
          <div>
            <p className={cn('text-[9px] font-bold uppercase tracking-[0.12em]', dark ? 'text-white/40' : 'text-muted-foreground')}>Movement continuity</p>
            <div className="mt-2 space-y-2">
              {decisions.map((decision) => (
                <div key={decision.exerciseId} className={cn('border-l-2 pl-2 text-[10px] leading-relaxed', dark ? 'border-white/15 text-white/60' : 'border-border text-muted-foreground')}>
                  <span className={cn('font-bold capitalize', dark ? 'text-white/85' : 'text-foreground')}>{decision.continuity}</span>
                  {' · '}{decision.purpose}. {decision.selectionRationale}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  )
}
