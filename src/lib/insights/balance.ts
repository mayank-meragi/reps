import { sessionsInWindow, volumeByMuscle } from '@/lib/engine'
import type { Exercise, Session } from '@/lib/types'

const PUSH = new Set(['chest', 'triceps', 'shoulders'])
const PULL = new Set(['lats', 'middle back', 'lower back', 'traps', 'biceps'])
const QUADS = new Set(['quadriceps'])
const HAMSTRINGS = new Set(['hamstrings', 'glutes'])

export interface BalanceRatio {
  key: 'push-pull' | 'quad-hamstring'
  label: string
  leftLabel: string
  rightLabel: string
  leftSets: number
  rightSets: number
  ratio: number | null
}

function sumFor(volumes: Map<string, number>, names: Set<string>): number {
  let total = 0
  for (const name of names) total += volumes.get(name) ?? 0
  return total
}

/** Primary-muscle hard-set balance over the trailing window. */
export function muscleBalance(sessions: Session[], today: string, byId: Map<string, Exercise>, days = 28): BalanceRatio[] {
  const volume = new Map(volumeByMuscle(sessionsInWindow(sessions, today, days), byId).map((v) => [v.muscle.toLowerCase(), v.sets]))
  const make = (key: BalanceRatio['key'], label: string, leftLabel: string, rightLabel: string, leftSets: number, rightSets: number): BalanceRatio => ({
    key,
    label,
    leftLabel,
    rightLabel,
    leftSets,
    rightSets,
    ratio: rightSets > 0 ? Math.round((leftSets / rightSets) * 100) / 100 : null,
  })
  const push = sumFor(volume, PUSH)
  const pull = sumFor(volume, PULL)
  const quads = sumFor(volume, QUADS)
  const hamstrings = sumFor(volume, HAMSTRINGS)
  return [
    make('push-pull', 'Push / pull', 'Push', 'Pull', push, pull),
    make('quad-hamstring', 'Quad / posterior', 'Quads', 'Hamstrings + glutes', quads, hamstrings),
  ]
}
