import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { formatFixed, formatMinutes } from './format'
import { baselineStats, MIN_BASELINE_DAYS } from './health/baseline'
import { clamp, clamp01, meanSd, toNumber } from './math'

describe('shared helpers', () => {
  it('addDays moves civil dates across month and year edges', () => {
    expect(addDays('2026-10-09', -1)).toBe('2026-10-08')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('formatMinutes drops empty parts', () => {
    expect([formatMinutes(417), formatMinutes(480), formatMinutes(45), formatMinutes(0), formatMinutes(125)]).toEqual(['6h 57m', '8h', '45m', '0m', '2h 5m'])
    expect(formatFixed(55.123)).toBe('55.1')
    expect(formatFixed(55.123, 0)).toBe('55')
  })

  it('math helpers', () => {
    expect([clamp(5, 0, 3), clamp(-1, 0, 3), clamp01(2), clamp01(0.4)]).toEqual([3, 0, 1, 0.4])
    expect([toNumber('61'), toNumber(11), toNumber('x'), toNumber(NaN), toNumber(undefined)]).toEqual([61, 11, null, null, null])
    expect(meanSd([2, 4, 4, 4, 5, 5, 7, 9])).toEqual({ mean: 5, sd: 2 })
  })

  it('baselineStats needs the minimum number of days', () => {
    expect(baselineStats([1, 2, 3])).toBeNull()
    const enough = Array.from({ length: MIN_BASELINE_DAYS }, (_, i) => i)
    expect(baselineStats(enough)?.mean).toBe(2)
  })
})
