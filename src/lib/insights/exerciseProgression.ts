import { daysBetween } from '@/lib/dates'
import { e1rm, nextTarget, performedSets } from '@/lib/engine'
import type { Exercise, ProgressionScheme, Session } from '@/lib/types'

export interface ExercisePerformanceSet {
  reps: number
  weight?: number
  rir?: number
  rpe?: number
}

export interface ExercisePerformance {
  sessionId: string
  date: string
  sets: ExercisePerformanceSet[]
  bestE1rm?: number
}

export interface ExerciseProgressionInsight {
  exerciseId: string
  name: string
  primaryMuscles: string[]
  equipment?: string | null
  lastPerformedDate: string
  daysSincePerformed: number
  recentPerformances: ExercisePerformance[]
  trend: 'improving' | 'stable' | 'declining' | 'insufficient'
  nextTarget?: { targetReps: number; targetWeight?: number }
}

function performanceFor(session: Session, exerciseId: string): ExercisePerformance | null {
  const exercise = session.exercises.find((item) => item.exerciseId === exerciseId)
  if (!exercise) return null
  const sets = exercise.sets
    .filter((set) => set.done && set.type !== 'warmup' && set.reps !== undefined)
    .map((set) => ({ reps: set.reps!, weight: set.weight, rir: set.rir, rpe: set.rpe }))
  if (sets.length === 0) return null
  const weighted = sets.filter((set) => (set.weight ?? 0) > 0)
  const bestE1rm = weighted.length > 0
    ? Math.max(...weighted.map((set) => e1rm(set.weight!, set.reps, set.rir ?? 0)))
    : undefined
  return { sessionId: session.id, date: session.date, sets, bestE1rm }
}

function trendFor(performances: ExercisePerformance[]): ExerciseProgressionInsight['trend'] {
  const points = performances.flatMap((item) => item.bestE1rm === undefined ? [] : [item.bestE1rm])
  if (points.length < 2) return 'insufficient'
  const newest = points[0]
  const oldest = points[points.length - 1]
  const change = oldest > 0 ? (newest - oldest) / oldest : 0
  if (change > 0.02) return 'improving'
  if (change < -0.02) return 'declining'
  return 'stable'
}

export function exerciseProgressionInsights(opts: {
  sessions: Session[]
  exercises: Exercise[]
  today: string
  exerciseId?: string
  limit?: number
  scheme?: ProgressionScheme
  repRange?: [number, number]
  targetRir?: number
}): ExerciseProgressionInsight[] {
  const completed = opts.sessions.filter((session) => session.endedAt || session.exercises.some((exercise) => exercise.sets.some((set) => set.done)))
  const ids = opts.exerciseId
    ? [opts.exerciseId]
    : [...new Set(completed.flatMap((session) => session.exercises.filter((exercise) => exercise.sets.some((set) => set.done)).map((exercise) => exercise.exerciseId)))]
  const byId = new Map(opts.exercises.map((exercise) => [exercise.id, exercise]))

  return ids.flatMap((exerciseId) => {
    const exercise = byId.get(exerciseId)
    if (!exercise) return []
    const performances = completed
      .map((session) => performanceFor(session, exerciseId))
      .filter((item): item is ExercisePerformance => item !== null)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 4)
    if (performances.length === 0) return []
    const latest = performances[0]
    const next = opts.repRange
      ? nextTarget({
          scheme: opts.scheme ?? 'double-progression',
          loadRule: exercise.equipment === 'body only' || !exercise.equipment ? 'bodyweight' : 'last-session',
          lastSets: performedSets(
            completed
              .sort((a, b) => b.date.localeCompare(a.date))
              .find((session) => session.id === latest.sessionId)
              ?.exercises.find((item) => item.exerciseId === exerciseId)?.sets ?? [],
          ),
          repRange: opts.repRange,
          targetRir: opts.targetRir,
        })
      : undefined
    return [{
      exerciseId,
      name: exercise.name,
      primaryMuscles: exercise.primaryMuscles,
      equipment: exercise.equipment,
      lastPerformedDate: latest.date,
      daysSincePerformed: daysBetween(latest.date, opts.today),
      recentPerformances: performances,
      trend: trendFor(performances),
      nextTarget: next,
    }]
  })
    .sort((a, b) => a.daysSincePerformed - b.daysSincePerformed || a.name.localeCompare(b.name))
    .slice(0, opts.limit ?? 16)
}
