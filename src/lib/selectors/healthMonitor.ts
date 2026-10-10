import { kebabToCamel } from '@/lib/google/dataTypes'
import { addDays } from '@/lib/dates'
import { baselineStats, BASELINE_DAYS } from '@/lib/health/baseline'
import type { StoredPoint } from '@/lib/health/types'
import { toNumber } from '@/lib/math'

/**
 * Health Monitor selector — shared by the Health page and the AI's
 * health.get_monitor command, so both read identical numbers.
 *
 * Status rule (placeholder, easy to swap): a value is compared with the mean
 * ± 1 standard deviation of the same metric over the previous 30 days; at
 * least 5 prior days are needed, otherwise the status is 'unknown'.
 */

export type MonitorMetricId = 'rr' | 'rhr' | 'hrv' | 'spo2' | 'temp' | 'sleep'
export type MonitorStatus = 'lower' | 'higher' | 'normal' | 'unknown'
/** normal = in range; favorable = out of range in the healthy direction; attention = out of range the other way; neutral = no direction */
export type MonitorTone = 'normal' | 'favorable' | 'attention' | 'neutral'

interface MetricDef {
  id: MonitorMetricId
  label: string
  type: string
  unit: string
  decimals: number
  /** Whether a higher value is better; undefined when neither direction is */
  higherIsBetter?: boolean
  value(body: Record<string, unknown>): number | null
}

export const MONITOR_METRICS: MetricDef[] = [
  { id: 'rr', label: 'Respiratory rate', type: 'daily-respiratory-rate', unit: 'rpm', decimals: 1, value: (b) => toNumber(b.breathsPerMinute) },
  { id: 'rhr', label: 'Resting heart rate', type: 'daily-resting-heart-rate', unit: 'bpm', decimals: 1, higherIsBetter: false, value: (b) => toNumber(b.beatsPerMinute) },
  { id: 'hrv', label: 'Heart rate variability', type: 'daily-heart-rate-variability', unit: 'ms', decimals: 1, higherIsBetter: true, value: (b) => toNumber(b.averageHeartRateVariabilityMilliseconds) },
  { id: 'spo2', label: 'Blood oxygen', type: 'daily-oxygen-saturation', unit: '%', decimals: 1, higherIsBetter: true, value: (b) => toNumber(b.averagePercentage) },
  { id: 'temp', label: 'Skin temperature', type: 'daily-sleep-temperature-derivations', unit: '°C', decimals: 1, value: (b) => toNumber(b.nightlyTemperatureCelsius) },
]

export { BASELINE_DAYS }
export const SLEEP_TYPE = 'sleep'
export const MONITOR_TYPES = [...MONITOR_METRICS.map((m) => m.type), SLEEP_TYPE, 'exercise']

export interface MonitorMetric {
  id: MonitorMetricId
  label: string
  unit: string
  /** Value for the selected date, null if not synced/measured */
  value: number | null
  status: MonitorStatus
  tone: MonitorTone
  baseline: { mean: number; sd: number; days: number; low: number; high: number } | null
  /** 0–1 position of the value within mean ± 2 sd, for the range bar */
  position: number | null
}

export interface MonitorEvent {
  kind: 'sleep' | 'exercise'
  title: string
  /** RFC 3339 end time (wake time for sleep) */
  at: string | null
  durationMinutes: number | null
}

export interface HealthMonitor {
  date: string
  metrics: MonitorMetric[]
  timeline: MonitorEvent[]
}

export const bodyOf = (type: string, p: StoredPoint) => {
  const b = (p.data as Record<string, unknown> | null)?.[kebabToCamel(type)]
  return b && typeof b === 'object' ? (b as Record<string, unknown>) : null
}

const minutesBetween = (a: string | null, b: string | null) =>
  a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000) : null

export interface SleepPick {
  p: StoredPoint
  body: Record<string, unknown>
}

const minutesAsleepOf = (body: Record<string, unknown>) => toNumber((body.summary as Record<string, unknown> | undefined)?.minutesAsleep) ?? 0

/**
 * The main sleep that ended on `date`. Google can flag a daytime nap as both
 * mainSleep and nap, so naps are excluded first; among the rest the flagged
 * night wins, otherwise the longest.
 */
export function mainSleepFor(points: StoredPoint[], date: string): SleepPick | null {
  const nights = points
    .filter((p) => p.date === date)
    .map((p) => ({ p, body: bodyOf(SLEEP_TYPE, p) }))
    .filter((x): x is SleepPick => x.body !== null)
    .filter((x) => !(x.body.metadata as { nap?: boolean } | undefined)?.nap)
  const flagged = nights.filter((x) => (x.body.metadata as { mainSleep?: boolean } | undefined)?.mainSleep)
  const pool = flagged.length ? flagged : nights
  return pool.sort((a, b) => minutesAsleepOf(b.body) - minutesAsleepOf(a.body))[0] ?? null
}

function sleepMinutes(points: StoredPoint[], date: string): number | null {
  const s = mainSleepFor(points, date)
  return s ? toNumber((s.body.summary as Record<string, unknown> | undefined)?.minutesAsleep) : null
}

function evaluate(value: number | null, history: number[], higherIsBetter: boolean | undefined) {
  const stats = value === null ? null : baselineStats(history)
  if (value === null || stats === null) {
    return { status: 'unknown' as const, tone: 'neutral' as const, baseline: null, position: null }
  }
  const { mean, sd } = stats
  const low = mean - sd
  const high = mean + sd
  const status: MonitorStatus = value < low ? 'lower' : value > high ? 'higher' : 'normal'
  const tone: MonitorTone =
    status === 'normal'
      ? 'normal'
      : higherIsBetter === undefined
        ? 'neutral'
        : (status === 'higher') === higherIsBetter
          ? 'favorable'
          : 'attention'
  const span = 4 * sd
  const position = span > 0 ? Math.min(1, Math.max(0, (value - (mean - 2 * sd)) / span)) : 0.5
  return { status, tone, baseline: { mean, sd, days: history.length, low, high }, position }
}

/** `byType` holds stored points for each of MONITOR_TYPES covering [date-30d, date]. */
export function buildHealthMonitor(date: string, byType: Record<string, StoredPoint[]>): HealthMonitor {
  const windowStart = addDays(date, -BASELINE_DAYS)
  const priorOf = (points: StoredPoint[]) => points.filter((p) => p.date >= windowStart && p.date < date)

  const metrics: MonitorMetric[] = MONITOR_METRICS.map((def) => {
    const points = byType[def.type] ?? []
    const read = (p: StoredPoint) => {
      const b = bodyOf(def.type, p)
      return b ? def.value(b) : null
    }
    const value = points.filter((p) => p.date === date).map(read).find((v) => v !== null) ?? null
    const history = priorOf(points).map(read).filter((v): v is number => v !== null)
    return { id: def.id, label: def.label, unit: def.unit, value, ...evaluate(value, history, def.higherIsBetter) }
  })

  const sleepPoints = byType[SLEEP_TYPE] ?? []
  const sleepHistory: number[] = []
  for (let d = addDays(date, -1); d >= windowStart; d = addDays(d, -1)) {
    const m = sleepMinutes(sleepPoints, d)
    if (m !== null) sleepHistory.push(m)
  }
  const sleepValue = sleepMinutes(sleepPoints, date)
  metrics.push({ id: 'sleep', label: 'Sleep', unit: 'min', value: sleepValue, ...evaluate(sleepValue, sleepHistory, true) })

  const timeline: MonitorEvent[] = []
  const main = mainSleepFor(sleepPoints, date)
  if (main) {
    timeline.push({
      kind: 'sleep',
      title: 'Primary sleep',
      at: main.p.end,
      durationMinutes: toNumber((main.body.summary as Record<string, unknown> | undefined)?.minutesAsleep),
    })
  }
  for (const p of (byType.exercise ?? []).filter((x) => x.date === date)) {
    const b = bodyOf('exercise', p)
    if (!b) continue
    const title = (b.displayName as string | undefined) ?? (b.exerciseType as string | undefined) ?? 'Workout'
    timeline.push({ kind: 'exercise', title: title.replace(/_/g, ' ').toLowerCase(), at: p.end, durationMinutes: minutesBetween(p.start, p.end) })
  }
  timeline.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))

  return { date, metrics, timeline }
}
