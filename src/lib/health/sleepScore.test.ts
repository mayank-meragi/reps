import { describe, expect, it } from 'vitest'
import type { StoredPoint } from './types'
import { buildSleepScore } from './sleepScore'

/** A night that ended on `date`, going to bed at `bedUtc` (HH:MM) the previous day, in IST (+05:30). */
function night(date: string, bedUtc: string, stages: Record<string, number>, opts: { nap?: boolean } = {}): StoredPoint {
  const asleep = Object.entries(stages).filter(([t]) => t !== 'AWAKE').reduce((a, [, m]) => a + m, 0)
  const inBed = asleep + (stages.AWAKE ?? 0)
  const prev = new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10)
  return {
    date,
    start: `${prev}T${bedUtc}:00Z`,
    end: `${date}T03:00:00Z`,
    data: {
      sleep: {
        interval: { startTime: `${prev}T${bedUtc}:00Z`, startUtcOffset: '19800s', endTime: `${date}T03:00:00Z` },
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

describe('buildSleepScore', () => {
  it('scores a full night against the sleep need and shows every part', () => {
    const points = ['01', '02', '03', '04', '05'].map((d) => night(`2026-10-${d}`, '20:00', GOOD))
    const s = buildSleepScore('2026-10-05', points)
    expect(s.components.map((c) => c.id)).toEqual(['duration', 'efficiency', 'restorative', 'consistency'])
    expect(s.components.every((c) => c.points !== null)).toBe(true)
    // duration 417/480 of 40, efficiency full 20, restorative full 25, consistency full 15
    expect(s.score).toBe(Math.round((40 * 417) / 480 + 20 + 25 + 15))
    expect(s.note).toBeUndefined()
  })

  it('drops consistency until 4 earlier nights exist and rescales the rest to 100', () => {
    const s = buildSleepScore('2026-10-02', [night('2026-10-01', '20:00', GOOD), night('2026-10-02', '20:00', GOOD)])
    expect(s.components.find((c) => c.id === 'consistency')!.points).toBeNull()
    expect(s.score).toBe(Math.round((((40 * 417) / 480 + 20 + 25) / 85) * 100))
    expect(s.note).toMatch(/Consistency/)
  })

  it('drops the stage part for classic sleep without stages', () => {
    const s = buildSleepScore('2026-10-02', [night('2026-10-02', '20:00', { ASLEEP: 235 })])
    expect(s.components.find((c) => c.id === 'restorative')!.points).toBeNull()
    expect(s.facts!.deepMinutes).toBeNull()
  })

  it('penalises short sleep, low efficiency and thin deep/REM', () => {
    const s = buildSleepScore('2026-10-02', [night('2026-10-02', '20:00', { AWAKE: 90, LIGHT: 240, DEEP: 10, REM: 10 })])
    expect(s.score!).toBeLessThan(45)
  })

  it('respects a custom sleep need', () => {
    expect(buildSleepScore('2026-10-02', [night('2026-10-02', '20:00', GOOD)], 417).components[0].points).toBe(40)
  })

  it('ignores naps and returns null when there is no night', () => {
    const nap = night('2026-10-02', '08:00', { AWAKE: 5, LIGHT: 120 }, { nap: true })
    expect(buildSleepScore('2026-10-02', [nap]).score).toBeNull()
  })

  it('zeroes consistency when bedtime drifts three hours', () => {
    const base = ['01', '02', '03', '04'].map((d) => night(`2026-10-${d}`, '20:00', GOOD))
    const late = buildSleepScore('2026-10-05', [...base, night('2026-10-05', '23:00', GOOD)])
    expect(late.components.find((c) => c.id === 'consistency')!.points).toBe(0)
  })
})
