import { useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useSessionHistory } from '@/hooks/useHistory'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import { formatDuration, sessionVolumeKg } from '@/lib/sessionStats'
import type { Session } from '@/lib/types'

function summarize(session: Session): string {
  if (session.exercises.length > 0) {
    return `${session.exercises.length} exercise${session.exercises.length > 1 ? 's' : ''} · volume ${Math.round(sessionVolumeKg(session)).toLocaleString()}kg`
  }
  if (session.cardio) {
    return `${formatDuration(session.cardio.durationSec)}${session.cardio.distanceM ? ` · ${(session.cardio.distanceM / 1000).toFixed(1)}km` : ''}`
  }
  return 'No sets logged'
}

function SessionRow({ session }: { session: Session }) {
  const runCommand = useRunCommand()
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <CardContent className="space-y-3 py-3">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                {session.name} <span className="text-xs font-normal capitalize text-muted-foreground">· {session.modality}</span>
              </span>
              <span className="block text-xs text-muted-foreground">{summarize(session)}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label="Delete session"
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
            onClick={() => void runCommand('session.delete', { sessionId: session.id })}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
        {open && (
          <div className="space-y-3 border-t border-border pt-3">
            {session.rationale && <p className="text-xs leading-relaxed text-muted-foreground">{session.rationale}</p>}
            {session.exercises.map((exercise, exerciseIndex) => (
              <div key={`${exercise.exerciseId}-${exerciseIndex}`} className="rounded-lg bg-[var(--surface-sunken)] p-3">
                <p className="text-sm font-semibold">{exercise.name}</p>
                <div className="mt-2 space-y-1">
                  {exercise.sets.map((set, setIndex) => (
                    <div key={setIndex} className="flex min-h-10 items-center gap-2 text-xs text-muted-foreground">
                      <span className="w-5 font-mono font-bold">{setIndex + 1}</span>
                      {exercise.mode === 'reps' ? (
                        <>
                          <HistoryNumber
                            label="reps"
                            value={set.reps ?? set.targetReps}
                            onCommit={(reps) => runCommand('session.update_set', { sessionId: session.id, exerciseId: exercise.exerciseId, setIndex, patch: { reps } })}
                          />
                          <span>reps</span>
                          <HistoryNumber
                            label="weight"
                            value={set.weight ?? set.targetWeight}
                            onCommit={(weight) => runCommand('session.update_set', { sessionId: session.id, exerciseId: exercise.exerciseId, setIndex, patch: { weight } })}
                          />
                          <span>kg</span>
                        </>
                      ) : (
                        <span>{formatDuration(set.durationSec ?? set.targetDurationSec ?? 0)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function HistoryNumber({ label, value, onCommit }: { label: string; value?: number; onCommit: (value: number | undefined) => Promise<unknown> }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  return (
    <input
      aria-label={label}
      type="number"
      inputMode="decimal"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void onCommit(Number(draft) || undefined)}
      className="h-9 w-16 rounded-md bg-white px-2 text-center font-mono text-sm text-foreground outline-none ring-1 ring-[var(--border-subtle)] focus:ring-2 focus:ring-[var(--focus-ring)]"
    />
  )
}

function dateHeading(date: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

export default function HistoryPage() {
  const { data: sessions, isLoading } = useSessionHistory()
  const sorted = [...(sessions ?? [])].reverse()
  const groups = sorted.reduce<Map<string, Session[]>>((result, session) => {
    result.set(session.date, [...(result.get(session.date) ?? []), session])
    return result
  }, new Map())
  const grouped = [...groups.entries()]

  return (
    <div className="space-y-3 pb-16">
      <h1 className="text-xl font-semibold tracking-tight">History</h1>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && sorted.length === 0 && <p className="text-sm text-muted-foreground">No sessions logged yet.</p>}
      <div className="space-y-5">
        {grouped.map(([date, dateSessions]) => (
          <section key={date} className="space-y-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-sm font-bold">{dateHeading(date)}</h2>
              <span className="text-[10px] font-semibold text-muted-foreground">{date}</span>
            </div>
            {dateSessions.map((session) => <SessionRow key={session.id} session={session} />)}
          </section>
        ))}
      </div>
    </div>
  )
}
