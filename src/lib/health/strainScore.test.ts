import { describe, expect, it } from 'vitest'
import type { StoredPoint } from './types'
import { buildStrainScore, strainFromLoad } from './strainScore'

const row = (date: string, minutesByBpm: Record<string, number>): StoredPoint => ({
  date,
  start: null,
  end: null,
  data: { heartRate: { date: {}, minutesByBpm, totalMinutes: Object.values(minutesByBpm).reduce((a, b) => a + b, 0) } },
})

describe('buildStrainScore', () => {
  it('counts nothing below 110 bpm: sleep and rest stay at zero', () => {
    const s = buildStrainScore('2026-10-09', [row('2026-10-09', { '55': 480, '75': 600, '100': 300, '110': 10 })], null)
    expect(s.load).toBe(0)
    expect(s.score).toBe(0)
  })

  it('weights each minute by how far it is above 110 bpm', () => {
    const s = buildStrainScore('2026-10-05', [row('2026-10-05', { '120': 10, '150': 10 })], null)
    expect(s.load).toBe(10 * 10 + 10 * 40)
    expect(s.score).toBe(Math.round(100 * (1 - Math.exp(-500 / 1234))))
    expect(s.minutesAbove).toEqual({ 110: 20, 130: 10, 150: 10 })
  })

  it('maps a hard training day to about 90 and a quiet day to about 11', () => {
    // load 3,000 ≈ the 5 Oct lifting day, 150 ≈ a quiet day
    expect(strainFromLoad(3000)).toBe(91)
    expect(strainFromLoad(150)).toBe(11)
  })

  it('saturates below 100 and never goes negative', () => {
    expect(strainFromLoad(0)).toBe(0)
    expect(strainFromLoad(1_000_000)).toBeLessThanOrEqual(100)
  })

  it('sets the target band from the recovery zone', () => {
    const pts = [row('2026-10-05', { '120': 10 })]
    expect(buildStrainScore('2026-10-05', pts, 'green').target).toEqual({ low: 60, high: 85, basedOn: 'green' })
    expect(buildStrainScore('2026-10-05', pts, 'red').target).toEqual({ low: 0, high: 35, basedOn: 'red' })
    expect(buildStrainScore('2026-10-05', pts, null).target).toBeNull()
  })

  it('reports no_data when the date has no row', () => {
    const s = buildStrainScore('2026-10-06', [row('2026-10-05', { '120': 10 })], 'yellow')
    expect(s.status).toBe('no_data')
    expect(s.score).toBeNull()
    expect(s.target).not.toBeNull()
  })
})
