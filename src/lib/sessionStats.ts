import type { SessionExercise, SetEntry, Session } from './types'

export function formatDuration(seconds: number): string {
  return seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)}s`
}

/** One set as text: "8@60", "12", or "10 min". Prefers actuals, falls back to targets. */
export function formatSet(set: SetEntry): string {
  const duration = set.durationSec ?? set.targetDurationSec
  if (duration && duration > 0 && !(set.reps ?? set.targetReps)) return formatDuration(duration)
  const reps = set.reps ?? set.targetReps
  const weight = set.weight ?? set.targetWeight
  if (!reps) return ''
  return weight ? `${reps}@${weight}` : String(reps)
}

/** "3×10@40kg" style summary of an exercise's set scheme, from targets. */
export function setSummary(sets: SetEntry[]): string {
  if (sets.length === 0) return ''
  const first = sets[0]
  if (first.targetDurationSec && !first.targetReps) {
    const uniform = sets.every((s) => s.targetDurationSec === first.targetDurationSec)
    if (sets.length === 1) return formatDuration(first.targetDurationSec)
    if (uniform) return `${sets.length}× ${formatDuration(first.targetDurationSec)}`
    return sets.map((s) => formatDuration(s.targetDurationSec ?? 0)).join(', ')
  }
  const uniform = sets.every((s) => s.targetReps === first.targetReps && s.targetWeight === first.targetWeight)
  const weight = first.targetWeight ? `@${first.targetWeight}kg` : ''
  if (uniform) return `${sets.length}×${first.targetReps ?? '?'}${weight}`
  return sets.map((s) => `${s.targetReps ?? '?'}${s.targetWeight ? `@${s.targetWeight}` : ''}`).join(', ')
}

export function sessionVolumeKg(session: Session): number {
  return session.exercises.reduce(
    (sum, ex) =>
      sum +
      ex.sets.reduce((s, set) => (set.done ? s + (set.reps ?? set.targetReps ?? 0) * (set.weight ?? set.targetWeight ?? 0) : s), 0),
    0,
  )
}

export function completedSetCount(exercises: SessionExercise[]): { done: number; total: number } {
  return exercises.reduce(
    (acc, e) => ({ done: acc.done + e.sets.filter((s) => s.done).length, total: acc.total + e.sets.length }),
    { done: 0, total: 0 },
  )
}
