import type { Session } from '@/lib/types'

export interface SessionDensityPoint {
  sessionId: string
  date: string
  name: string
  durationMin: number
  workMin: number
  restMin: number
  completedSets: number
  setsPerHour: number
}

/**
 * Strength-session density from session/set timestamps. Working time is
 * estimated from timed-set duration or four seconds per completed rep; the
 * remainder is rest/transition time. Sets/hour is the least assumption-heavy
 * comparison and remains useful even when the app sat idle mid-session.
 */
export function sessionDensity(sessions: Session[], limit = 12): SessionDensityPoint[] {
  return sessions
    .filter((s) => s.startedAt && s.endedAt && s.exercises.some((e) => e.sets.some((set) => set.done)))
    .map((session) => {
      const durationSec = Math.max(0, (Date.parse(session.endedAt!) - Date.parse(session.startedAt!)) / 1000)
      const completed = session.exercises.flatMap((exercise) =>
        exercise.sets
          .filter((set) => set.done)
          .map((set) => ({
            workSec: set.durationSec ?? Math.min(120, (set.reps ?? set.targetReps ?? 0) * 4),
            restActualSec: set.restActualSec,
          })),
      )
      const workSec = Math.min(durationSec, completed.reduce((sum, set) => sum + set.workSec, 0))
      const recordedRestSec = completed.reduce((sum, set) => sum + (set.restActualSec ?? 0), 0)
      const restSec = Math.min(durationSec - workSec, recordedRestSec > 0 ? recordedRestSec : Math.max(0, durationSec - workSec))
      const durationMin = Math.round(durationSec / 60)
      return {
        sessionId: session.id,
        date: session.date,
        name: session.name,
        durationMin,
        workMin: Math.max(0, Math.round(workSec / 60)),
        restMin: Math.round(restSec / 60),
        completedSets: completed.length,
        setsPerHour: durationSec > 0 ? Math.round((completed.length / (durationSec / 3600)) * 10) / 10 : 0,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-limit)
}
