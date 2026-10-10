import { describe, expect, it } from 'vitest'
import type { StoredPoint } from './types'
import { buildRecoveryScore, recoveryZone, type RecoveryInputs } from './recoveryScore'

const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}`
const pt = (date: string, data: unknown): StoredPoint => ({ date, start: null, end: null, data })

const hrvPt = (d: string, ms: number) => pt(d, { dailyHeartRateVariability: { averageHeartRateVariabilityMilliseconds: ms } })
const rhrPt = (d: string, bpm: number) => pt(d, { dailyRestingHeartRate: { beatsPerMinute: String(bpm) } })
const rrPt = (d: string, v: number) => pt(d, { dailyRespiratoryRate: { breathsPerMinute: v } })
const spo2Pt = (d: string, v: number) => pt(d, { dailyOxygenSaturation: { averagePercentage: v } })
const tempPt = (d: string, v: number) => pt(d, { dailySleepTemperatureDerivations: { nightlyTemperatureCelsius: v } })
const sleepPt = (d: string, asleep: number): StoredPoint => ({
  date: d,
  start: null,
  end: null,
  data: { sleep: { metadata: { mainSleep: true }, interval: { startTime: `${d}T00:00:00Z` }, summary: { minutesAsleep: String(asleep), minutesInSleepPeriod: String(asleep + 10), stagesSummary: [] } } },
})

/** `n` baseline days (9/1..) with small natural wobble, then 9/(n+1) = target day. */
function inputs(n: number, today: { hrv?: number; rhr?: number; rr?: number; spo2?: number; temp?: number; sleep?: number }): { date: string; inputs: RecoveryInputs } {
  const wob = (i: number) => (i % 2 ? 1 : -1)
  const empty = (): StoredPoint[] => []
  const out: RecoveryInputs = { hrv: empty(), rhr: empty(), rr: empty(), spo2: empty(), temp: empty(), sleep: empty() }
  for (let i = 1; i <= n; i++) {
    out.hrv.push(hrvPt(day(i), 50 + wob(i) * 3))
    out.rhr.push(rhrPt(day(i), 60 + wob(i) * 1.5))
    out.rr.push(rrPt(day(i), 14 + wob(i) * 0.5))
    out.spo2.push(spo2Pt(day(i), 96 + wob(i) * 0.5))
    out.temp.push(tempPt(day(i), 33 + wob(i) * 0.2))
    out.sleep.push(sleepPt(day(i), 420 + wob(i) * 20))
  }
  const d = day(n + 1)
  if (today.hrv !== undefined) out.hrv.push(hrvPt(d, today.hrv))
  if (today.rhr !== undefined) out.rhr.push(rhrPt(d, today.rhr))
  if (today.rr !== undefined) out.rr.push(rrPt(d, today.rr))
  if (today.spo2 !== undefined) out.spo2.push(spo2Pt(d, today.spo2))
  if (today.temp !== undefined) out.temp.push(tempPt(d, today.temp))
  if (today.sleep !== undefined) out.sleep.push(sleepPt(d, today.sleep))
  return { date: d, inputs: out }
}

describe('buildRecoveryScore', () => {
  it('lands near 50 on a baseline day', () => {
    const { date, inputs: i } = inputs(10, { hrv: 50, rhr: 60, rr: 14, sleep: 420 })
    const r = buildRecoveryScore(date, i)
    expect(r.status).toBe('ok')
    expect(r.score!).toBeGreaterThanOrEqual(45)
    expect(r.score!).toBeLessThanOrEqual(55)
    expect(r.zone).toBe('yellow')
  })

  it('rewards high HRV, low resting HR and good sleep (green) and the reverse (red)', () => {
    const good = inputs(10, { hrv: 62, rhr: 56, rr: 13, sleep: 470 })
    const bad = inputs(10, { hrv: 38, rhr: 66, rr: 15.5, sleep: 330 })
    const g = buildRecoveryScore(good.date, good.inputs)
    const b = buildRecoveryScore(bad.date, bad.inputs)
    expect(g.zone).toBe('green')
    expect(b.zone).toBe('red')
    expect(g.components.find((c) => c.id === 'rhr')!.z!).toBeGreaterThan(0) // lower RHR is positive
    expect(b.components.find((c) => c.id === 'hrv')!.z!).toBeLessThan(0)
  })

  it('calibrates until 5 baseline days exist', () => {
    const { date, inputs: i } = inputs(3, { hrv: 50, rhr: 60, rr: 14, sleep: 420 })
    const r = buildRecoveryScore(date, i)
    expect(r.status).toBe('calibrating')
    expect(r.score).toBeNull()
    expect(r.calibration).toEqual({ have: 3, need: 5 })
  })

  it('reports no_data when today has no HRV or resting HR', () => {
    const { date, inputs: i } = inputs(10, { rr: 14 })
    expect(buildRecoveryScore(date, i).status).toBe('no_data')
  })

  it('rescales over the inputs that exist', () => {
    const { date, inputs: i } = inputs(10, { hrv: 50, rhr: 60 })
    const r = buildRecoveryScore(date, i)
    expect(r.status).toBe('ok')
    const w = r.components.filter((c) => c.effectiveWeight !== null).reduce((a, c) => a + c.effectiveWeight!, 0)
    expect(w).toBeCloseTo(1)
    expect(r.note).toMatch(/Sleep score|Respiratory/)
  })

  it('deducts for an unusual skin temperature and low SpO2, never below zero', () => {
    const base = inputs(10, { hrv: 50, rhr: 60, rr: 14, sleep: 420, temp: 33, spo2: 96 })
    const sick = inputs(10, { hrv: 50, rhr: 60, rr: 14, sleep: 420, temp: 34.5, spo2: 92 })
    const a = buildRecoveryScore(base.date, base.inputs)
    const b = buildRecoveryScore(sick.date, sick.inputs)
    expect(b.flags.find((f) => f.id === 'temp')!.penalty).toBe(5)
    expect(b.flags.find((f) => f.id === 'spo2')!.penalty).toBe(5)
    expect(b.score!).toBe(Math.max(0, a.score! - 10))
  })

  it('maps scores to zones', () => {
    expect([recoveryZone(33), recoveryZone(34), recoveryZone(66), recoveryZone(67)]).toEqual(['red', 'yellow', 'yellow', 'green'])
  })
})
