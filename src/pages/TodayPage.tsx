import { useState } from 'react'
import { Check, Flag, Minus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { PATHS } from '@/lib/paths'
import { currentMonthKey, effectiveTodayISO } from '@/lib/dates'
import { useFileQuery } from '@/hooks/useData'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import { setSummary, completedSetCount, sessionVolumeKg, formatDuration } from '@/lib/sessionStats'
import { ExerciseThumb } from '@/components/ExerciseImage'
import ExercisePicker from '@/components/ExercisePicker'
import RestTimer from '@/components/RestTimer'
import { useAllExercises } from '@/hooks/useExercises'
import type { Exercise, Modality, Session, SessionExercise, SetEntry, VenuesFile } from '@/lib/types'

const CARDIO_MODALITIES: Modality[] = ['walk', 'run', 'cycle', 'swim', 'hike']
const MODALITY_ORDER: Modality[] = ['strength', 'walk', 'run', 'cycle', 'swim', 'hike', 'mobility', 'sport', 'other']

function isCardioModality(m: Modality): boolean {
  return CARDIO_MODALITIES.includes(m)
}

// ---- Starting a session ----

function StartSessionCard() {
  const runCommand = useRunCommand()
  const { data: venuesFile } = useFileQuery<VenuesFile>(PATHS.venues, { venues: [] })
  const venues = venuesFile?.venues ?? []
  const [modality, setModality] = useState<Modality>('strength')
  const [venueId, setVenueId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  const eligibleVenues = venues.filter((v) => v.modalities.includes(modality))

  async function start() {
    setBusy(true)
    try {
      await runCommand('session.start', { modality, venueId: venueId || undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <p className="text-sm font-semibold">Start a session</p>
        <div className="flex flex-wrap gap-1.5">
          {MODALITY_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setModality(m)
                setVenueId('')
              }}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-semibold capitalize',
                m === modality ? 'bg-[var(--ink-900)] text-white' : 'border border-input text-muted-foreground',
              )}
            >
              {m}
            </button>
          ))}
        </div>
        {eligibleVenues.length > 0 && (
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs"
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
          >
            <option value="">No venue</option>
            {eligibleVenues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        <Button size="sm" disabled={busy} onClick={() => void start()}>
          Start {modality}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---- One set row ----

function SetRow({
  sessionId,
  exercise,
  set,
  setIndex,
  onLogged,
}: {
  sessionId: string
  exercise: SessionExercise
  set: SetEntry
  setIndex: number
  onLogged: (restSeconds: number) => void
}) {
  const runCommand = useRunCommand()
  const timed = exercise.mode === 'duration'
  const [reps, setReps] = useState(String(set.reps ?? set.targetReps ?? ''))
  const [weight, setWeight] = useState(String(set.weight ?? set.targetWeight ?? ''))
  const [minutes, setMinutes] = useState(String(((set.durationSec ?? set.targetDurationSec ?? 0) / 60) || ''))

  async function commitField(patch: Partial<SetEntry>) {
    await runCommand('session.update_set', { sessionId, exerciseId: exercise.exerciseId, setIndex, patch })
  }

  async function toggleDone() {
    if (set.done) {
      await commitField({ done: false })
      return
    }
    const patch: Partial<SetEntry> = timed
      ? { durationSec: Math.round((Number(minutes) || 0) * 60) || undefined, done: true }
      : { reps: Number(reps) || undefined, weight: Number(weight) || undefined, done: true }
    await commitField(patch)
    onLogged(exercise.restSeconds ?? 90)
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5',
        set.done ? 'bg-[var(--emerald-50)]' : 'bg-[var(--surface-sunken)]',
      )}
    >
      <span className="w-5 text-center text-xs font-bold text-muted-foreground">{setIndex + 1}</span>
      {timed ? (
        <>
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            className="w-16 rounded-md bg-white/70 px-1.5 py-1 text-center font-mono text-sm tabular-nums outline-none"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={() => set.done && void commitField({ durationSec: Math.round((Number(minutes) || 0) * 60) })}
            aria-label="minutes"
          />
          <span className="flex-1 text-xs text-muted-foreground">min</span>
        </>
      ) : (
        <>
          <input
            type="number"
            inputMode="numeric"
            className="w-14 rounded-md bg-white/70 px-1.5 py-1 text-center font-mono text-sm tabular-nums outline-none"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            onBlur={() => set.done && void commitField({ reps: Number(reps) || undefined })}
            aria-label="reps"
          />
          <span className="text-xs text-muted-foreground">reps</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            className="w-16 rounded-md bg-white/70 px-1.5 py-1 text-center font-mono text-sm tabular-nums outline-none"
            placeholder="bw"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            onBlur={() => set.done && void commitField({ weight: Number(weight) || undefined })}
            aria-label="weight"
          />
          <span className="flex-1 text-xs text-muted-foreground">kg</span>
        </>
      )}
      <button
        type="button"
        aria-label={set.done ? 'Mark set not done' : 'Mark set done'}
        onClick={() => void toggleDone()}
        className={cn(
          'flex size-8 items-center justify-center rounded-full transition-colors',
          set.done ? 'bg-[var(--emerald-600)] text-white' : 'bg-white text-muted-foreground ring-1 ring-[var(--border-default)]',
        )}
      >
        <Check className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Remove set"
        className="text-muted-foreground/60 hover:text-destructive"
        onClick={() => void runCommand('session.remove_set', { sessionId, exerciseId: exercise.exerciseId, setIndex })}
      >
        <Minus className="size-3.5" />
      </button>
    </div>
  )
}

// ---- Exercise-based active session (strength / mobility / sport / other) ----

function ExerciseSessionCard({ session, onRest }: { session: Session; onRest: (seconds: number) => void }) {
  const runCommand = useRunCommand()
  const [pickerOpen, setPickerOpen] = useState(false)
  const { done, total } = completedSetCount(session.exercises)
  const { data: exercises } = useAllExercises()
  const byId = new Map(exercises.map((e) => [e.id, e]))

  return (
    <>
      <Card>
        <CardContent className="flex items-center justify-between py-3">
          <div>
            <p className="text-base font-bold">{session.name}</p>
            {total > 0 && (
              <p className="text-xs text-muted-foreground">
                {done}/{total} sets
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Discard session"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            onClick={() => void runCommand('session.delete', { sessionId: session.id })}
          >
            <Trash2 className="size-4" />
          </button>
        </CardContent>
      </Card>

      {session.exercises.map((ex) => (
        <Card key={ex.exerciseId}>
          <CardContent className="space-y-2 py-3">
            <div className="flex items-center gap-2.5">
              <ExerciseThumb exercise={byId.get(ex.exerciseId)} className="size-11" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{ex.name}</p>
                <p className="text-xs text-muted-foreground">
                  {setSummary(ex.sets)}
                  {ex.mode === 'reps' ? ` · rest ${ex.restSeconds ?? 90}s` : ''}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${ex.name}`}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                onClick={() => void runCommand('session.remove_exercise', { sessionId: session.id, exerciseId: ex.exerciseId })}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="space-y-1">
              {ex.sets.map((set, i) => (
                <SetRow key={i} sessionId={session.id} exercise={ex} set={set} setIndex={i} onLogged={onRest} />
              ))}
            </div>
            <button
              type="button"
              className="text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={() => void runCommand('session.add_set', { sessionId: session.id, exerciseId: ex.exerciseId })}
            >
              + Add set
            </button>
          </CardContent>
        </Card>
      ))}

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => setPickerOpen(true)}>
          <Plus /> Add exercise
        </Button>
        <Button className="flex-1 bg-[var(--ink-900)]" disabled={done === 0} onClick={() => void runCommand('session.finish', { sessionId: session.id })}>
          <Flag /> Finish
        </Button>
      </div>

      <ExercisePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(e: Exercise) => {
          setPickerOpen(false)
          void runCommand('session.add_exercise', { sessionId: session.id, exerciseId: e.id })
        }}
      />
    </>
  )
}

// ---- Cardio active session ----

function CardioSessionCard({ session }: { session: Session }) {
  const runCommand = useRunCommand()
  const [minutes, setMinutes] = useState('')
  const [distanceKm, setDistanceKm] = useState('')
  const [effort, setEffort] = useState<1 | 2 | 3 | 4 | 5>(3)
  const [busy, setBusy] = useState(false)

  async function logAndFinish() {
    const durationSec = Math.round((Number(minutes) || 0) * 60)
    if (durationSec <= 0) return
    setBusy(true)
    try {
      await runCommand('session.log_cardio', {
        sessionId: session.id,
        cardio: {
          durationSec,
          distanceM: Number(distanceKm) > 0 ? Number(distanceKm) * 1000 : undefined,
          effort,
        },
      })
      await runCommand('session.finish', { sessionId: session.id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between">
          <p className="text-base font-bold capitalize">{session.name}</p>
          <button
            type="button"
            aria-label="Discard session"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
            onClick={() => void runCommand('session.delete', { sessionId: session.id })}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Duration (min)</label>
            <Input type="number" inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Distance (km, optional)</label>
            <Input type="number" inputMode="decimal" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground">Effort</label>
          <div className="flex gap-1.5">
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setEffort(n)}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full text-sm font-semibold',
                  n === effort ? 'bg-[var(--ink-900)] text-white' : 'border border-input text-muted-foreground',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <Button disabled={busy || !minutes} onClick={() => void logAndFinish()}>
          <Flag /> Log & finish
        </Button>
      </CardContent>
    </Card>
  )
}

// ---- Completed session summary ----

function CompletedSessionCard({ session }: { session: Session }) {
  const summary =
    session.exercises.length > 0
      ? `${session.exercises.length} exercise${session.exercises.length > 1 ? 's' : ''} · volume ${Math.round(sessionVolumeKg(session)).toLocaleString()}kg`
      : session.cardio
        ? `${formatDuration(session.cardio.durationSec)}${session.cardio.distanceM ? ` · ${(session.cardio.distanceM / 1000).toFixed(1)}km` : ''}`
        : ''
  return (
    <Card className="border-none bg-[var(--emerald-50)]">
      <CardContent className="flex items-center gap-3 py-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-[var(--emerald-600)] text-white">
          <Check className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--emerald-700)]">{session.name} — done</p>
          <p className="text-xs text-[var(--emerald-700)]/80">{summary}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ---- Page ----

export default function TodayPage() {
  const { data: sessions } = useFileQuery<Session[]>(PATHS.sessions(currentMonthKey()), [])
  const [timer, setTimer] = useState<{ startedAt: number; seconds: number } | null>(null)
  const today = effectiveTodayISO()
  const todaySessions = (sessions ?? []).filter((s) => s.date === today)
  const active = todaySessions.find((s) => !s.endedAt) ?? null
  const completed = todaySessions.filter((s) => s.endedAt)

  return (
    <div className="space-y-3 pb-16">
      <h1 className="text-xl font-semibold tracking-tight">Today</h1>

      {completed.map((s) => (
        <CompletedSessionCard key={s.id} session={s} />
      ))}

      {active ? (
        isCardioModality(active.modality) ? (
          <CardioSessionCard session={active} />
        ) : (
          <ExerciseSessionCard session={active} onRest={(seconds) => setTimer({ startedAt: Date.now(), seconds })} />
        )
      ) : (
        <StartSessionCard />
      )}

      <RestTimer timer={timer} onDone={() => setTimer(null)} />
    </div>
  )
}
