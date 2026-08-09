import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowLeftRight, Check, ChevronDown, Dumbbell, Flag, MessageCircle, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExerciseDetailsTrigger, ExerciseMedia } from '@/components/ExerciseImage'
import { cn } from '@/lib/utils'
import { PATHS } from '@/lib/paths'
import { useFileQuery } from '@/hooks/useData'
import { useAllExercises } from '@/hooks/useExercises'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import { completedSetCount, lastPerformanceSummary } from '@/lib/sessionStats'
import { plateMath, STANDARD_BARBELL_KG, STANDARD_PLATE_INVENTORY_KG } from '@/lib/engine'
import type { Exercise, Profile, Session, SessionExercise, SetEntry } from '@/lib/types'

interface SetRowProps {
  sessionId: string
  exercise: SessionExercise
  catalogExercise?: Exercise
  set: SetEntry
  setIndex: number
  previousSet?: SetEntry
  onLogged: (seconds: number) => void
}

function FeedSetRow({ sessionId, exercise, catalogExercise, set, setIndex, previousSet, onLogged }: SetRowProps) {
  const runCommand = useRunCommand()
  const { data: profile } = useFileQuery<Profile | null>(PATHS.profile, null)
  const timed = exercise.mode === 'duration'
  const [reps, setReps] = useState(String(set.reps ?? set.targetReps ?? ''))
  const [weight, setWeight] = useState(String(set.weight ?? set.targetWeight ?? ''))
  const [minutes, setMinutes] = useState(String(((set.durationSec ?? set.targetDurationSec ?? 0) / 60) || ''))
  const equipment = catalogExercise?.equipment?.toLowerCase() ?? ''
  const perImplement = equipment === 'dumbbell' || equipment === 'kettlebells' || equipment === 'kettlebell'
  const bodyweight = equipment === 'body only' || equipment === 'bodyweight'
  const barKg = profile?.barbellWeight ?? STANDARD_BARBELL_KG
  const plates = equipment === 'barbell' && Number(weight) > barKg
    ? plateMath(Number(weight), barKg, profile?.plateInventory ?? STANDARD_PLATE_INVENTORY_KG)
    : null
  const previous = timed
    ? previousSet ? `${Math.round((previousSet.durationSec ?? previousSet.targetDurationSec ?? 0) / 60)}m` : '—'
    : previousSet ? `${previousSet.weight ?? previousSet.targetWeight ?? '—'}×${previousSet.reps ?? previousSet.targetReps ?? '—'}` : '—'

  async function toggle() {
    if (set.done) {
      await runCommand('session.update_set', { sessionId, exerciseId: exercise.exerciseId, setIndex, patch: { done: false } })
      return
    }
    const patch = timed
      ? { durationSec: Math.round((Number(minutes) || 0) * 60) || undefined, done: true }
      : { reps: Number(reps) || undefined, weight: Number(weight) || undefined, done: true }
    await runCommand('session.update_set', { sessionId, exerciseId: exercise.exerciseId, setIndex, patch })
    onLogged(exercise.restSeconds ?? 90)
  }

  return (
    <div className={cn('grid min-h-14 grid-cols-[2rem_minmax(0,1fr)_3rem] items-center gap-2 rounded-xl px-2 py-2 ring-1', set.done ? 'bg-[var(--emerald-50)] ring-[var(--emerald-200)]' : 'bg-[var(--surface-sunken)] ring-[var(--border-subtle)]')}>
      <div className="text-center">
        <p className="reps-figure text-xs font-bold">{setIndex + 1}</p>
        <p className="reps-figure text-[8px] text-muted-foreground">{previous}</p>
      </div>
      {timed ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input aria-label={`Set ${setIndex + 1} minutes`} type="number" inputMode="decimal" className="h-10 w-20 rounded-lg bg-white px-2 text-center font-mono text-base text-foreground outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" value={minutes} onChange={(event) => setMinutes(event.target.value)} /> min
        </label>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">
          <input aria-label={`Set ${setIndex + 1} reps`} type="number" inputMode="numeric" className="h-10 w-14 rounded-lg bg-white px-1 text-center font-mono text-base outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" value={reps} onChange={(event) => setReps(event.target.value)} />
          <span className="text-[10px] text-muted-foreground">reps</span>
          <input aria-label={`Set ${setIndex + 1} weight`} type="number" inputMode="decimal" step="0.5" placeholder="bw" className="h-10 w-16 rounded-lg bg-white px-1 text-center font-mono text-base outline-none focus:ring-2 focus:ring-[var(--focus-ring)]" value={weight} onChange={(event) => setWeight(event.target.value)} />
          <span className="min-w-0 truncate text-[10px] text-muted-foreground">{bodyweight ? 'added' : perImplement ? 'kg each' : 'kg'}{plates?.perSide.length ? ` · ${plates.perSide.join('+')}/side` : ''}</span>
        </div>
      )}
      <button type="button" aria-label={set.done ? `Mark set ${setIndex + 1} not done` : `Mark set ${setIndex + 1} done`} onClick={() => void toggle()} className={cn('flex size-11 items-center justify-center rounded-full transition-transform active:scale-90', set.done ? 'bg-[var(--emerald-600)] text-white' : 'bg-white text-muted-foreground ring-1 ring-[var(--border-default)]')}>
        <Check className="size-4" />
      </button>
    </div>
  )
}

interface Props {
  session: Session
  sessions: Session[]
  onRest: (seconds: number) => void
  onFinish: () => void
  onExit: () => void
}

export default function WorkoutFeed({ session, sessions, onRest, onFinish, onExit }: Props) {
  const runCommand = useRunCommand()
  const { data: exercises } = useAllExercises()
  const byId = useMemo(() => new Map(exercises.map((exercise) => [exercise.id, exercise])), [exercises])
  const viewportRef = useRef<HTMLDivElement>(null)
  const advanced = useRef(new Set<string>())
  const firstIncomplete = session.exercises.findIndex((exercise) => exercise.sets.some((set) => !set.done))
  const initialIndex = useRef(firstIncomplete >= 0 ? firstIncomplete : session.exercises.length)
  const [activeIndex, setActiveIndex] = useState(initialIndex.current)
  const [swappingId, setSwappingId] = useState<string | null>(null)
  const [swapError, setSwapError] = useState<string | null>(null)
  const { done, total } = completedSetCount(session.exercises)

  function goTo(index: number, behavior: ScrollBehavior = 'smooth') {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTo({ top: index * viewport.clientHeight, behavior })
    setActiveIndex(index)
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || initialIndex.current === 0) return
    viewport.scrollTop = initialIndex.current * viewport.clientHeight
  }, [])

  useEffect(() => {
    const exercise = session.exercises[activeIndex]
    if (!exercise || exercise.sets.length === 0 || exercise.sets.some((set) => !set.done)) return
    const key = `${activeIndex}:${exercise.exerciseId}`
    if (advanced.current.has(key)) return
    advanced.current.add(key)
    const timer = window.setTimeout(() => goTo(Math.min(session.exercises.length, activeIndex + 1)), 420)
    return () => window.clearTimeout(timer)
  }, [session.exercises, activeIndex])

  function previousFor(exerciseId: string): SessionExercise | undefined {
    for (const prior of [...sessions].filter((item) => item.id !== session.id && item.endedAt).sort((a, b) => `${b.date}${b.updatedAt}`.localeCompare(`${a.date}${a.updatedAt}`))) {
      const match = prior.exercises.find((exercise) => exercise.exerciseId === exerciseId)
      if (match) return match
    }
    return undefined
  }

  return (
    <div className="relative h-dvh overflow-hidden bg-[var(--ink-950)] text-white">
      <div className="fixed inset-x-0 top-0 z-30 px-4 pt-[calc(env(safe-area-inset-top)+0.65rem)]">
        <div className="mx-auto flex max-w-xl items-center gap-3 rounded-full bg-[var(--ink-950)]/80 px-3 py-2 shadow-lg ring-1 ring-white/10 backdrop-blur">
          <button type="button" aria-label="Back to session" onClick={onExit} className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"><ArrowLeft className="size-4" /></button>
          <p className="min-w-0 flex-1 truncate text-xs font-semibold text-white/75">{session.name}</p>
          <p className="reps-figure text-[10px] text-white/50">{Math.min(activeIndex + 1, session.exercises.length)}/{session.exercises.length}</p>
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-[var(--emerald-400)] transition-[width]" style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} /></div>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain scroll-smooth"
        onScroll={(event) => {
          const element = event.currentTarget
          setActiveIndex(Math.round(element.scrollTop / Math.max(1, element.clientHeight)))
        }}
      >
        {session.exercises.map((sessionExercise, index) => {
          const exercise = byId.get(sessionExercise.exerciseId)
          const previous = previousFor(sessionExercise.exerciseId)
          const ghost = lastPerformanceSummary(sessionExercise.exerciseId, sessions, session.id)
          const complete = sessionExercise.sets.length > 0 && sessionExercise.sets.every((set) => set.done)
          return (
            <section key={`${sessionExercise.exerciseId}-${index}`} className="h-dvh snap-start snap-always overflow-y-auto bg-[var(--surface-page)] pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-16 text-foreground">
              <div className="mx-auto flex min-h-full max-w-xl flex-col px-3 pb-4">
                <div className="relative mt-2 overflow-hidden rounded-[1.4rem] bg-white shadow-sm ring-1 ring-[var(--border-subtle)]">
                  {exercise ? (
                    <div className="max-h-[31dvh] overflow-hidden [&_img]:max-h-[31dvh] [&_img]:object-contain [&_video]:max-h-[31dvh]">
                      <ExerciseMedia exercise={exercise} />
                    </div>
                  ) : (
                    <div className="flex h-[24dvh] items-center justify-center bg-[var(--surface-sunken)]"><DumbbellFallback /></div>
                  )}
                  <span className="absolute left-3 top-3 rounded-full bg-[var(--ink-950)]/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur">Exercise {index + 1}</span>
                </div>

                <div className="px-1 pb-2 pt-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h1 className="text-xl font-bold leading-tight">{sessionExercise.name}</h1>
                      {exercise && <p className="mt-1 text-xs capitalize text-muted-foreground">{exercise.primaryMuscles.join(', ')} · {exercise.equipment ?? 'no equipment'}</p>}
                    </div>
                    <ExerciseDetailsTrigger exercise={exercise} className="size-11" />
                  </div>
                  {ghost && <p className="mt-2 text-xs text-muted-foreground">Last time: <span className="font-medium text-foreground">{ghost}</span></p>}
                  {sessionExercise.notes && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{sessionExercise.notes}</p>}
                </div>

                <div className="space-y-2 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-[var(--border-subtle)]">
                  <div className="flex items-center justify-between px-1 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground"><span>Set · previous</span><span>Today</span><span>Done</span></div>
                  {sessionExercise.sets.map((set, setIndex) => (
                    <FeedSetRow key={setIndex} sessionId={session.id} exercise={sessionExercise} catalogExercise={exercise} set={set} setIndex={setIndex} previousSet={previous?.sets[setIndex]} onLogged={onRest} />
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 px-1">
                  <button
                    type="button"
                    disabled={Boolean(swappingId)}
                    onClick={() => {
                      setSwapError(null)
                      setSwappingId(sessionExercise.exerciseId)
                      void runCommand('session.substitute_exercise', { sessionId: session.id, exerciseId: sessionExercise.exerciseId })
                        .catch((cause) => setSwapError(cause instanceof Error ? cause.message : 'Could not substitute this exercise'))
                        .finally(() => setSwappingId(null))
                    }}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-semibold text-muted-foreground hover:bg-white"
                  >
                    {swappingId === sessionExercise.exerciseId ? <Sparkles className="size-4 animate-pulse" /> : <ArrowLeftRight className="size-4" />} Swap
                  </button>
                  <button type="button" onClick={() => window.dispatchEvent(new Event('reps:open-assistant'))} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-semibold text-muted-foreground hover:bg-white"><MessageCircle className="size-4" /> Ask coach</button>
                </div>
                {swapError && <p className="px-2 text-xs text-destructive">{swapError}</p>}

                <div className="mt-auto flex flex-col items-center pt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                  {complete ? <span className="text-[var(--emerald-700)]">Complete · moving next</span> : <><span>Swipe for another exercise</span><ChevronDown className="mt-1 size-4 animate-bounce motion-reduce:animate-none" /></>}
                </div>
              </div>
            </section>
          )
        })}

        <section className="flex h-dvh snap-start snap-always items-center bg-[var(--ink-950)] px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+4rem)] text-white">
          <div className="mx-auto w-full max-w-md text-center">
            <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-[var(--emerald-500)] text-white shadow-[var(--shadow-brand)]"><Flag className="size-6" /></span>
            <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--emerald-300)]">Session complete</p>
            <h2 className="mt-2 text-3xl font-bold text-white">Nice work.</h2>
            <p className="mt-2 text-sm text-white/55">You logged {done} of {total} sets across {session.exercises.length} exercises.</p>
            <Button className="mt-8 h-12 w-full rounded-xl bg-white text-base text-[var(--ink-950)] hover:bg-white/90" disabled={done === 0} onClick={onFinish}><Flag className="size-4" /> Finish workout</Button>
            {done < total && <button type="button" onClick={() => goTo(Math.max(0, firstIncomplete))} className="mt-3 min-h-11 px-4 text-xs font-semibold text-white/55">Return to unfinished exercise</button>}
          </div>
        </section>
      </div>
    </div>
  )
}

function DumbbellFallback() {
  return <span className="flex size-16 items-center justify-center rounded-full bg-white text-muted-foreground"><Dumbbell className="size-6" /></span>
}
