import { e1rm } from '@/lib/engine'
import { daysBetween } from '@/lib/dates'
import type { Session } from '@/lib/types'

export interface ExercisePR {
  exerciseId: string
  name: string
  weight: number
  reps: number
  e1rm: number
  date: string
}

/** Best estimated 1RM per exercise across all sessions (completed, weighted sets only). */
export function personalRecords(sessions: Session[]): ExercisePR[] {
  const best = new Map<string, ExercisePR>()
  for (const session of sessions) {
    for (const ex of session.exercises) {
      for (const set of ex.sets) {
        if (!set.done) continue
        const weight = set.weight ?? 0
        const reps = set.reps ?? 0
        if (weight <= 0 || reps <= 0) continue
        const score = e1rm(weight, reps, set.rir ?? 0)
        const current = best.get(ex.exerciseId)
        if (!current || score > current.e1rm) {
          best.set(ex.exerciseId, { exerciseId: ex.exerciseId, name: ex.name, weight, reps, e1rm: score, date: session.date })
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => b.e1rm - a.e1rm)
}

export interface E1rmPoint {
  date: string
  e1rm: number
  isPr: boolean
}

/** Best e1RM achieved on each date an exercise was trained, oldest first. */
export function e1rmTrend(exerciseId: string, sessions: Session[]): E1rmPoint[] {
  const byDate = new Map<string, number>()
  for (const session of sessions) {
    for (const ex of session.exercises) {
      if (ex.exerciseId !== exerciseId) continue
      for (const set of ex.sets) {
        if (!set.done || !set.weight || !set.reps) continue
        const score = e1rm(set.weight, set.reps, set.rir ?? 0)
        byDate.set(session.date, Math.max(byDate.get(session.date) ?? 0, score))
      }
    }
  }
  let best = 0
  return [...byDate.entries()]
    .map(([date, value]) => ({ date, e1rm: value }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((point) => {
      const isPr = point.e1rm > best
      best = Math.max(best, point.e1rm)
      return { ...point, isPr }
    })
}

export interface StalledExercise {
  exerciseId: string
  name: string
  daysSincePR: number
}

/** Exercises trained recently whose all-time PR predates the window — no progress despite showing up. */
export function stalledExercises(sessions: Session[], today: string, weeks = 4): StalledExercise[] {
  const windowDays = weeks * 7
  const prs = personalRecords(sessions)
  const results: StalledExercise[] = []
  for (const pr of prs) {
    const trainedRecently = sessions.some(
      (s) => daysBetween(s.date, today) < windowDays && s.exercises.some((e) => e.exerciseId === pr.exerciseId && e.sets.some((set) => set.done)),
    )
    const daysSincePR = daysBetween(pr.date, today)
    if (trainedRecently && daysSincePR >= windowDays) results.push({ exerciseId: pr.exerciseId, name: pr.name, daysSincePR })
  }
  return results.sort((a, b) => b.daysSincePR - a.daysSincePR)
}
