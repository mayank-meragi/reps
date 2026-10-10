import { describe, expect, it } from 'vitest'
import type { StoredPoint } from './types'
import { buildSleepScore } from './sleepScore'

/** A night that ended on `date`, going to bed at `bedUtc` (HH:MM) the previous day, in IST (+05:30). */
function night(date: string, bedUtc: string, stages: Record<string, number>, opts: { nap?: boolean; short?: number; endUtc?: string } = {}): StoredPoint {
  const asleep = Object.entries(stages).filter(([t]) => t !== 'AWAKE').reduce((a, [, m]) => a + m, 0)
  const inBed = asleep + (stages.AWAKE ?? 0)
  const prev = new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10)
  return {
    date,
    start: `${prev}T${bedUtc}:00Z`,
    end: `${date}T${opts.endUtc ?? '03:00'}:00Z`,
    data: {
      sleep: {
        interval: { startTime: `${prev}T${bedUtc}:00Z`, startUtcOffset: '19800s', endTime: `${date}T${opts.endUtc ?? '03:00'}:00Z` },
        shortAwakenings: Array.from({ length: opts.short ?? 0 }, () => ({})),
        metadata: opts.nap ? { nap: true } : { mainSleep: true },
        summary: {
          minutesAsleep: String(asleep),
          minutesInSleepPeriod: String(inBed),
          stagesSummary: Object.entries(stages).map(([type, minutes]) => ({ type, minutes: String(minutes) })),
        },
      },
    },
  }
}
const GOOD = { AWAKE: 8, LIGHT: 238, DEEP: 80, REM: 99 } // 417 asleep, 425 in bed

const ids = (s: ReturnType<typeof buildSleepScore>) => s.components.map((c) => c.id)
const pts = (s: ReturnType<typeof buildSleepScore>, id: string) => s.components.find((c) => c.id === id)!.points

describe('buildSleepScore', () => {
  it('scores a full night against the sleep need and shows every part', () => {
    const points = ['01', '02', '03', '04', '05'].map((d) => night(`2026-10-${d}`, '20:00', GOOD))
    const s = buildSleepScore('2026-10-05', points)
    expect(ids(s)).toEqual(['duration', 'regularity', 'restlessness', 'efficiency', 'restorative'])
    expect(s.components.every((c) => c.points !== null)).toBe(true)
    // last night was also 417 min: need 480 + 25% of 63 = 496; duration 417/496 of 55, rest full
    const need = 480 + Math.round(0.25 * (480 - 417))
    expect(s.needTonightMinutes).toBe(need)
    expect(s.score).toBe(Math.round((55 * (417 / need) + 15 + 10 + 5 + 15)))
    expect(s.note).toBeUndefined()
  })

  it('carries a quarter of a short night into the next need, and nothing after a full night', () => {
    const short = buildSleepScore('2026-10-02', [night('2026-10-01', '20:00', { AWAKE: 5, LIGHT: 240 }), night('2026-10-02', '20:00', GOOD)])
    expect(short.needTonightMinutes).toBe(480 + Math.round(0.25 * (480 - 240)))
    const full = buildSleepScore('2026-10-02', [night('2026-10-01', '20:00', { AWAKE: 5, LIGHT: 500 }), night('2026-10-02', '20:00', GOOD)])
    expect(full.needTonightMinutes).toBe(480)
    const first = buildSleepScore('2026-10-02', [night('2026-10-02', '20:00', GOOD)])
    expect(first.needTonightMinutes).toBe(480)
  })

  it('drops regularity until 4 earlier nights exist and rescales the rest to 100', () => {
    const s = buildSleepScore('2026-10-02', [night('2026-10-02', '20:00', GOOD)])
    expect(pts(s, 'regularity')).toBeNull()
    expect(s.score).toBe(Math.round(((55 * (417 / 480) + 10 + 5 + 15) / 85) * 100))
    expect(s.note).toMatch(/Regularity/)
  })

  it('drops restlessness and stages for classic sleep without stages', () => {
    const s = buildSleepScore('2026-10-02', [night('2026-10-02', '20:00', { ASLEEP: 235 })])
    expect(pts(s, 'restorative')).toBeNull()
    expect(pts(s, 'restlessness')).toBeNull()
    expect(s.facts!.deepMinutes).toBeNull()
    expect(s.facts!.shortAwakenings).toBeNull()
  })

  it('penalises short sleep, low efficiency, restlessness and thin deep/REM', () => {
    const s = buildSleepScore('2026-10-02', [night('2026-10-02', '20:00', { AWAKE: 90, LIGHT: 240, DEEP: 10, REM: 10 }, { short: 20 })])
    expect(s.score!).toBeLessThan(45)
    expect(pts(s, 'restlessness')).toBe(0)
  })

  it('scores restlessness by brief wake-ups per hour in bed', () => {
    const calm = buildSleepScore('2026-10-02', [night('2026-10-02', '20:00', GOOD, { short: 2 })]) // 0.28 an hour
    const busy = buildSleepScore('2026-10-02', [night('2026-10-02', '20:00', GOOD, { short: 11 })]) // 1.55 an hour
    expect(pts(calm, 'restlessness')).toBe(10)
    expect(pts(busy, 'restlessness')!).toBeCloseTo(10 * (1 - (11 / (425 / 60) - 0.5) / 2.5), 5)
  })

  it('respects a custom sleep need', () => {
    expect(buildSleepScore('2026-10-02', [night('2026-10-02', '20:00', GOOD)], 417).components[0].points).toBe(55)
  })

  it('ignores naps and returns null when there is no night', () => {
    const nap = night('2026-10-02', '08:00', { AWAKE: 5, LIGHT: 120 }, { nap: true })
    expect(buildSleepScore('2026-10-02', [nap]).score).toBeNull()
  })

  it('zeroes regularity when bed and wake times drift by 90+ minutes or more', () => {
    const base = ['01', '02', '03', '04'].map((d) => night(`2026-10-${d}`, '20:00', GOOD))
    const late = buildSleepScore('2026-10-05', [...base, night('2026-10-05', '23:00', GOOD, { endUtc: '06:00' })])
    expect(pts(late, 'regularity')).toBe(0)
  })

  it('notices a changed wake time even when bedtime is steady', () => {
    const base = ['01', '02', '03', '04'].map((d) => night(`2026-10-${d}`, '20:00', GOOD))
    const steady = buildSleepScore('2026-10-05', [...base, night('2026-10-05', '20:00', GOOD)])
    const earlyWake = buildSleepScore('2026-10-05', [...base, night('2026-10-05', '20:00', GOOD, { endUtc: '01:00' })]) // up 2 h earlier
    expect(pts(steady, 'regularity')).toBe(15)
    expect(pts(earlyWake, 'regularity')!).toBeLessThan(15)
  })
})
