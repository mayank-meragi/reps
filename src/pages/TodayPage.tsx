import { useEffect, useState } from 'react'
import { ArrowLeftRight, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Flag, MapPin, Minus, Plus, Sparkles, Trash2, TrendingUp, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { PATHS } from '@/lib/paths'
import { currentMonthKey, effectiveTodayISO } from '@/lib/dates'
import { useFileQuery } from '@/hooks/useData'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import { completedSetCount, sessionVolumeKg, formatDuration, lastPerformanceSummary } from '@/lib/sessionStats'
import { plateMath, STANDARD_BARBELL_KG, STANDARD_PLATE_INVENTORY_KG } from '@/lib/engine'
import { ExerciseDetailsTrigger } from '@/components/ExerciseImage'
import ExercisePicker from '@/components/ExercisePicker'
import NextSessionCard from '@/components/session/NextSessionCard'
import { useAllExercises } from '@/hooks/useExercises'
import { selectNextSession } from '@/lib/selectors/session'
import type { Exercise, Modality, Profile, ProgramsIndexFile, ReadinessFile, Session, SessionExercise, SetEntry, VenuesFile, WeeklyReviewsFile } from '@/lib/types'

const MODALITY_ORDER: Modality[] = ['strength', 'walk', 'run', 'cycle', 'swim', 'hike', 'mobility', 'sport', 'other']

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
    <details className="rounded-xl bg-card shadow-sm ring-1 ring-foreground/[0.045]">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted-foreground">Start without an AI prescription</summary>
      <div className="space-y-3 border-t border-border px-4 py-4">
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
      </div>
    </details>
  )
}

// ---- Adaptive daily prescription ----

function GenerateTodayCard({ programName, compact = false }: { programName: string; compact?: boolean }) {
  const runCommand = useRunCommand()
  const { data: venuesFile } = useFileQuery<VenuesFile>(PATHS.venues, { venues: [] })
  const venues = venuesFile?.venues ?? []
  const [considerations, setConsiderations] = useState('')
  const [availableMinutes, setAvailableMinutes] = useState('')
  const [venueId, setVenueId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [energy, setEnergy] = useState<number | null>(null)
  const [soreness, setSoreness] = useState<number | null>(null)
  const [sleepHours, setSleepHours] = useState('')

  async function generate(overrideConsiderations?: string) {
    setBusy(true)
    setError(null)
    setProgress('Saving today’s context…')
    try {
      if (energy || soreness || Number(sleepHours) > 0) {
        await runCommand('body.log_readiness', {
          energy: energy ?? undefined,
          soreness: soreness ?? undefined,
          sleepHours: Number(sleepHours) || undefined,
        })
      }
      await runCommand('program.generate_today', {
        considerations: overrideConsiderations ?? (considerations.trim() || undefined),
        availableMinutes: Number(availableMinutes) || undefined,
        venueId: venueId || undefined,
      }, { onProgress: setProgress })
      setConsiderations('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare today’s session')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <Card className={cn('border-none', compact ? 'bg-[var(--surface-sunken)]' : 'bg-[var(--ink-900)] text-white')}>
      <CardContent className="space-y-3 py-4">
        <div>
          {!compact && <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--emerald-300)]">Today’s decision</p>}
          <p className={cn('font-bold', compact ? 'text-sm' : 'text-lg')}>{compact ? 'Revise today' : 'Build today around you'}</p>
          <p className={cn('text-xs', compact ? 'text-muted-foreground' : 'text-white/70')}>From “{programName}”, adapted to everything you have logged.</p>
        </div>
        <Input
          value={considerations}
          onChange={(event) => setConsiderations(event.target.value)}
          placeholder='“Not feeling good”, “keep it light”, “weather is bad”, “just walk”…'
          className={compact ? '' : 'border-white/20 bg-white/10 text-white placeholder:text-white/50'}
        />
        {compact && (
          <div className="flex flex-wrap gap-1.5">
            {[
              ['Make easier', 'Reduce today’s difficulty and use conservative loads.'],
              ['Make shorter', 'Shorten today’s session while preserving the most important work.'],
              ['More recovery', 'Prioritize recovery and reduce fatigue today.'],
            ].map(([label, request]) => (
              <button
                key={label}
                type="button"
                disabled={busy}
                onClick={() => void generate(request)}
                className="rounded-full border border-input bg-background px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {!compact && (
          <div className="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">Quick readiness</p>
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem] gap-2">
              <select
                aria-label="Energy"
                value={energy ?? ''}
                onChange={(event) => setEnergy(Number(event.target.value) || null)}
                className="h-9 min-w-0 rounded-md border border-white/15 bg-white/10 px-2 text-sm text-white"
              >
                <option className="text-foreground" value="">Energy</option>
                {[1, 2, 3, 4, 5].map((value) => <option className="text-foreground" key={value} value={value}>Energy {value}/5</option>)}
              </select>
              <select
                aria-label="Soreness"
                value={soreness ?? ''}
                onChange={(event) => setSoreness(Number(event.target.value) || null)}
                className="h-9 min-w-0 rounded-md border border-white/15 bg-white/10 px-2 text-sm text-white"
              >
                <option className="text-foreground" value="">Soreness</option>
                {[1, 2, 3, 4, 5].map((value) => <option className="text-foreground" key={value} value={value}>Soreness {value}/5</option>)}
              </select>
              <Input
                aria-label="Sleep hours"
                type="number"
                step="0.5"
                value={sleepHours}
                onChange={(event) => setSleepHours(event.target.value)}
                placeholder="Sleep h"
                className="min-w-0 border-white/20 bg-white/10 text-white placeholder:text-white/50"
              />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            inputMode="numeric"
            value={availableMinutes}
            onChange={(event) => setAvailableMinutes(event.target.value)}
            placeholder="Minutes available"
            className={compact ? '' : 'border-white/20 bg-white/10 text-white placeholder:text-white/50'}
          />
          <select
            value={venueId}
            onChange={(event) => setVenueId(event.target.value)}
            className={cn('h-9 rounded-md border px-2 text-sm', compact ? 'border-input bg-background' : 'border-white/20 bg-white/10 text-white')}
          >
            <option className="text-foreground" value="">Any venue</option>
            {venues.map((venue) => <option className="text-foreground" key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
        </div>
        {error && <p className={cn('text-xs', compact ? 'text-destructive' : 'text-red-300')}>{error}</p>}
        {busy && progress && (
          <div className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-xs', compact ? 'bg-[var(--surface-sunken)] text-muted-foreground' : 'bg-white/10 text-white/80')}>
            <span className="size-1.5 animate-pulse rounded-full bg-current" />
            {progress}
          </div>
        )}
        <Button size="sm" className={cn(!compact && 'w-full bg-white text-[var(--ink-900)] hover:bg-white/90')} disabled={busy} onClick={() => void generate()}>
          <Sparkles className="size-4" /> {busy ? 'Adapting…' : compact ? 'Regenerate' : 'Ask AI to plan today'}
        </Button>
      </CardContent>
    </Card>
  )
}

export function PrescriptionCard({ session, programName }: { session: Session; programName: string }) {
  const runCommand = useRunCommand()
  const [busy, setBusy] = useState(false)
  const [swappingId, setSwappingId] = useState<string | null>(null)
  const [swapError, setSwapError] = useState<string | null>(null)
  const { data: exercises } = useAllExercises()
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]))
  const target = session.prescription?.target

  async function begin() {
    setBusy(true)
    try {
      await runCommand('session.begin', { sessionId: session.id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <Card className="border-none bg-[var(--ink-900)] text-white">
        <CardContent className="space-y-3 py-4">
          <div>
            <p className="text-xs text-white/60">Today · {programName}</p>
            <p className="text-lg font-bold">{session.name}</p>
            <p className="text-xs capitalize text-white/70">{session.modality}{session.focus.length ? ` · ${session.focus.join(' · ')}` : ''}</p>
          </div>
          {session.exercises.length > 0 && (
            <div className="space-y-1.5 rounded-xl bg-white/8 p-2 ring-1 ring-white/10">
              {session.exercises.map((exercise) => {
                const details = byId.get(exercise.exerciseId)
                const targetWeight = exercise.sets.find((set) => set.targetWeight)?.targetWeight
                const targetReps = exercise.sets[0]?.targetReps
                const equipment = details?.equipment?.toLowerCase()
                const load = targetWeight
                  ? `${targetWeight} kg${equipment === 'dumbbell' || equipment === 'kettlebells' ? ' each' : equipment === 'barbell' ? ' total' : ''}`
                  : equipment === 'body only' ? 'bodyweight' : undefined
                return (
                  <div key={exercise.exerciseId} className="flex items-center gap-2.5 rounded-lg bg-white/6 p-2">
                    <ExerciseDetailsTrigger exercise={details} className="size-11 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{exercise.name}</p>
                      <p className="truncate text-xs text-white/60">
                        {exercise.sets.length}×{targetReps ?? '?'}{load ? ` · ${load}` : ''}
                      </p>
                      {details && <p className="truncate text-[10px] capitalize text-white/45">{details.primaryMuscles.join(', ')} · {details.equipment ?? 'no equipment'}</p>}
                      {exercise.notes && <p className="mt-1 text-[10px] leading-snug text-white/55">{exercise.notes}</p>}
                    </div>
                    <button
                      type="button"
                      disabled={Boolean(swappingId)}
                      aria-label={`Ask AI to substitute ${exercise.name}`}
                      onClick={() => {
                        setSwapError(null)
                        setSwappingId(exercise.exerciseId)
                        void runCommand('session.substitute_exercise', { sessionId: session.id, exerciseId: exercise.exerciseId })
                          .catch((error) => setSwapError(error instanceof Error ? error.message : 'Could not substitute this exercise'))
                          .finally(() => setSwappingId(null))
                      }}
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-white/65 hover:bg-white/10 hover:text-white"
                    >
                      {swappingId === exercise.exerciseId ? <Sparkles className="size-4 animate-pulse" /> : <ArrowLeftRight className="size-4" />}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          {target && (
            <p className="rounded-lg bg-white/10 px-3 py-2 text-sm">
              {[target.durationMin && `${target.durationMin} min`, target.distanceKm && `${target.distanceKm} km`, target.style, target.effort && `effort ${target.effort}/5`].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="text-sm text-white/80">{session.prescription?.rationale ?? session.rationale}</p>
          {(session.prescription?.contextSummary.length ?? 0) > 0 && (
            <details className="rounded-lg bg-white/8 px-3 py-2 text-xs text-white/65">
              <summary className="cursor-pointer font-semibold text-white/80">Why this workout?</summary>
              <ul className="mt-2 space-y-1">
                {session.prescription?.contextSummary.map((item) => <li key={item}>• {item}</li>)}
              </ul>
            </details>
          )}
          {swapError && <p className="text-xs text-red-300">{swapError}</p>}
          {session.prescription?.considerations && <p className="text-xs text-white/60">Considered: “{session.prescription.considerations}”</p>}
          <div className="flex gap-2">
            <Button className="bg-white text-[var(--ink-900)] hover:bg-white/90" disabled={busy} onClick={() => void begin()}>
              {busy ? 'Starting…' : 'Start session'}
            </Button>
            <Button variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={() => void runCommand('session.delete', { sessionId: session.id })}>Discard</Button>
          </div>
        </CardContent>
      </Card>
      <GenerateTodayCard programName={programName} compact />
    </div>
  )
}

// ---- One set row ----

function SetRow({
  sessionId,
  exercise,
  catalogExercise,
  previousSet,
  set,
  setIndex,
  onLogged,
}: {
  sessionId: string
  exercise: SessionExercise
  catalogExercise?: Exercise
  previousSet?: SetEntry
  set: SetEntry
  setIndex: number
  onLogged: (restSeconds: number) => void
}) {
  const runCommand = useRunCommand()
  const { data: profile } = useFileQuery<Profile | null>(PATHS.profile, null)
  const timed = exercise.mode === 'duration'
  const [reps, setReps] = useState(String(set.reps ?? set.targetReps ?? ''))
  const [weight, setWeight] = useState(String(set.weight ?? set.targetWeight ?? ''))
  const [minutes, setMinutes] = useState(String(((set.durationSec ?? set.targetDurationSec ?? 0) / 60) || ''))

  const weightNum = Number(weight)
  const barKg = profile?.barbellWeight ?? STANDARD_BARBELL_KG
  const equipment = catalogExercise?.equipment?.toLowerCase() ?? ''
  const isBarbell = equipment === 'barbell'
  const isPerImplement = equipment === 'dumbbell' || equipment === 'kettlebells' || equipment === 'kettlebell'
  const isBodyweight = equipment === 'body only' || equipment === 'bodyweight'
  const plates =
    !timed && isBarbell && weightNum > barKg
      ? plateMath(weightNum, barKg, profile?.plateInventory ?? STANDARD_PLATE_INVENTORY_KG)
      : null
  const loadLabel = isBodyweight
    ? weightNum > 0 ? 'kg added' : 'bodyweight'
    : isPerImplement ? 'kg each' : 'kg'
  const previousLabel = timed
    ? previousSet ? `${Math.round((previousSet.durationSec ?? previousSet.targetDurationSec ?? 0) / 60)}m` : '—'
    : previousSet
      ? `${previousSet.weight ?? previousSet.targetWeight ?? '—'}×${previousSet.reps ?? previousSet.targetReps ?? '—'}`
      : '—'

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
        'flex min-h-14 flex-wrap items-center gap-2 rounded-lg px-2 py-2',
        set.done ? 'bg-[var(--emerald-50)]' : 'bg-[var(--surface-sunken)]',
      )}
    >
      <span className="flex w-10 shrink-0 flex-col items-center text-center">
        <span className="text-xs font-bold text-foreground">{setIndex + 1}</span>
        <span className="font-mono text-[9px] text-muted-foreground">{previousLabel}</span>
      </span>
      {timed ? (
        <>
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            className="h-11 w-16 rounded-md bg-white/80 px-1.5 text-center font-mono text-base tabular-nums outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
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
            className="h-11 w-14 rounded-md bg-white/80 px-1.5 text-center font-mono text-base tabular-nums outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
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
            className="h-11 w-16 rounded-md bg-white/80 px-1.5 text-center font-mono text-base tabular-nums outline-none focus:ring-2 focus:ring-[var(--focus-ring)]"
            placeholder="bw"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            onBlur={() => set.done && void commitField({ weight: Number(weight) || undefined })}
            aria-label="weight"
          />
          <span className="text-xs text-muted-foreground">
            {loadLabel}<span className="hidden sm:inline">{plates && plates.perSide.length > 0 ? ` · ${plates.perSide.join('+')}/side` : ''}</span>
          </span>
        </>
      )}
      <button
        type="button"
        aria-label={set.done ? 'Mark set not done' : 'Mark set done'}
        onClick={() => void toggleDone()}
        className={cn(
          'ml-auto flex size-11 shrink-0 items-center justify-center rounded-full transition-colors',
          set.done ? 'bg-[var(--emerald-600)] text-white' : 'bg-white text-muted-foreground ring-1 ring-[var(--border-default)]',
        )}
      >
        <Check className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Remove set"
        className="hidden size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-white hover:text-destructive sm:flex"
        onClick={() => void runCommand('session.remove_set', { sessionId, exerciseId: exercise.exerciseId, setIndex })}
      >
        <Minus className="size-3.5" />
      </button>
      {plates && plates.perSide.length > 0 && <span className="basis-full pr-12 text-right font-mono text-[9px] text-muted-foreground sm:hidden">Load {plates.perSide.join('+')} kg per side</span>}
    </div>
  )
}

function ExerciseNoteEditor({ sessionId, exercise }: { sessionId: string; exercise: SessionExercise }) {
  const runCommand = useRunCommand()
  const [note, setNote] = useState(exercise.userNote ?? '')
  return (
    <details className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">{note ? 'Exercise note' : 'Add note'}</summary>
      <Input
        className="mt-2 bg-white"
        value={note}
        placeholder="Form cue, discomfort, setup preference…"
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => void runCommand('session.update_exercise_note', { sessionId, exerciseId: exercise.exerciseId, note })}
      />
    </details>
  )
}

// ---- Venue switcher (shared by both active-session card types) ----

function VenueSwitcher({ session }: { session: Session }) {
  const runCommand = useRunCommand()
  const { data: venuesFile } = useFileQuery<VenuesFile>(PATHS.venues, { venues: [] })
  const venues = venuesFile?.venues ?? []
  const [warning, setWarning] = useState<string | null>(null)
  if (venues.length === 0) return null

  async function switchVenue(venueId: string) {
    setWarning(null)
    const result = await runCommand<{ sessionId: string; venueId: string }, { unsupported: string[] }>('session.set_venue', {
      sessionId: session.id,
      venueId,
    })
    if (result.unsupported.length > 0) {
      setWarning(`${result.unsupported.join(', ')} may not be available here — swap manually if needed.`)
    }
  }

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
      <select
        className="h-6 rounded-full border-none bg-transparent text-xs text-muted-foreground outline-none"
        value={session.venueId ?? ''}
        onChange={(e) => void switchVenue(e.target.value)}
      >
        <option value="">No venue</option>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      {warning && <span className="text-[10px] text-amber-600">{warning}</span>}
    </div>
  )
}

// ---- Exercise-based active session (strength / mobility / sport / other) ----

export function ExerciseSessionCard({ session, sessions, onRest }: { session: Session; sessions: Session[]; onRest: (seconds: number) => void }) {
  const runCommand = useRunCommand()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [swappingId, setSwappingId] = useState<string | null>(null)
  const [swapError, setSwapError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(() => {
    const firstIncomplete = session.exercises.findIndex((exercise) => exercise.sets.some((set) => !set.done))
    return firstIncomplete >= 0 ? firstIncomplete : 0
  })
  const { done, total } = completedSetCount(session.exercises)
  const { data: exercises } = useAllExercises()
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const activeExercise = session.exercises[activeIndex]
  const elapsedMinutes = session.startedAt ? Math.max(1, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000)) : 0
  let previousExercise: SessionExercise | undefined
  if (activeExercise) {
    const priorSessions = [...sessions]
      .filter((item) => item.id !== session.id && item.endedAt)
      .sort((a, b) => `${b.date}${b.updatedAt}`.localeCompare(`${a.date}${a.updatedAt}`))
    for (const prior of priorSessions) {
      const match = prior.exercises.find((exercise) => exercise.exerciseId === activeExercise.exerciseId)
      if (match) {
        previousExercise = match
        break
      }
    }
  }

  useEffect(() => {
    if (activeIndex >= session.exercises.length) setActiveIndex(Math.max(0, session.exercises.length - 1))
    const current = session.exercises[activeIndex]
    if (current && current.sets.length > 0 && current.sets.every((set) => set.done)) {
      const nextIncomplete = session.exercises.findIndex((exercise, index) => index > activeIndex && exercise.sets.some((set) => !set.done))
      if (nextIncomplete >= 0) setActiveIndex(nextIncomplete)
    }
  }, [session.exercises, activeIndex])

  return (
    <>
      <Card className="border-none bg-[var(--ink-900)] text-white">
        <CardContent className="space-y-3 py-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--emerald-300)]">Workout in progress</p>
              <p className="mt-1 text-lg font-bold">{session.name}</p>
              {session.focus.length > 0 && <p className="mt-0.5 text-xs capitalize text-white/55">{session.focus.join(' · ')}</p>}
            </div>
            <button
              type="button"
              aria-label="Discard session"
              className="flex size-10 items-center justify-center rounded-full text-white/55 hover:bg-white/10 hover:text-white"
              onClick={() => void runCommand('session.delete', { sessionId: session.id })}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 divide-x divide-white/10 rounded-xl bg-white/8 py-2 ring-1 ring-white/10">
            <div className="px-3 text-center"><Clock3 className="mx-auto size-4 text-[var(--emerald-300)]" /><p className="mt-1 font-mono text-sm font-bold">{elapsedMinutes}m</p><p className="text-[9px] text-white/45">Elapsed</p></div>
            <div className="px-3 text-center"><CalendarDays className="mx-auto size-4 text-[var(--emerald-300)]" /><p className="mt-1 font-mono text-sm font-bold">{activeIndex + 1}/{session.exercises.length}</p><p className="text-[9px] text-white/45">Exercise</p></div>
            <div className="px-3 text-center"><Check className="mx-auto size-4 text-[var(--emerald-300)]" /><p className="mt-1 font-mono text-sm font-bold">{done}/{total}</p><p className="text-[9px] text-white/45">Sets</p></div>
          </div>
          <div className="[&_select]:text-white/60 [&_svg]:text-white/45"><VenueSwitcher session={session} /></div>
        </CardContent>
      </Card>

      {session.exercises.length > 0 && (
        <div className="relative space-y-2 rounded-xl bg-white/45 p-2 ring-1 ring-[var(--border-subtle)]">
          <div className="absolute bottom-5 left-[1.38rem] top-5 w-px bg-[var(--ink-150)]" />
          {session.exercises.map((exercise, index) => {
            const completedSets = exercise.sets.filter((set) => set.done).length
            const complete = exercise.sets.length > 0 && completedSets === exercise.sets.length
            if (index === activeIndex) {
              const details = byId.get(exercise.exerciseId)
              const ghost = lastPerformanceSummary(exercise.exerciseId, sessions, session.id)
              return (
                <div key={`${exercise.exerciseId}-${index}`} className="relative overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-[var(--ink-150)]">
                  <div className="flex items-center gap-3 bg-[var(--ink-900)] px-2 py-2.5 text-white">
                    <span className="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-[var(--ink-900)] ring-2 ring-[var(--ink-900)]">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{exercise.name}</p>
                      <p className="text-[11px] text-white/55">{completedSets}/{exercise.sets.length} sets · rest {exercise.restSeconds ?? 90}s</p>
                    </div>
                  </div>
                  <div className="space-y-3 p-3">
                    <div className="flex items-start gap-3">
                      <ExerciseDetailsTrigger exercise={details} className="size-16 shrink-0" />
                      <div className="min-w-0 flex-1">
                        {details && <p className="text-xs capitalize text-muted-foreground">{details.primaryMuscles.join(', ')} · {details.equipment ?? 'no equipment'}</p>}
                        {ghost && <p className="mt-1 text-[11px] text-muted-foreground">Last time: {ghost}</p>}
                        {exercise.notes && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{exercise.notes}</p>}
                      </div>
                      <div className="flex">
                        <button
                          type="button"
                          aria-label={`Ask AI to substitute ${exercise.name}`}
                          disabled={Boolean(swappingId)}
                          className="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => {
                            setSwapError(null)
                            setSwappingId(exercise.exerciseId)
                            void runCommand('session.substitute_exercise', { sessionId: session.id, exerciseId: exercise.exerciseId })
                              .catch((error) => setSwapError(error instanceof Error ? error.message : 'Could not find a substitution'))
                              .finally(() => setSwappingId(null))
                          }}
                        >
                          {swappingId === exercise.exerciseId ? <Sparkles className="size-4 animate-pulse" /> : <ArrowLeftRight className="size-4" />}
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${exercise.name}`}
                          className="flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
                          onClick={() => void runCommand('session.remove_exercise', { sessionId: session.id, exerciseId: exercise.exerciseId })}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-2 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                      <span>Set · previous</span><span>Today</span><span>Done</span>
                    </div>
                    <div className="space-y-1">
                      {exercise.sets.map((set, setIndex) => (
                        <SetRow
                          key={setIndex}
                          sessionId={session.id}
                          exercise={exercise}
                          catalogExercise={details}
                          previousSet={previousExercise?.sets[setIndex]}
                          set={set}
                          setIndex={setIndex}
                          onLogged={onRest}
                        />
                      ))}
                    </div>
                    <ExerciseNoteEditor sessionId={session.id} exercise={exercise} />
                    <div className="flex items-center justify-between">
                      <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => void runCommand('session.add_set', { sessionId: session.id, exerciseId: exercise.exerciseId })}>+ Add set</button>
                      <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => void window.dispatchEvent(new Event('reps:open-assistant'))}>Ask coach</button>
                    </div>
                  </div>
                </div>
              )
            }
            return (
              <button
                key={`${exercise.exerciseId}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={cn(
                  'relative flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors',
                  complete ? 'bg-[var(--emerald-50)] hover:bg-[var(--emerald-100)]' : 'hover:bg-white',
                )}
              >
                <span className={cn(
                  'relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2',
                  complete ? 'bg-[var(--emerald-600)] text-white ring-white' : 'bg-white text-muted-foreground ring-[var(--ink-100)]',
                )}>
                  {complete ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{exercise.name}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {completedSets}/{exercise.sets.length} sets
                  </span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground/50" />
              </button>
            )
          })}
        </div>
      )}

      <div className="sticky bottom-28 z-10 rounded-2xl bg-white/92 p-2 shadow-xl ring-1 ring-[var(--border-default)] backdrop-blur md:bottom-4">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous exercise"
            disabled={activeIndex <= 0}
            onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setPickerOpen(true)}>
            <Plus /> Exercise
          </Button>
          {activeIndex < session.exercises.length - 1 ? (
            <Button className="flex-1 bg-[var(--ink-900)]" onClick={() => setActiveIndex((index) => Math.min(session.exercises.length - 1, index + 1))}>
              Next <ChevronRight />
            </Button>
          ) : (
            <Button className="flex-1 bg-[var(--ink-900)]" disabled={done === 0} onClick={() => void runCommand('session.finish', { sessionId: session.id })}>
              <Flag /> Finish
            </Button>
          )}
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--ink-100)]">
          <div className="h-full bg-[var(--emerald-500)] transition-[width]" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
        </div>
      </div>
      {swapError && <p className="text-xs text-destructive">{swapError}</p>}

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

export function CardioSessionCard({ session }: { session: Session }) {
  const runCommand = useRunCommand()
  const target = session.prescription?.target
  const [minutes, setMinutes] = useState(target?.durationMin ? String(target.durationMin) : '')
  const [distanceKm, setDistanceKm] = useState(target?.distanceKm ? String(target.distanceKm) : '')
  const [effort, setEffort] = useState<1 | 2 | 3 | 4 | 5>(target?.effort ?? 3)
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
          <div>
            <p className="text-base font-bold capitalize">{session.name}</p>
            <VenueSwitcher session={session} />
          </div>
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

// ---- Action-first home ----

function HomeHeader() {
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())
  return (
    <div className="px-1 pb-1 pt-1">
      <p className="text-xs font-semibold text-muted-foreground">{date}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{greeting}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Let today’s training fit the day you actually have.</p>
    </div>
  )
}

function WeeklyProgress({ sessions }: { sessions: Session[] }) {
  const { data: profile } = useFileQuery<Profile | null>(PATHS.profile, null)
  const { data: readinessFile } = useFileQuery<ReadinessFile>(PATHS.readiness, { entries: [] })
  const today = effectiveTodayISO()
  const todayDate = new Date(`${today}T12:00:00`)
  const monday = new Date(todayDate)
  const weekday = monday.getDay() || 7
  monday.setDate(monday.getDate() - weekday + 1)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + index)
    const iso = date.toISOString().slice(0, 10)
    return { iso, label: ['M', 'T', 'W', 'T', 'F', 'S', 'S'][index], trained: sessions.some((session) => session.date === iso && session.endedAt) }
  })
  const completed = days.filter((day) => day.trained).length
  const target = profile?.daysPerWeek ?? 3
  const readiness = [...(readinessFile?.entries ?? [])].reverse().find((entry) => entry.date === today)

  return (
    <Card className="shadow-none ring-1 ring-[var(--border-subtle)]">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="reps-eyebrow">This week</p>
            <p className="mt-1 text-lg font-bold">{completed} of {target} sessions</p>
          </div>
          <p className="font-mono text-sm font-semibold text-[var(--emerald-700)]">{Math.min(100, Math.round((completed / Math.max(1, target)) * 100))}%</p>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {days.map((day) => (
            <div key={day.iso} className="text-center">
              <p className="mb-1 text-[10px] font-semibold text-muted-foreground">{day.label}</p>
              <span className={cn(
                'mx-auto flex size-8 items-center justify-center rounded-full text-xs font-bold ring-1',
                day.trained ? 'bg-[var(--emerald-500)] text-white ring-[var(--emerald-500)]' : day.iso === today ? 'bg-white text-[var(--ink-900)] ring-2 ring-[var(--ink-900)]' : 'bg-[var(--surface-sunken)] text-muted-foreground ring-[var(--border-subtle)]',
              )}>
                {day.trained ? <Check className="size-3.5" /> : day.iso === today ? '•' : ''}
              </span>
            </div>
          ))}
        </div>
        {readiness && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
            {readiness.energy && <span>Energy <strong className="text-foreground">{readiness.energy}/5</strong></span>}
            {readiness.soreness && <span>Soreness <strong className="text-foreground">{readiness.soreness}/5</strong></span>}
            {readiness.sleepHours && <span>Sleep <strong className="text-foreground">{readiness.sleepHours}h</strong></span>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CoachSignal() {
  const { data } = useFileQuery<WeeklyReviewsFile>(PATHS.weeklyReviews, { reviews: [] })
  const review = data?.reviews[0]
  if (!review) return null
  const signal = review.nextWeekPriorities[0] ?? review.wins[0] ?? review.summary
  return (
    <Card className="border-none bg-[var(--emerald-50)] shadow-none ring-1 ring-[var(--emerald-200)]">
      <CardContent className="flex items-start gap-3 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--emerald-600)] text-white"><TrendingUp className="size-4" /></span>
        <div>
          <p className="reps-eyebrow text-[var(--emerald-700)]">Coach signal</p>
          <p className="mt-1 text-sm font-medium leading-relaxed text-[var(--emerald-700)]">{signal}</p>
        </div>
      </CardContent>
    </Card>
  )
}

function RecentSessions({ sessions }: { sessions: Session[] }) {
  const recent = [...sessions].filter((session) => session.endedAt).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2)
  if (recent.length === 0) return null
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="reps-eyebrow">Recent training</h2>
        <span className="text-[10px] font-semibold text-muted-foreground">Last {recent.length}</span>
      </div>
      <Card className="gap-0 py-0">
        {recent.map((session, index) => (
          <div key={session.id} className={cn('flex items-center gap-3 px-4 py-3', index > 0 && 'border-t border-border')}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--ink-700)]"><Check className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{session.name}</p>
              <p className="text-xs text-muted-foreground">{session.date} · {session.exercises.length > 0 ? `${session.exercises.length} exercises` : session.cardio ? formatDuration(session.cardio.durationSec) : session.modality}</p>
            </div>
          </div>
        ))}
      </Card>
    </section>
  )
}

// ---- Quick log (already did it — outside the app, or before opening it) ----

function QuickLogWidget() {
  const runCommand = useRunCommand()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit() {
    const input = text.trim()
    if (!input || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const session = await runCommand<{ text: string }, Session>('quicklog.parse', { text: input })
      setText('')
      setNotice(`Logged "${session.name}".`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not log that')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="rounded-xl bg-card shadow-sm ring-1 ring-foreground/[0.045]">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted-foreground">Quick log something you already did</summary>
      <div className="space-y-2 border-t border-border px-4 py-3">
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-full bg-[var(--surface-sunken)] px-4 py-2 text-sm outline-none"
            placeholder='"bench 3x8 60kg" or "walked 40 min"'
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <Button size="sm" className="rounded-full" disabled={busy || !text.trim()} onClick={() => void submit()}>
            <Wand2 className="size-4" /> {busy ? '…' : 'Log'}
          </Button>
        </div>
        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      </div>
    </details>
  )
}

// ---- Page ----

export default function TodayPage() {
  const { data: sessions } = useFileQuery<Session[]>(PATHS.sessions(currentMonthKey()), [])
  const { data: programIndex } = useFileQuery<ProgramsIndexFile>(PATHS.programsIndex, { activeId: null, list: [] })
  const { data: venuesFile } = useFileQuery<VenuesFile>(PATHS.venues, { venues: [] })
  const { data: exercises } = useAllExercises()
  const today = effectiveTodayISO()
  const todaySessions = (sessions ?? []).filter((s) => s.date === today)
  const completed = todaySessions.filter((s) => s.endedAt)
  const next = selectNextSession(sessions ?? [], today)

  const activeProgramId = programIndex?.activeId ?? null
  const activeProgramMeta = programIndex?.list.find((p) => p.id === activeProgramId)
  const nextProgramMeta = programIndex?.list.find((program) => program.id === next?.programId) ?? activeProgramMeta
  const nextVenue = venuesFile?.venues.find((venue) => venue.id === next?.venueId)

  return (
    <div className="space-y-4 pb-16">
      <HomeHeader />

      {next ? (
        <NextSessionCard session={next} programName={nextProgramMeta?.name} venue={nextVenue} exercises={exercises} />
      ) : (
        <>
          {activeProgramMeta && <GenerateTodayCard programName={activeProgramMeta.name} />}
          <StartSessionCard />
        </>
      )}

      <WeeklyProgress sessions={sessions ?? []} />
      <CoachSignal />
      {completed.map((s) => <CompletedSessionCard key={s.id} session={s} />)}
      <RecentSessions sessions={sessions ?? []} />
      <QuickLogWidget />
    </div>
  )
}
