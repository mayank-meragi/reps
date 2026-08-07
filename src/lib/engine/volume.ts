import type { Exercise, Experience, Session } from '@/lib/types'
import { daysBetween } from '@/lib/dates'

export interface MuscleVolume {
  muscle: string
  sets: number
}

/** Hard (working, completed) sets per primary muscle across the given sessions. */
export function volumeByMuscle(sessions: Session[], byId: Map<string, Exercise>): MuscleVolume[] {
  const acc = new Map<string, number>()
  for (const session of sessions) {
    for (const ex of session.exercises) {
      const muscles = byId.get(ex.exerciseId)?.primaryMuscles ?? []
      for (const set of ex.sets) {
        if (!set.done || set.type === 'warmup') continue
        for (const m of muscles) acc.set(m, (acc.get(m) ?? 0) + 1)
      }
    }
  }
  return [...acc.entries()].map(([muscle, sets]) => ({ muscle, sets })).sort((a, b) => b.sets - a.sets)
}

/** Sessions within the last N days (inclusive of today). */
export function sessionsInWindow(sessions: Session[], today: string, days: number): Session[] {
  return sessions.filter((s) => {
    const d = daysBetween(s.date, today)
    return d >= 0 && d < days
  })
}

export interface VolumeLandmarks {
  mev: number
  mav: number
  mrv: number
}

/**
 * Weekly hard-set landmarks per muscle, by experience level. A simple
 * heuristic applied uniformly across muscles (not muscle-specific) — good
 * enough to flag "way under" or "way over" without pretending to be a
 * sports-science model.
 */
const LANDMARKS: Record<Experience, VolumeLandmarks> = {
  beginner: { mev: 6, mav: 12, mrv: 18 },
  intermediate: { mev: 8, mav: 16, mrv: 22 },
  advanced: { mev: 10, mav: 20, mrv: 26 },
}

export function landmarks(experience: Experience): VolumeLandmarks {
  return LANDMARKS[experience]
}
