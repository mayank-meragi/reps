import { useState } from 'react'
import { Check, Flag, MapPin, Minus, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { PATHS } from '@/lib/paths'
import { currentMonthKey, effectiveTodayISO } from '@/lib/dates'
import { useFileQuery } from '@/hooks/useData'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import { setSummary, completedSetCount, sessionVolumeKg, formatDuration, lastPerformanceSummary } from '@/lib/sessionStats'
import { plateMath, STANDARD_BARBELL_KG, STANDARD_PLATE_INVENTORY_KG } from '@/lib/engine'
import { ExerciseDetailsTrigger } from '@/components/ExerciseImage'
import ExercisePicker from '@/components/ExercisePicker'
import RestTimer from '@/components/RestTimer'
import { useAllExercises } from '@/hooks/useExercises'
import type { Exercise, Modality, Profile, ProgramsIndexFile, Session, SessionExercise, SetEntry, VenuesFile } from '@/lib/types'

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

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      await runCommand('program.generate_today', {
        considerations: considerations.trim() || undefined,
        availableMinutes: Number(availableMinutes) || undefined,
        venueId: venueId || undefined,
      })
      setConsiderations('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare today’s session')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={cn('border-none', compact ? 'bg-[var(--surface-sunken)]' : 'bg-[var(--ink-900)] text-white')}>
      <CardContent className="space-y-3 py-4">
        <div>
          <p className="text-sm font-semibold">{compact ? 'Revise today' : 'What fits today?'}</p>
          <p className={cn('text-xs', compact ? 'text-muted-foreground' : 'text-white/70')}>From “{programName}”, adapted to everything you have logged.</p>
        </div>
        <Input
          value={considerations}
          onChange={(event) => setConsiderations(event.target.value)}
          placeholder='“Not feeling good”, “keep it light”, “weather is bad”, “just walk”…'
          className={compact ? '' : 'border-white/20 bg-white/10 text-white placeholder:text-white/50'}
        />
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
        <Button size="sm" className={cn(!compact && 'bg-white text-[var(--ink-900)] hover:bg-white/90')} disabled={busy} onClick={() => void generate()}>
          <Sparkles className="size-4" /> {busy ? 'Adapting…' : compact ? 'Regenerate' : 'Generate today'}
        </Button>
      </CardContent>
    </Card>
  )
}

function PrescriptionCard({ session, programName }: { session: Session; programName: string }) {
  const runCommand = useRunCommand()
  const [busy, setBusy] = useState(false)
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
            <div className="space-y-1 rounded-lg bg-white/10 px-3 py-2">
              {session.exercises.map((exercise) => <p key={exercise.exerciseId} className="text-sm">{exercise.name} <span className="text-white/60">· {setSummary(exercise.sets)}</span></p>)}
            </div>
          )}
          {target && (
            <p className="rounded-lg bg-white/10 px-3 py-2 text-sm">
              {[target.durationMin && `${target.durationMin} min`, target.distanceKm && `${target.distanceKm} km`, target.style, target.effort && `effort ${target.effort}/5`].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className="text-sm text-white/80">{session.prescription?.rationale ?? session.rationale}</p>
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
  const { data: profile } = useFileQuery<Profile | null>(PATHS.profile, null)
  const timed = exercise.mode === 'duration'
  const [reps, setReps] = useState(String(set.reps ?? set.targetReps ?? ''))
  const [weight, setWeight] = useState(String(set.weight ?? set.targetWeight ?? ''))
  const [minutes, setMinutes] = useState(String(((set.durationSec ?? set.targetDurationSec ?? 0) / 60) || ''))

  const weightNum = Number(weight)
  const barKg = profile?.barbellWeight ?? STANDARD_BARBELL_KG
  const plates =
    !timed && weightNum > barKg ? plateMath(weightNum, barKg, profile?.plateInventory ?? STANDARD_PLATE_INVENTORY_KG) : null

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
          <span className="text-xs text-muted-foreground">
            kg{plates && plates.perSide.length > 0 ? ` · ${plates.perSide.join('+')}/side` : ''}
          </span>
        </>
      )}
      <button
        type="button"
        aria-label={set.done ? 'Mark set not done' : 'Mark set done'}
        onClick={() => void toggleDone()}
        className={cn(
          'ml-auto flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
          set.done ? 'bg-[var(--emerald-600)] text-white' : 'bg-white text-muted-foreground ring-1 ring-[var(--border-default)]',
        )}
      >
        <Check className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Remove set"
        className="shrink-0 text-muted-foreground/60 hover:text-destructive"
        onClick={() => void runCommand('session.remove_set', { sessionId, exerciseId: exercise.exerciseId, setIndex })}
      >
        <Minus className="size-3.5" />
      </button>
    </div>
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

function ExerciseSessionCard({ session, sessions, onRest }: { session: Session; sessions: Session[]; onRest: (seconds: number) => void }) {
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
        </CardContent>
      </Card>

      {session.exercises.map((ex) => {
        const ghost = lastPerformanceSummary(ex.exerciseId, sessions, session.id)
        return (
        <Card key={ex.exerciseId}>
          <CardContent className="space-y-2 py-3">
            <div className="flex items-center gap-2.5">
              <ExerciseDetailsTrigger exercise={byId.get(ex.exerciseId)} className="size-11" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{ex.name}</p>
                <p className="text-xs text-muted-foreground">
                  {setSummary(ex.sets)}
                  {ex.mode === 'reps' ? ` · rest ${ex.restSeconds ?? 90}s` : ''}
                </p>
                {ghost && <p className="text-[11px] text-muted-foreground/70">Last time: {ghost}</p>}
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
        )
      })}

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
    <Card>
      <CardContent className="space-y-2 py-3">
        <p className="text-xs font-semibold text-muted-foreground">Quick log (already trained?)</p>
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
      </CardContent>
    </Card>
  )
}

// ---- Page ----

export default function TodayPage() {
  const { data: sessions } = useFileQuery<Session[]>(PATHS.sessions(currentMonthKey()), [])
  const { data: programIndex } = useFileQuery<ProgramsIndexFile>(PATHS.programsIndex, { activeId: null, list: [] })
  const [timer, setTimer] = useState<{ startedAt: number; seconds: number } | null>(null)
  const today = effectiveTodayISO()
  const todaySessions = (sessions ?? []).filter((s) => s.date === today)
  const active = todaySessions.find((s) => !s.endedAt) ?? null
  const completed = todaySessions.filter((s) => s.endedAt)

  const activeProgramId = programIndex?.activeId ?? null
  const activeProgramMeta = programIndex?.list.find((p) => p.id === activeProgramId)
  const prescription = active && !active.startedAt && active.prescription ? active : null

  return (
    <div className="space-y-3 pb-16">
      <h1 className="text-xl font-semibold tracking-tight">Today</h1>

      {completed.map((s) => (
        <CompletedSessionCard key={s.id} session={s} />
      ))}

      {prescription && activeProgramMeta ? (
        <PrescriptionCard session={prescription} programName={activeProgramMeta.name} />
      ) : active ? (
        isCardioModality(active.modality) ? (
          <CardioSessionCard session={active} />
        ) : (
          <ExerciseSessionCard session={active} sessions={sessions ?? []} onRest={(seconds) => setTimer({ startedAt: Date.now(), seconds })} />
        )
      ) : (
        <>
          {activeProgramMeta && <GenerateTodayCard programName={activeProgramMeta.name} />}
          <StartSessionCard />
        </>
      )}

      <QuickLogWidget />

      <RestTimer timer={timer} onDone={() => setTimer(null)} />
    </div>
  )
}
