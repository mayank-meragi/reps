import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowLeftRight, ChevronRight, Clock3, Dumbbell, MapPin, Play, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ExerciseDetailsTrigger } from '@/components/ExerciseImage'
import SessionMuscleMap from '@/components/session/SessionMuscleMap'
import { PATHS } from '@/lib/paths'
import { currentMonthKey } from '@/lib/dates'
import { useFileQuery } from '@/hooks/useData'
import { useAllExercises } from '@/hooks/useExercises'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import type { ProgramsIndexFile, Session, VenuesFile } from '@/lib/types'

export default function SessionPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const runCommand = useRunCommand()
  const { data: sessions, isLoading } = useFileQuery<Session[]>(PATHS.sessions(currentMonthKey()), [])
  const { data: venuesFile } = useFileQuery<VenuesFile>(PATHS.venues, { venues: [] })
  const { data: programIndex } = useFileQuery<ProgramsIndexFile>(PATHS.programsIndex, { activeId: null, list: [] })
  const { data: exercises } = useAllExercises()
  const [busy, setBusy] = useState(false)
  const [swappingId, setSwappingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const session = sessions?.find((item) => item.id === sessionId)

  if (isLoading && !session) return <p className="py-12 text-center text-sm text-muted-foreground">Loading session…</p>
  if (!session) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center">
        <h1 className="text-xl font-bold">Session not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">It may have been discarded or moved.</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate('/')}>Back to Home</Button>
      </div>
    )
  }

  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]))
  const venue = venuesFile?.venues.find((item) => item.id === session.venueId)
  const program = programIndex?.list.find((item) => item.id === session.programId)
  const totalSets = session.exercises.reduce((sum, exercise) => sum + exercise.sets.filter((set) => set.type !== 'warmup').length, 0)
  const duration = session.prescription?.availableMinutes ?? Math.max(15, Math.round(totalSets * 2.5 + session.exercises.length * 3))
  const started = Boolean(session.startedAt)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      if (!session?.startedAt) await runCommand('session.begin', { sessionId })
      navigate(`/session/${sessionId}/train`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start this workout')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-32">
      <button type="button" onClick={() => navigate('/')} className="inline-flex min-h-11 items-center gap-2 rounded-full pr-3 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Home
      </button>

      <section className="overflow-hidden rounded-[1.5rem] bg-[var(--ink-950)] px-5 py-5 text-white shadow-[0_20px_55px_rgba(21,24,50,0.2)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--emerald-300)]">{started ? 'Workout in progress' : 'Next session'}</p>
            <h1 className="mt-2 text-2xl font-bold text-white">{session.name}</h1>
            <p className="mt-1 text-xs capitalize text-white/55">{session.focus.length > 0 ? session.focus.join(' · ') : session.modality}</p>
          </div>
          {program && <span className="max-w-36 truncate rounded-full bg-white/[0.08] px-3 py-1.5 text-[10px] font-semibold text-white/55">{program.name}</span>}
        </div>
        <div className="mt-5 grid grid-cols-3 divide-x divide-white/10 rounded-xl bg-white/[0.07] py-3 ring-1 ring-white/10">
          <div className="px-2 text-center"><Clock3 className="mx-auto size-4 text-[var(--emerald-300)]" /><p className="reps-figure mt-1 text-sm font-bold">{duration}m</p><p className="text-[9px] text-white/40">Estimate</p></div>
          <div className="px-2 text-center"><Dumbbell className="mx-auto size-4 text-[var(--emerald-300)]" /><p className="reps-figure mt-1 text-sm font-bold">{session.exercises.length}</p><p className="text-[9px] text-white/40">Exercises</p></div>
          <div className="px-2 text-center"><Sparkles className="mx-auto size-4 text-[var(--emerald-300)]" /><p className="reps-figure mt-1 text-sm font-bold">{totalSets}</p><p className="text-[9px] text-white/40">Working sets</p></div>
        </div>
        {venue && <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-white/55"><MapPin className="size-3.5" /> {venue.name}</p>}
      </section>

      {session.exercises.length > 0 && <SessionMuscleMap session={session} exercises={exercises} />}

      {(session.prescription?.rationale || session.rationale) && (
        <Card className="shadow-none ring-1 ring-[var(--border-subtle)]">
          <CardContent className="py-4">
            <p className="reps-eyebrow">Why this session</p>
            <p className="mt-2 text-sm leading-relaxed text-foreground">{session.prescription?.rationale ?? session.rationale}</p>
            {(session.prescription?.contextSummary.length ?? 0) > 0 && (
              <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                {session.prescription?.contextSummary.map((item) => <li key={item}>• {item}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="reps-eyebrow">Exercises</h2>
          <span className="text-[10px] font-semibold text-muted-foreground">{session.exercises.length} movements</span>
        </div>
        <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-foreground/[0.045]">
          {session.exercises.map((sessionExercise, index) => {
            const exercise = byId.get(sessionExercise.exerciseId)
            const firstSet = sessionExercise.sets.find((set) => set.type !== 'warmup') ?? sessionExercise.sets[0]
            const target = sessionExercise.mode === 'duration'
              ? `${Math.round((firstSet?.targetDurationSec ?? 0) / 60)} min`
              : `${sessionExercise.sets.length} × ${firstSet?.targetReps ?? '?'}${firstSet?.targetWeight ? ` @ ${firstSet.targetWeight}kg` : ''}`
            return (
              <div key={`${sessionExercise.exerciseId}-${index}`} className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-0">
                <span className="reps-figure flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[10px] font-bold text-muted-foreground">{index + 1}</span>
                <ExerciseDetailsTrigger exercise={exercise} className="size-14 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{sessionExercise.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{target} · rest {sessionExercise.restSeconds ?? 90}s</p>
                  {exercise && <p className="mt-0.5 truncate text-[10px] capitalize text-muted-foreground/75">{exercise.primaryMuscles.join(', ')} · {exercise.equipment ?? 'no equipment'}</p>}
                </div>
                {!started && (
                  <button
                    type="button"
                    aria-label={`Ask AI to substitute ${sessionExercise.name}`}
                    disabled={Boolean(swappingId)}
                    onClick={() => {
                      setError(null)
                      setSwappingId(sessionExercise.exerciseId)
                      void runCommand('session.substitute_exercise', { sessionId, exerciseId: sessionExercise.exerciseId })
                        .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not substitute this exercise'))
                        .finally(() => setSwappingId(null))
                    }}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {swappingId === sessionExercise.exerciseId ? <Sparkles className="size-4 animate-pulse" /> : <ArrowLeftRight className="size-4" />}
                  </button>
                )}
                {started && <ChevronRight className="size-4 text-muted-foreground/40" />}
              </div>
            )
          })}
        </div>
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-10 px-4 md:bottom-5">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white/90 p-2 shadow-xl ring-1 ring-[var(--border-default)] backdrop-blur">
          <Button className="h-12 w-full rounded-xl bg-[var(--ink-950)] text-base" disabled={busy || session.exercises.length === 0} onClick={() => void start()}>
            <Play className="size-4 fill-current" /> {busy ? 'Opening…' : started ? 'Resume workout' : 'Start workout'}
          </Button>
        </div>
      </div>
    </div>
  )
}
