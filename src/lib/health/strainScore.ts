import { bodyOf } from '@/lib/selectors/healthMonitor'
import type { RecoveryZone } from './recoveryScore'

import type { StoredPoint } from './types'

/**
 * Strain (0–100 %) for a civil day: how much cardiovascular work the day held.
 * Shared by the Health page and health.get_scores.
 *
 *   load   = Σ minutes at each bpm × max(0, bpm − 110)
 *   strain = 100 × (1 − e^(−load / 1234))
 *
 * Every minute above 110 bpm counts, and harder minutes count proportionally more
 * (a minute at 150 bpm is worth 40, one at 120 is worth 10). Below 110, which
 * covers sleep, rest and strolling, counts as nothing. 110 bpm is about 40 % of
 * heart-rate reserve for a resting rate of 60 and a max of 185, the ACSM moderate
 * floor, Fitbit's moderate zone and the end of Google Cardio Load's down-weighted band.
 * Kept fixed (a daily Fitbit zone floor of 113–116 bpm fit Bevel worse).
 *
 * The constants were fitted to the Bevel app's strain for 7 days of this user's
 * own data (3–9 Oct 2026): average miss 3 points, but only about 8 when each day
 * is predicted without having been used to fit. Treat them as a calibrated
 * starting point and re-fit when more days are available.
 *
 * Target: the band worth aiming for today, set by recovery. Red: under 35 %.
 * Yellow: 35–60 %. Green: 60–85 %. While recovery is still building its baseline
 * (5–13 days) the zone comes from its early estimate and the target is marked provisional.
 */

/** The stored data type the score reads: daily rows of minutes spent at each bpm */
export const STRAIN_TYPE = 'heart-rate'
export const STRAIN_THRESHOLD_BPM = 110
export const STRAIN_K = 1234

export interface StrainScore {
  date: string
  /** null when no heart-rate data is stored for the date */
  score: number | null
  status: 'ok' | 'no_data'
  load: number | null
  /** Minutes the day spent above 110 / 130 / 150 bpm, for explaining the score */
  minutesAbove: { 110: number; 130: number; 150: number } | null
  /** Minutes of heart-rate data stored for the day; low for a partial day */
  minutesRecorded: number | null
  params: { thresholdBpm: number; k: number }
  /** Recommended strain range for the day, from that day's recovery zone; null when recovery has neither a score nor an early estimate. `provisional` when the zone comes from the early estimate. */
  target: { low: number; high: number; basedOn: RecoveryZone; provisional: boolean } | null
  note?: string
}

const TARGETS: Record<RecoveryZone, { low: number; high: number }> = {
  red: { low: 0, high: 35 },
  yellow: { low: 35, high: 60 },
  green: { low: 60, high: 85 },
}

export function strainFromLoad(load: number): number {
  return Math.round(100 * (1 - Math.exp(-load / STRAIN_K)))
}

/** `hrPoints` are the stored daily rows of `heart-rate` (data.heartRate.minutesByBpm). */
export function buildStrainScore(date: string, hrPoints: StoredPoint[], planning: { zone: RecoveryZone; provisional: boolean } | null): StrainScore {
  const target = planning ? { ...TARGETS[planning.zone], basedOn: planning.zone, provisional: planning.provisional } : null
  const params = { thresholdBpm: STRAIN_THRESHOLD_BPM, k: STRAIN_K }
  const row = hrPoints.find((p) => p.date === date)
  const body = row ? bodyOf(STRAIN_TYPE, row) : null
  const byBpm = body?.minutesByBpm as Record<string, number> | undefined
  if (!byBpm) {
    return {
      date,
      score: null,
      status: 'no_data',
      load: null,
      minutesAbove: null,
      minutesRecorded: null,
      params,
      target,
      note: 'No heart-rate data for this date. Check health.sync_status and run health.sync (type heart-rate).',
    }
  }
  let load = 0
  const above = { 110: 0, 130: 0, 150: 0 }
  for (const [bpmText, minutes] of Object.entries(byBpm)) {
    const bpm = Number(bpmText)
    load += minutes * Math.max(0, bpm - STRAIN_THRESHOLD_BPM)
    if (bpm >= 110) above[110] += minutes
    if (bpm >= 130) above[130] += minutes
    if (bpm >= 150) above[150] += minutes
  }
  const round = (n: number) => Math.round(n)
  return {
    date,
    score: strainFromLoad(load),
    status: 'ok',
    load: round(load),
    minutesAbove: { 110: round(above[110]), 130: round(above[130]), 150: round(above[150]) },
    minutesRecorded: round((body?.totalMinutes as number | undefined) ?? 0),
    params,
    target,
  }
}
