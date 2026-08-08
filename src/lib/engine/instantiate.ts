import type { Exercise, PlannedExercise, ProgramDay, ProgressionScheme, Session, SessionExercise, SetEntry, Venue } from '@/lib/types'
import { nextTarget, performedSets } from './progression'
import { e1rm } from './e1rm'

function lastPerformance(exerciseId: string, history: Session[]): SetEntry[] {
  const sorted = [...history]
    .filter((s) => s.exercises.some((e) => e.exerciseId === exerciseId))
    .sort((a, b) => b.date.localeCompare(a.date))
  return sorted[0]?.exercises.find((e) => e.exerciseId === exerciseId)?.sets ?? []
}

function bestKnownE1rm(exerciseId: string, history: Session[]): number | undefined {
  let best: number | undefined
  for (const session of history) {
    for (const ex of session.exercises) {
      if (ex.exerciseId !== exerciseId) continue
      for (const set of ex.sets) {
        if (!set.done || !set.reps || !set.weight) continue
        const score = e1rm(set.weight, set.reps, set.rir ?? 0)
        if (best === undefined || score > best) best = score
      }
    }
  }
  return best
}

/** One planned exercise → a concrete SessionExercise with real target weights. */
export function instantiateExercise(
  planned: PlannedExercise,
  exercise: Exercise,
  history: Session[],
  scheme: ProgressionScheme,
): SessionExercise {
  const lastSets = performedSets(lastPerformance(planned.exerciseId, history))
  const target = nextTarget({
    scheme,
    loadRule: planned.loadRule,
    loadValue: planned.loadValue,
    lastSets,
    repRange: planned.repRange,
    targetRir: planned.targetRir,
    knownE1rm: bestKnownE1rm(planned.exerciseId, history),
  })
  const sets: SetEntry[] = Array.from({ length: planned.sets }, () => ({
    type: 'working',
    targetReps: target.targetReps,
    targetWeight: target.targetWeight,
    targetRir: planned.targetRir,
    done: false,
  }))
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    mode: 'reps',
    restSeconds: planned.restSeconds,
    sets,
    notes: planned.notes,
  }
}

/**
 * Turn a program day template into today's concrete session content.
 * Strength exercises get computed target weights from progression + history.
 * An exercise the current venue can't support (wrong equipment) is dropped
 * rather than guessed at — program.swap_exercise is how that gets fixed.
 */
export function instantiateDay(opts: {
  day: ProgramDay
  history: Session[]
  scheme: ProgressionScheme
  exercisesById: Map<string, Exercise>
  venue?: Venue
}): { exercises: SessionExercise[]; skipped: string[] } {
  const skipped: string[] = []
  const exercises: SessionExercise[] = []
  for (const planned of opts.day.exercises) {
    const exercise = opts.exercisesById.get(planned.exerciseId)
    if (!exercise) {
      skipped.push(planned.exerciseId)
      continue
    }
    const venueOk =
      !opts.venue ||
      opts.venue.equipment.length === 0 ||
      !exercise.equipment ||
      exercise.equipment === 'body only' ||
      opts.venue.equipment.includes(exercise.equipment)
    if (!venueOk) {
      skipped.push(exercise.name)
      continue
    }
    exercises.push(instantiateExercise(planned, exercise, opts.history, opts.scheme))
  }
  return { exercises, skipped }
}
