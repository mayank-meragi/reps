import { addDays } from '@/lib/dates'
import { formatMinutes } from '@/lib/format'
import { clamp01, toNumber } from '@/lib/math'
import { mainSleepFor, type SleepPick } from '@/lib/selectors/healthMonitor'
import type { StoredPoint } from './types'

/**
 * Sleep score (0–100) for the night that ended on a date. Shared by the Health
 * page and health.get_scores so both show identical numbers and the same
 * breakdown.
 *
 *   Duration     40  min(1, minutes asleep / sleep need)
 *   Efficiency   20  asleep / in bed: full at ≥ 92 %, zero at ≤ 75 %
 *   Restorative  25  deep and REM share of sleep, 12.5 each; full at or above the lower
 *                    bound of the healthy range (deep 13–23 %, REM 20–25 %), falling to
 *                    zero at half of it. Having more is never penalised.
 *   Consistency  15  bedtime vs the mean of up to the previous 7 nights: full within 15 min,
 *                    zero at 90 min off. Needs 4 earlier nights.
 *
 * A part whose data is missing (no stage breakdown, too few nights) is dropped
 * and the rest rescaled to 100, so the score never silently reads low.
 */

export const DEFAULT_SLEEP_NEED_MIN = 480
const CONSISTENCY_LOOKBACK = 7
const CONSISTENCY_MIN_NIGHTS = 4

export interface ScoreComponent {
  id: 'duration' | 'efficiency' | 'restorative' | 'consistency'
  label: string
  max: number
  /** Points earned; null when the data for this part is missing */
  points: number | null
  /** Human-readable inputs, e.g. "6h 57m of 8h needed" */
  detail: string
}

export interface SleepScore {
  date: string
  /** null when there is no main sleep for the date */
  score: number | null
  sleepNeedMinutes: number
  components: ScoreComponent[]
  /** Facts the AI and UI can explain the score with */
  facts: {
    minutesAsleep: number
    minutesInBed: number
    deepMinutes: number | null
    remMinutes: number | null
    bedtimeLocal: string | null
  } | null
  note?: string
}


function summaryOf(pick: SleepPick) {
  const summary = (pick.body.summary ?? {}) as Record<string, unknown>
  const stages = new Map<string, number>()
  for (const s of (summary.stagesSummary as { type?: string; minutes?: unknown }[] | undefined) ?? []) {
    if (s.type) stages.set(s.type, toNumber(s.minutes) ?? 0)
  }
  return { asleep: toNumber(summary.minutesAsleep) ?? 0, inBed: toNumber(summary.minutesInSleepPeriod), stages }
}

/** Bedtime as minutes after 12:00 local, so evenings either side of midnight stay comparable. */
function bedtimeOffsetMin(pick: SleepPick): number | null {
  const interval = pick.body.interval as { startTime?: string; startUtcOffset?: string } | undefined
  if (!interval?.startTime) return null
  const offsetSec = Number.parseFloat(interval.startUtcOffset ?? '0') || 0
  const local = new Date(new Date(interval.startTime).getTime() + offsetSec * 1000)
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  return (minutes - 720 + 1440) % 1440
}

const clock = (offsetMin: number) => {
  const m = Math.round(offsetMin + 720) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Below `lo` falls linearly to zero at lo/2; at or above `lo` is full. */
const rangeScore = (share: number, lo: number) => clamp01((share - lo / 2) / (lo / 2))

/** `sleepPoints` should cover the date and the ~7 nights before it. */
export function buildSleepScore(date: string, sleepPoints: StoredPoint[], sleepNeedMinutes = DEFAULT_SLEEP_NEED_MIN): SleepScore {
  const pick = mainSleepFor(sleepPoints, date)
  if (!pick) {
    return { date, score: null, sleepNeedMinutes, components: [], facts: null, note: 'No main sleep recorded for this date. Check health.sync_status and run health.sync.' }
  }
  const { asleep, inBed, stages } = summaryOf(pick)
  const components: ScoreComponent[] = []

  components.push({
    id: 'duration',
    label: 'Duration',
    max: 40,
    points: 40 * clamp01(asleep / sleepNeedMinutes),
    detail: `${formatMinutes(asleep)} of ${formatMinutes(sleepNeedMinutes)} needed`,
  })

  if (inBed && inBed > 0) {
    const eff = asleep / inBed
    components.push({
      id: 'efficiency',
      label: 'Efficiency',
      max: 20,
      points: 20 * clamp01((eff - 0.75) / (0.92 - 0.75)),
      detail: `${Math.round(eff * 100)}% of time in bed asleep`,
    })
  } else {
    components.push({ id: 'efficiency', label: 'Efficiency', max: 20, points: null, detail: 'Time in bed unknown' })
  }

  const hasStages = stages.has('DEEP') || stages.has('REM')
  const deep = hasStages ? (stages.get('DEEP') ?? 0) : null
  const rem = hasStages ? (stages.get('REM') ?? 0) : null
  if (hasStages && asleep > 0) {
    const deepShare = deep! / asleep
    const remShare = rem! / asleep
    components.push({
      id: 'restorative',
      label: 'Restorative sleep',
      max: 25,
      points: 12.5 * rangeScore(deepShare, 0.13) + 12.5 * rangeScore(remShare, 0.2),
      detail: `Deep ${Math.round(deepShare * 100)}%, REM ${Math.round(remShare * 100)}% of sleep`,
    })
  } else {
    components.push({ id: 'restorative', label: 'Restorative sleep', max: 25, points: null, detail: 'No stage breakdown for this night' })
  }

  const bed = bedtimeOffsetMin(pick)
  const prior: number[] = []
  for (let i = 1; i <= CONSISTENCY_LOOKBACK; i++) {
    const earlier = mainSleepFor(sleepPoints, addDays(date, -i))
    const o = earlier ? bedtimeOffsetMin(earlier) : null
    if (o !== null) prior.push(o)
  }
  if (bed !== null && prior.length >= CONSISTENCY_MIN_NIGHTS) {
    const mean = prior.reduce((a, b) => a + b, 0) / prior.length
    const diff = Math.abs(bed - mean)
    components.push({
      id: 'consistency',
      label: 'Consistency',
      max: 15,
      points: 15 * clamp01(1 - (diff - 15) / 75),
      detail: `Bedtime ${clock(bed)}, ${Math.round(diff)} min from your usual ${clock(mean)}`,
    })
  } else {
    components.push({ id: 'consistency', label: 'Consistency', max: 15, points: null, detail: `Needs ${CONSISTENCY_MIN_NIGHTS} earlier nights (${prior.length} so far)` })
  }

  const available = components.filter((c) => c.points !== null)
  const max = available.reduce((a, c) => a + c.max, 0)
  const earned = available.reduce((a, c) => a + (c.points ?? 0), 0)
  const dropped = components.filter((c) => c.points === null).map((c) => c.label)

  return {
    date,
    score: max > 0 ? Math.round((earned / max) * 100) : null,
    sleepNeedMinutes,
    components,
    facts: { minutesAsleep: asleep, minutesInBed: inBed ?? asleep, deepMinutes: deep, remMinutes: rem, bedtimeLocal: bed !== null ? clock(bed) : null },
    note: dropped.length ? `Not counted (data missing): ${dropped.join(', ')}. The rest is rescaled to 100.` : undefined,
  }
}
