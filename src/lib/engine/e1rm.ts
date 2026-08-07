/**
 * Estimated one-rep max (Epley, RIR-adjusted): reps-in-reserve are capacity
 * the set didn't use, so they count toward the estimate same as performed
 * reps would. rir defaults to 0 (set taken to failure).
 */
export function e1rm(weight: number, reps: number, rir = 0): number {
  if (weight <= 0 || reps <= 0) return 0
  return Math.round(weight * (1 + (reps + rir) / 30) * 10) / 10
}

/** Weight that should produce `reps` at the given e1RM (inverse of e1rm). */
export function weightForReps(oneRepMax: number, reps: number): number {
  if (reps <= 0) return 0
  return Math.round((oneRepMax / (1 + reps / 30)) * 2) / 2
}
