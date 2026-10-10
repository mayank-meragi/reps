import { describe, expect, it } from 'vitest'
import type { StoredPoint } from '@/lib/health/types'
import { buildHealthMonitor } from './healthMonitor'

const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}`
const rhr = (date: string, bpm: number): StoredPoint => ({ date, start: null, end: null, data: { dailyRestingHeartRate: { beatsPerMinute: String(bpm) } } })

describe('buildHealthMonitor', () => {
  const history = [1, 2, 3, 4, 5, 6].map((n, i) => rhr(day(n), 60 + (i % 2 ? 1 : -1)))

  it('flags a value outside mean ± 1 sd and tones it by direction', () => {
    const m = buildHealthMonitor(day(7), { 'daily-resting-heart-rate': [...history, rhr(day(7), 52)] }).metrics.find((x) => x.id === 'rhr')!
    expect(m.value).toBe(52)
    expect(m.status).toBe('lower')
    expect(m.tone).toBe('favorable') // lower resting HR is the healthy direction
    expect(m.position).toBe(0)
  })

  it('reports normal inside the range and unknown without enough history', () => {
    const normal = buildHealthMonitor(day(7), { 'daily-resting-heart-rate': [...history, rhr(day(7), 60)] }).metrics.find((x) => x.id === 'rhr')!
    expect(normal.status).toBe('normal')
    const few = buildHealthMonitor(day(3), { 'daily-resting-heart-rate': history.slice(0, 3) }).metrics.find((x) => x.id === 'rhr')!
    expect(few.status).toBe('unknown')
  })

  it('builds sleep from the main sleep ending that day and lists it in the timeline', () => {
    const sleep = (date: string, asleep: string, mainSleep: boolean): StoredPoint => ({
      date,
      start: `${date}T00:00:00Z`,
      end: `${date}T07:00:00Z`,
      data: { sleep: { metadata: { mainSleep }, summary: { minutesAsleep: asleep } } },
    })
    const out = buildHealthMonitor(day(7), { sleep: [sleep(day(7), '30', false), sleep(day(7), '417', true)] })
    expect(out.metrics.find((m) => m.id === 'sleep')!.value).toBe(417)
    expect(out.timeline).toEqual([{ kind: 'sleep', title: 'Primary sleep', at: `${day(7)}T07:00:00Z`, durationMinutes: 417 }])
  })
})
