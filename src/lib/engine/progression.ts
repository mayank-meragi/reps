import type { LoadRule, ProgressionScheme, SetEntry } from '@/lib/types'

export interface PerformedSet {
  reps: number
  weight?: number
  rir?: number
}

export interface NextTarget {
  targetReps: number
  targetWeight?: number
}

const DEFAULT_INCREMENT_KG = 2.5

/**
 * Double progression: climb reps to the top of the range at the target RIR,
 * then add load and drop back to the bottom. Missing the bottom of the range
 * holds the weight (a bad day, not a program change). No history yet starts
 * conservative at the bottom of the range.
 */
export function doubleProgression(opts: {
  lastSets: PerformedSet[]
  repRange: [number, number]
  targetRir?: number
  incrementKg?: number
}): NextTarget {
  const { lastSets, repRange, incrementKg = DEFAULT_INCREMENT_KG } = opts
  const [lo, hi] = repRange
  const done = lastSets.filter((s) => s.reps > 0)
  if (done.length === 0) return { targetReps: lo, targetWeight: undefined }

  const lastWeight = done.find((s) => s.weight !== undefined)?.weight
  const targetRir = opts.targetRir ?? 2
  const allAtTop = done.every((s) => s.reps >= hi && (s.rir === undefined || s.rir >= targetRir))
  const anyBelowBottom = done.some((s) => s.reps < lo)

  if (allAtTop) {
    return { targetReps: lo, targetWeight: lastWeight !== undefined ? lastWeight + incrementKg : undefined }
  }
  if (anyBelowBottom) {
    return { targetReps: lo, targetWeight: lastWeight }
  }
  // Partial progress within the range — same weight, nudge reps up by one.
  const avgReps = Math.round(done.reduce((s, x) => s + x.reps, 0) / done.length)
  return { targetReps: Math.min(hi, avgReps + 1), targetWeight: lastWeight }
}

/** Straight linear progression: add load every time, reps fixed at the bottom of the range. */
export function linearProgression(opts: { lastSets: PerformedSet[]; repRange: [number, number]; incrementKg?: number }): NextTarget {
  const { lastSets, repRange, incrementKg = DEFAULT_INCREMENT_KG } = opts
  const lastWeight = lastSets.find((s) => s.weight !== undefined)?.weight
  return { targetReps: repRange[0], targetWeight: lastWeight !== undefined ? lastWeight + incrementKg : undefined }
}

/** Percentage of a known e1RM — used when the program prescribes %-based work. */
export function percentOfE1rm(oneRepMax: number, pct: number, repRange: [number, number]): NextTarget {
  return { targetReps: repRange[0], targetWeight: Math.round(((oneRepMax * pct) / 100) * 2) / 2 }
}

/**
 * Dispatch by ProgressionScheme (program-level default) unless the specific
 * planned exercise overrides with its own loadRule.
 */
export function nextTarget(opts: {
  scheme: ProgressionScheme
  loadRule: LoadRule
  loadValue?: number
  lastSets: PerformedSet[]
  repRange: [number, number]
  targetRir?: number
  knownE1rm?: number
}): NextTarget {
  if (opts.loadRule === 'bodyweight') return { targetReps: opts.repRange[0], targetWeight: undefined }
  if (opts.loadRule === 'fixed') return { targetReps: opts.repRange[0], targetWeight: opts.loadValue }
  if (opts.loadRule === 'e1rm-pct' && opts.knownE1rm) {
    return percentOfE1rm(opts.knownE1rm, opts.loadValue ?? 75, opts.repRange)
  }
  // An AI-suggested starting load seeds a movement with no logged history.
  // Once performance exists, the deterministic progression rules take over.
  if (opts.loadRule === 'last-session' && opts.lastSets.length === 0 && opts.loadValue !== undefined) {
    return { targetReps: opts.repRange[0], targetWeight: opts.loadValue }
  }
  if (opts.scheme === 'linear') return linearProgression(opts)
  return doubleProgression(opts)
}

/** Performed sets for one exercise from a session's logged SetEntry rows. */
export function performedSets(sets: SetEntry[]): PerformedSet[] {
  return sets.filter((s) => s.done && s.reps !== undefined).map((s) => ({ reps: s.reps!, weight: s.weight, rir: s.rir }))
}
