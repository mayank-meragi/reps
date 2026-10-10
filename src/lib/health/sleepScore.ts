import { addDays } from '@/lib/dates'
import { formatMinutes } from '@/lib/format'
import { clamp01, toNumber } from '@/lib/math'
import { mainSleepFor, type SleepPick } from '@/lib/selectors/healthMonitor'
import type { StoredPoint } from './types'

/**
 * Sleep score (0–100) for the night that ended on a date. Shared by the Health
 * page and health.get_scores so both show identical numbers and the same
 * breakdown. A Whoop-style "hours vs the night's need" score, with regularity
 * and a light continuity and stage check (see docs/health-algorithms.md).
 *
 *   Duration     55  min(1, minutes asleep / need tonight)
 *                    need tonight = the user's sleep need + 25 % of last night's shortfall
 *   Regularity   15  mean of bedtime and wake-time distance from the average of up to the
 *                    previous 7 nights: full within 15 min, zero at 90 min off. Needs 4 earlier nights.
 *   Restlessness 10  brief wake-ups (under 5 min) per hour in bed: full at 0.5 or fewer,
 *                    zero at 3 or more. Only for nights with a stage breakdown.
 *   Efficiency    5  asleep / in bed: full at ≥ 92 %, zero at ≤ 75 %
 *   Restorative  15  deep and REM share of sleep, 7.5 each; full at or above the lower bound
 *                    of the healthy range (deep 13 %, REM 20 %), falling to zero at half of it.
 *                    Having more is never penalised. Only for nights with a stage breakdown.
 *
 * A part whose data is missing is dropped and the rest rescaled to 100, so the
 * score never silently reads low. Weights are chosen from published inputs, not
 * fitted to a reference. Sources: AASM/SRS consensus (7 h or more), NSF sleep
 * quality indicators, Windred 2024 (regularity), Whoop and Oura public docs.
 * Naps are not counted.
 */

export const DEFAULT_SLEEP_NEED_MIN = 480
/** Share of last night's shortfall added to tonight's need */
export const DEBT_CARRYOVER = 0.25
const REGULARITY_LOOKBACK = 7
const REGULARITY_MIN_NIGHTS = 4

export interface ScoreComponent {
  id: 'duration' | 'regularity' | 'restlessness' | 'efficiency' | 'restorative'
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
  /** The user's setting (profile.sleepNeedMinutes) */
  sleepNeedMinutes: number
  /** Need for this night: the setting plus the carried-over share of last night's shortfall */
  needTonightMinutes: number
  components: ScoreComponent[]
  /** Facts the AI and UI can explain the score with */
  facts: {
    minutesAsleep: number
    minutesInBed: number
    deepMinutes: number | null
    remMinutes: number | null
    bedtimeLocal: string | null
    wakeLocal: string | null
    shortAwakenings: number | null
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

/** Local clock time of the night's start or end as minutes after `pivot`, so times either side of midnight stay comparable. */
function clockOffsetMin(pick: SleepPick, edge: 'start' | 'end', pivot: number): number | null {
  const interval = pick.body.interval as Record<string, string | undefined> | undefined
  const time = interval?.[`${edge}Time`]
  if (!time) return null
  const offsetSec = Number.parseFloat(interval?.[`${edge}UtcOffset`] ?? interval?.startUtcOffset ?? '0') || 0
  const local = new Date(new Date(time).getTime() + offsetSec * 1000)
  return (local.getUTCHours() * 60 + local.getUTCMinutes() - pivot + 1440) % 1440
}

/** Bedtimes are measured from noon, wake times from 18:00, so neither wraps at midnight in normal use */
const BED_PIVOT = 720
const WAKE_PIVOT = 1080

const clock = (offsetMin: number, pivot: number) => {
  const m = Math.round(offsetMin + pivot) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Below `lo` falls linearly to zero at lo/2; at or above `lo` is full. */
const rangeScore = (share: number, lo: number) => clamp01((share - lo / 2) / (lo / 2))

const asleepOf = (pick: SleepPick) => summaryOf(pick).asleep

/** `sleepPoints` should cover the date and the ~7 nights before it. */
export function buildSleepScore(date: string, sleepPoints: StoredPoint[], sleepNeedMinutes = DEFAULT_SLEEP_NEED_MIN): SleepScore {
  const pick = mainSleepFor(sleepPoints, date)
  if (!pick) {
    return { date, score: null, sleepNeedMinutes, needTonightMinutes: sleepNeedMinutes, components: [], facts: null, note: 'No main sleep recorded for this date. Check health.sync_status and run health.sync.' }
  }
  const { asleep, inBed, stages } = summaryOf(pick)
  const components: ScoreComponent[] = []

  const last = mainSleepFor(sleepPoints, addDays(date, -1))
  const carried = last ? Math.round(DEBT_CARRYOVER * Math.max(0, sleepNeedMinutes - asleepOf(last))) : 0
  const needTonight = sleepNeedMinutes + carried
  components.push({
    id: 'duration',
    label: 'Duration',
    max: 55,
    points: 55 * clamp01(asleep / needTonight),
    detail: `${formatMinutes(asleep)} of ${formatMinutes(needTonight)} needed${carried > 0 ? ` (includes ${formatMinutes(carried)} carried over from a short night)` : ''}`,
  })

  const bed = clockOffsetMin(pick, 'start', BED_PIVOT)
  const wake = clockOffsetMin(pick, 'end', WAKE_PIVOT)
  const priorBed: number[] = []
  const priorWake: number[] = []
  for (let i = 1; i <= REGULARITY_LOOKBACK; i++) {
    const earlier = mainSleepFor(sleepPoints, addDays(date, -i))
    const b = earlier ? clockOffsetMin(earlier, 'start', BED_PIVOT) : null
    const w = earlier ? clockOffsetMin(earlier, 'end', WAKE_PIVOT) : null
    if (b !== null && w !== null) {
      priorBed.push(b)
      priorWake.push(w)
    }
  }
  if (bed !== null && wake !== null && priorBed.length >= REGULARITY_MIN_NIGHTS) {
    const meanBed = priorBed.reduce((a, b) => a + b, 0) / priorBed.length
    const meanWake = priorWake.reduce((a, b) => a + b, 0) / priorWake.length
    const bedDiff = Math.abs(bed - meanBed)
    const wakeDiff = Math.abs(wake - meanWake)
    components.push({
      id: 'regularity',
      label: 'Regularity',
      max: 15,
      points: 15 * clamp01(1 - ((bedDiff + wakeDiff) / 2 - 15) / 75),
      detail: `Bed ${clock(bed, BED_PIVOT)} (${Math.round(bedDiff)} min from usual ${clock(meanBed, BED_PIVOT)}), up ${clock(wake, WAKE_PIVOT)} (${Math.round(wakeDiff)} min from usual ${clock(meanWake, WAKE_PIVOT)})`,
    })
  } else {
    components.push({ id: 'regularity', label: 'Regularity', max: 15, points: null, detail: `Needs ${REGULARITY_MIN_NIGHTS} earlier nights (${priorBed.length} so far)` })
  }

  const hasStages = stages.has('DEEP') || stages.has('REM')
  const shortAwakenings = hasStages ? (((pick.body.shortAwakenings as unknown[] | undefined) ?? []).length) : null
  if (shortAwakenings !== null && inBed && inBed > 0) {
    const perHour = shortAwakenings / (inBed / 60)
    components.push({
      id: 'restlessness',
      label: 'Restlessness',
      max: 10,
      points: 10 * clamp01(1 - (perHour - 0.5) / 2.5),
      detail: `${shortAwakenings} brief wake-ups (${perHour.toFixed(1)} an hour)`,
    })
  } else {
    components.push({ id: 'restlessness', label: 'Restlessness', max: 10, points: null, detail: 'No stage breakdown for this night' })
  }

  if (inBed && inBed > 0) {
    const eff = asleep / inBed
    components.push({
      id: 'efficiency',
      label: 'Efficiency',
      max: 5,
      points: 5 * clamp01((eff - 0.75) / (0.92 - 0.75)),
      detail: `${Math.round(eff * 100)}% of time in bed asleep`,
    })
  } else {
    components.push({ id: 'efficiency', label: 'Efficiency', max: 5, points: null, detail: 'Time in bed unknown' })
  }

  const deep = hasStages ? (stages.get('DEEP') ?? 0) : null
  const rem = hasStages ? (stages.get('REM') ?? 0) : null
  if (hasStages && asleep > 0) {
    const deepShare = deep! / asleep
    const remShare = rem! / asleep
    components.push({
      id: 'restorative',
      label: 'Restorative sleep',
      max: 15,
      points: 7.5 * rangeScore(deepShare, 0.13) + 7.5 * rangeScore(remShare, 0.2),
      detail: `Deep ${Math.round(deepShare * 100)}%, REM ${Math.round(remShare * 100)}% of sleep`,
    })
  } else {
    components.push({ id: 'restorative', label: 'Restorative sleep', max: 15, points: null, detail: 'No stage breakdown for this night' })
  }

  const available = components.filter((c) => c.points !== null)
  const max = available.reduce((a, c) => a + c.max, 0)
  const earned = available.reduce((a, c) => a + (c.points ?? 0), 0)
  const dropped = components.filter((c) => c.points === null).map((c) => c.label)

  return {
    date,
    score: max > 0 ? Math.round((earned / max) * 100) : null,
    sleepNeedMinutes,
    needTonightMinutes: needTonight,
    components,
    facts: {
      minutesAsleep: asleep,
      minutesInBed: inBed ?? asleep,
      deepMinutes: deep,
      remMinutes: rem,
      bedtimeLocal: bed !== null ? clock(bed, BED_PIVOT) : null,
      wakeLocal: wake !== null ? clock(wake, WAKE_PIVOT) : null,
      shortAwakenings,
    },
    note: dropped.length ? `Not counted (data missing): ${dropped.join(', ')}. The rest is rescaled to 100.` : undefined,
  }
}
