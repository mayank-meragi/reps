import { describe, expect, it } from 'vitest'
import { HeartRateHistogramBuilder } from './rollup'

const sample = (iso: string, bpm: number, day = 9) => ({
  heartRate: {
    sampleTime: { physicalTime: iso, civilTime: { date: { year: 2026, month: 10, day } } },
    beatsPerMinute: String(bpm),
  },
})

describe('HeartRateHistogramBuilder', () => {
  it('credits each sample with the time until the next one, newest-first', () => {
    const b = new HeartRateHistogramBuilder()
    // newest first: 10:00:30 (90) ← 10:00:00 (70) ← 09:59:40 (70)
    b.add([sample('2026-10-09T10:00:30Z', 90), sample('2026-10-09T10:00:00Z', 70), sample('2026-10-09T09:59:40Z', 70)])
    const [row] = b.finish()
    const body = row.heartRate as { minutesByBpm: Record<string, number>; totalMinutes: number }
    // 70 at 10:00:00 is held 30 s (until the 90), 70 at 09:59:40 is held 20 s (until 10:00:00); the newest sample has no successor
    expect(body.minutesByBpm).toEqual({ '70': 0.83 })
    expect(body.totalMinutes).toBe(0.83)
  })

  it('caps gaps at 60 s and carries the previous sample across pages', () => {
    const b = new HeartRateHistogramBuilder()
    b.add([sample('2026-10-09T12:00:00Z', 80)])
    b.add([sample('2026-10-09T08:00:00Z', 60)]) // 4 hours earlier: the band was off
    const body = b.finish()[0].heartRate as { minutesByBpm: Record<string, number> }
    expect(body.minutesByBpm).toEqual({ '60': 1 })
  })

  it('splits by civil day and skips unusable points', () => {
    const b = new HeartRateHistogramBuilder()
    b.add([sample('2026-10-10T00:00:30Z', 100, 10), sample('2026-10-10T00:00:00Z', 100, 10), { heartRate: {} }, sample('2026-10-09T23:59:30Z', 70, 9), sample('2026-10-09T23:59:00Z', 70, 9)])
    const rows = b.finish().map((r) => (r.heartRate as { date: { day: number }; totalMinutes: number }))
    // day 9: 23:59:30 held 30 s (to 00:00:00 next day) + 23:59:00 held 30 s; day 10: 00:00:00 held 30 s
    expect(rows.map((r) => [r.date.day, r.totalMinutes])).toEqual([[10, 0.5], [9, 1]])
  })
})
