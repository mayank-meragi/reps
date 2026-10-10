import { addDays } from '@/lib/dates'
import { formatFixed } from '@/lib/format'
import { clamp } from '@/lib/math'
import { bodyOf, MONITOR_METRICS } from '@/lib/selectors/healthMonitor'
import { baselineStats, BASELINE_DAYS, MIN_BASELINE_DAYS } from './baseline'
import { buildSleepScore, DEFAULT_SLEEP_NEED_MIN } from './sleepScore'
import type { StoredPoint } from './types'

/**
 * Recovery score (0–100) for a date: how far today's overnight signals sit from
 * your own recent normal. Shared by the Health page and health.get_scores.
 *
 * 1. Each input is compared with the same input over the previous 30 days
 *    (needs 5 of them) as a z-score: (today − mean) ÷ sd. HRV is converted to a
 *    logarithm first. Each sd has a floor so a very steady stretch can't blow a
 *    small wobble up into a huge z. z is clamped to ±3 and signed so that
 *    positive always means "better recovered".
 * 2. The core inputs are combined with relative weights HRV 40, resting heart rate 25,
 *    sleep score 20, respiratory rate 10, rescaled to sum to 1 over the inputs that
 *    are available (at least 2 are needed, and HRV or resting heart rate must be one).
 * 3. A smooth S-curve maps the combined z to 0–100: z 0 → 50, +1 → 77, −1 → 23.
 * 4. Illness flags subtract up to 5 points each: skin temperature 2+ sd away
 *    (either direction) and SpO2 2+ sd below normal.
 *
 * Zones: red under 34, yellow 34–66, green 67 and up.
 */

const Z_CLAMP = 3
const CURVE_STEEPNESS = 1.2
const FLAG_MAX_PENALTY = 5

export type RecoveryZone = 'red' | 'yellow' | 'green'
export type RecoveryStatus = 'ok' | 'calibrating' | 'no_data'

export interface RecoveryComponent {
  id: 'hrv' | 'rhr' | 'sleep' | 'rr'
  label: string
  unit: string
  /** Relative weight before rescaling to the available inputs */
  weight: number
  /** Share of the combined score this input carries after rescaling; null when not used */
  effectiveWeight: number | null
  value: number | null
  baselineMean: number | null
  baselineDays: number
  /** Signed so that + means better recovered; null when not used */
  z: number | null
  status: 'used' | 'calibrating' | 'missing'
  detail: string
}

export interface RecoveryFlag {
  id: 'temp' | 'spo2'
  label: string
  z: number | null
  penalty: number
  detail: string
}

export interface RecoveryScore {
  date: string
  score: number | null
  zone: RecoveryZone | null
  status: RecoveryStatus
  /** Combined z before the S-curve */
  combinedZ: number | null
  components: RecoveryComponent[]
  flags: RecoveryFlag[]
  /** Days of baseline the weakest core input has, out of MIN_BASELINE_DAYS needed */
  calibration: { have: number; need: number }
  note?: string
}

export type RecoveryInputs = Record<'hrv' | 'rhr' | 'rr' | 'spo2' | 'temp' | 'sleep', StoredPoint[]>

export const RECOVERY_TYPES = {
  hrv: 'daily-heart-rate-variability',
  rhr: 'daily-resting-heart-rate',
  rr: 'daily-respiratory-rate',
  spo2: 'daily-oxygen-saturation',
  temp: 'daily-sleep-temperature-derivations',
  sleep: 'sleep',
} as const

const SD_FLOOR = { hrv: 0.05 /* in ln units ≈ 5 % */, rhr: 1.5, rr: 0.5, sleep: 5, temp: 0.2, spo2: 0.5 }


/** date → value for a monitored metric, first non-null reading per date. */
function metricSeries(id: 'hrv' | 'rhr' | 'rr' | 'spo2' | 'temp', points: StoredPoint[]): Map<string, number> {
  const def = MONITOR_METRICS.find((m) => m.id === id)!
  const out = new Map<string, number>()
  for (const p of points) {
    if (out.has(p.date)) continue
    const body = bodyOf(def.type, p)
    const v = body ? def.value(body) : null
    if (v !== null) out.set(p.date, v)
  }
  return out
}

interface Compared {
  value: number | null
  days: number
  mean: number | null
  /** raw standardized distance, + = above normal, in the (possibly log) space */
  z: number | null
}

function compare(series: Map<string, number>, date: string, floor: number, log = false): Compared {
  const t = (v: number) => (log ? Math.log(v) : v)
  const today = series.get(date)
  const prior: number[] = []
  for (let i = 1; i <= BASELINE_DAYS; i++) {
    const v = series.get(addDays(date, -i))
    if (v !== undefined) prior.push(t(v))
  }
  if (today === undefined) return { value: null, days: prior.length, mean: null, z: null }
  const stats = baselineStats(prior)
  if (!stats) return { value: today, days: prior.length, mean: null, z: null }
  const { mean, sd } = stats
  return {
    value: today,
    days: prior.length,
    mean: log ? Math.exp(mean) : mean,
    z: clamp((t(today) - mean) / Math.max(sd, floor), -Z_CLAMP, Z_CLAMP),
  }
}

/** "86%" for percent units, "61.0 bpm" otherwise; whole numbers for the sleep score */
const withUnit = (n: number, unit: string) => (unit === '%' ? `${Math.round(n)}%` : `${formatFixed(n)} ${unit}`)
const sign = (n: number) => (n >= 0 ? '+' : '−')

function detailFor(c: Compared, unit: string, higherIsBetter: boolean): string {
  if (c.value === null) return 'No reading for this date'
  if (c.mean === null) return `${withUnit(c.value, unit)} — baseline needs ${MIN_BASELINE_DAYS} days (${c.days} so far)`
  const pct = ((c.value - c.mean) / c.mean) * 100
  const better = (c.value > c.mean) === higherIsBetter
  return `${withUnit(c.value, unit)} vs usual ${unit === '%' ? Math.round(c.mean) : formatFixed(c.mean)} (${sign(pct)}${Math.abs(Math.round(pct))}%, ${Math.abs(c.value - c.mean) < 1e-9 ? 'on baseline' : better ? 'better' : 'worse'})`
}

export function recoveryZone(score: number): RecoveryZone {
  return score >= 67 ? 'green' : score >= 34 ? 'yellow' : 'red'
}

/** `inputs` should cover the date and the 30+ days before it (sleep: ~40 days, for the sleep-score history). */
export function buildRecoveryScore(date: string, inputs: RecoveryInputs, sleepNeedMinutes = DEFAULT_SLEEP_NEED_MIN): RecoveryScore {
  const hrv = compare(metricSeries('hrv', inputs.hrv), date, SD_FLOOR.hrv, true)
  const rhr = compare(metricSeries('rhr', inputs.rhr), date, SD_FLOOR.rhr)
  const rr = compare(metricSeries('rr', inputs.rr), date, SD_FLOOR.rr)

  // The sleep score is itself a daily series; score each earlier night the same way as today's
  const sleepSeries = new Map<string, number>()
  for (let i = 0; i <= BASELINE_DAYS; i++) {
    const d = addDays(date, -i)
    const s = buildSleepScore(d, inputs.sleep, sleepNeedMinutes).score
    if (s !== null) sleepSeries.set(d, s)
  }
  const sleep = compare(sleepSeries, date, SD_FLOOR.sleep)

  const raw = [
    { id: 'hrv' as const, label: 'Heart rate variability', unit: 'ms', weight: 40, c: hrv, hib: true },
    { id: 'rhr' as const, label: 'Resting heart rate', unit: 'bpm', weight: 25, c: rhr, hib: false },
    { id: 'sleep' as const, label: 'Sleep score', unit: '%', weight: 20, c: sleep, hib: true },
    { id: 'rr' as const, label: 'Respiratory rate', unit: 'rpm', weight: 10, c: rr, hib: false },
  ]
  const usable = raw.filter((r) => r.c.z !== null)
  const totalWeight = usable.reduce((a, r) => a + r.weight, 0)

  const components: RecoveryComponent[] = raw.map((r) => {
    const used = r.c.z !== null
    return {
      id: r.id,
      label: r.label,
      unit: r.unit,
      weight: r.weight,
      effectiveWeight: used ? r.weight / totalWeight : null,
      value: r.c.value,
      baselineMean: r.c.mean,
      baselineDays: r.c.days,
      z: used ? (r.hib ? r.c.z! : -r.c.z!) : null,
      status: used ? 'used' : r.c.value === null ? 'missing' : 'calibrating',
      detail: detailFor(r.c, r.unit, r.hib),
    }
  })

  // Illness flags: informational for the AI and UI, and a small deduction
  const temp = compare(metricSeries('temp', inputs.temp), date, SD_FLOOR.temp)
  const spo2 = compare(metricSeries('spo2', inputs.spo2), date, SD_FLOOR.spo2)
  const penalty = (excess: number) => FLAG_MAX_PENALTY * clamp(excess, 0, 1)
  const flags: RecoveryFlag[] = [
    {
      id: 'temp',
      label: 'Skin temperature',
      z: temp.z,
      penalty: temp.z === null ? 0 : penalty(Math.abs(temp.z) - 2),
      detail: temp.z === null ? 'Not enough data' : `${formatFixed(temp.value!)} °C vs usual ${formatFixed(temp.mean!)}${Math.abs(temp.z) >= 2 ? ' — unusual' : ''}`,
    },
    {
      id: 'spo2',
      label: 'Blood oxygen',
      z: spo2.z,
      penalty: spo2.z === null ? 0 : penalty(-spo2.z - 2),
      detail: spo2.z === null ? 'Not enough data' : `${formatFixed(spo2.value!)}% vs usual ${formatFixed(spo2.mean!)}%${spo2.z <= -2 ? ' — unusually low' : ''}`,
    },
  ]

  const calibration = { have: Math.min(hrv.days, rhr.days), need: MIN_BASELINE_DAYS }
  const hasAnchor = usable.some((r) => r.id === 'hrv' || r.id === 'rhr')
  if (usable.length < 2 || !hasAnchor) {
    const noReading = hrv.value === null && rhr.value === null
    return {
      date,
      score: null,
      zone: null,
      status: noReading ? 'no_data' : 'calibrating',
      combinedZ: null,
      components,
      flags,
      calibration,
      note: noReading
        ? 'No overnight HRV or resting heart rate for this date. Check health.sync_status and run health.sync.'
        : `Calibrating: recovery compares you with your own recent normal and needs ${MIN_BASELINE_DAYS} days of baseline (${calibration.have} so far).`,
    }
  }

  const combinedZ = usable.reduce((a, r) => a + (r.weight / totalWeight) * components.find((c) => c.id === r.id)!.z!, 0)
  const curve = 100 / (1 + Math.exp(-CURVE_STEEPNESS * combinedZ))
  const deduction = flags.reduce((a, f) => a + f.penalty, 0)
  const score = Math.round(clamp(curve - deduction, 0, 100))
  const missing = components.filter((c) => c.status !== 'used').map((c) => c.label)
  return {
    date,
    score,
    zone: recoveryZone(score),
    status: 'ok',
    combinedZ,
    components,
    flags,
    calibration,
    note: missing.length ? `Not counted (missing or still calibrating): ${missing.join(', ')}. The weights of the rest were rescaled.` : undefined,
  }
}
