import { meanSd } from '@/lib/math'

/** Days of history a personal baseline looks back over. */
export const BASELINE_DAYS = 30
/** Fewest prior days needed before a baseline is trusted. */
export const MIN_BASELINE_DAYS = 5

/** Mean and sd of the prior values, or null while there are too few days to trust. */
export function baselineStats(prior: number[]): { mean: number; sd: number } | null {
  return prior.length >= MIN_BASELINE_DAYS ? meanSd(prior) : null
}
