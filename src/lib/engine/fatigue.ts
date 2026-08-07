import type { Exercise, Modality, Session } from '@/lib/types'
import { daysBetween } from '@/lib/dates'

export interface MuscleFatigue {
  muscle: string
  daysSinceTrained: number | null
  recentSets: number
  status: 'fresh' | 'recovering' | 'fatigued'
}

/**
 * Which muscles a cardio modality loads, for the "long ride counts against
 * quads, a walk barely counts" reasoning the plan calls for (docs/plan.md
 * §4a, §6). Not every modality appears — swim/other get no leg credit.
 */
const CARDIO_MUSCLES: Partial<Record<Modality, string[]>> = {
  run: ['quadriceps', 'hamstrings', 'calves', 'glutes'],
  walk: ['calves'],
  hike: ['quadriceps', 'hamstrings', 'calves', 'glutes'],
  cycle: ['quadriceps', 'hamstrings', 'calves'],
  swim: ['lats', 'shoulders', 'chest', 'triceps'],
}

/** ~1 "hard set" of fatigue-equivalent per 20 minutes of continuous cardio. */
const SECONDS_PER_CARDIO_SET_EQUIVALENT = 1200

/**
 * Per-muscle recovery state: last trained date (across strength AND cardio
 * load) and hard-set volume in the last 7 days. `status` is a simple
 * 48–72h-rule read: freshly hit muscles are 'fatigued', 2-3 days out are
 * 'recovering', 4+ days (or never) are 'fresh'.
 */
export function fatigueByMuscle(sessions: Session[], today: string, byId: Map<string, Exercise>): MuscleFatigue[] {
  const lastTrained = new Map<string, string>()
  const recentSets = new Map<string, number>()

  function touch(muscle: string, date: string, daysAgo: number, load: number) {
    if (!lastTrained.has(muscle) || date > lastTrained.get(muscle)!) lastTrained.set(muscle, date)
    if (daysAgo < 7 && load > 0) recentSets.set(muscle, (recentSets.get(muscle) ?? 0) + load)
  }

  for (const session of sessions) {
    const daysAgo = daysBetween(session.date, today)
    if (daysAgo < 0) continue

    for (const ex of session.exercises) {
      const hardSets = ex.sets.filter((s) => s.done && s.type !== 'warmup').length
      if (hardSets === 0) continue
      for (const m of byId.get(ex.exerciseId)?.primaryMuscles ?? []) touch(m, session.date, daysAgo, hardSets)
    }

    if (session.cardio) {
      const equivalent = Math.round(session.cardio.durationSec / SECONDS_PER_CARDIO_SET_EQUIVALENT)
      for (const m of CARDIO_MUSCLES[session.modality] ?? []) touch(m, session.date, daysAgo, equivalent)
    }
  }

  const muscles = new Set([...lastTrained.keys(), ...recentSets.keys()])
  return [...muscles]
    .map((muscle) => {
      const daysSinceTrained = lastTrained.has(muscle) ? daysBetween(lastTrained.get(muscle)!, today) : null
      const status: MuscleFatigue['status'] =
        daysSinceTrained === null ? 'fresh' : daysSinceTrained <= 1 ? 'fatigued' : daysSinceTrained <= 3 ? 'recovering' : 'fresh'
      return { muscle, daysSinceTrained, recentSets: recentSets.get(muscle) ?? 0, status }
    })
    .sort((a, b) => (a.daysSinceTrained ?? 99) - (b.daysSinceTrained ?? 99))
}
