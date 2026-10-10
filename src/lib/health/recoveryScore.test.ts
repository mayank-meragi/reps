import { describe, expect, it } from 'vitest'
import { buildRecoveryScore, planningZone, recoveryZone, RECOVERY_FULL_BASELINE_DAYS, type RecoveryInputs } from './recoveryScore'
import type { StoredPoint } from './types'

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

interface Today {
  hrv?: number
  rhr?: number
  rr?: number
  spo2?: number
  temp?: number
  /** minutes asleep last night; defaults to a normal night so the night gate passes */
  sleep?: number
}

/** `n` baseline days (9/1..) with small natural wobble, then day n+1 is the target day. */
function inputs(n: number, today: Today): { date: string; inputs: RecoveryInputs } {
  const wob = (i: number) => (i % 2 ? 1 : -1)
  const out: RecoveryInputs = { hrv: [], rhr: [], rr: [], spo2: [], temp: [], sleep: [] }
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
  out.sleep.push(sleepPt(d, today.sleep ?? 420))
  return { date: d, inputs: out }
}

const FULL = RECOVERY_FULL_BASELINE_DAYS
const NORMAL = { hrv: 50, rhr: 60, rr: 14 }

describe('buildRecoveryScore', () => {
  it('lands near 50 on a baseline day once the baseline is full', () => {
    const { date, inputs: i } = inputs(20, NORMAL)
    const r = buildRecoveryScore(date, i)
    expect(r.status).toBe('ok')
    expect(r.score!).toBeGreaterThanOrEqual(45)
    expect(r.score!).toBeLessThanOrEqual(55)
    expect(r.zone).toBe('yellow')
    expect(r.provisionalScore).toBeNull()
  })

  it('rewards high HRV, low resting HR and good sleep (green) and the reverse (red)', () => {
    const good = inputs(20, { hrv: 62, rhr: 56, rr: 13, sleep: 470 })
    const bad = inputs(20, { hrv: 38, rhr: 66, rr: 15.5, sleep: 330 })
    const g = buildRecoveryScore(good.date, good.inputs)
    const b = buildRecoveryScore(bad.date, bad.inputs)
    expect(g.zone).toBe('green')
    expect(b.zone).toBe('red')
    expect(g.components.find((c) => c.id === 'rhr')!.z!).toBeGreaterThan(0) // lower RHR is positive
    expect(b.components.find((c) => c.id === 'hrv')!.z!).toBeLessThan(0)
  })

  it('reaches 99–100 when every signal is far better than usual, and stays at 1 or above at the bottom', () => {
    const top = inputs(20, { hrv: 120, rhr: 45, rr: 10, sleep: 600 })
    const bottom = inputs(20, { hrv: 12, rhr: 90, rr: 22, sleep: 250 })
    // all four inputs clamp at z +3 only if the sleep score is also extreme, so "near 100" is the realistic top
    expect(buildRecoveryScore(top.date, top.inputs).score!).toBeGreaterThanOrEqual(99)
    const low = buildRecoveryScore(bottom.date, bottom.inputs).score!
    expect(low).toBeGreaterThanOrEqual(1)
    expect(low).toBeLessThanOrEqual(5)
  })

  it('shows no estimate before 5 baseline days (calibrating)', () => {
    const { date, inputs: i } = inputs(3, NORMAL)
    const r = buildRecoveryScore(date, i)
    expect(r.status).toBe('calibrating')
    expect(r.score).toBeNull()
    expect(r.provisionalScore).toBeNull()
    expect(r.calibration).toEqual({ have: 3, need: FULL })
  })

  it('gives only a provisional estimate from 5 to 13 baseline days', () => {
    const { date, inputs: i } = inputs(8, { hrv: 58, rhr: 58, rr: 13, sleep: 450 })
    const r = buildRecoveryScore(date, i)
    expect(r.status).toBe('provisional')
    expect(r.score).toBeNull()
    expect(r.zone).toBeNull()
    expect(r.provisionalScore).not.toBeNull()
    expect(r.calibration).toEqual({ have: 8, need: FULL })
    expect(r.note).toMatch(/Provisional/)
    expect(r.components.some((c) => c.z !== null)).toBe(true) // the parts are still explained
  })

  it('shows the score from exactly 14 baseline days', () => {
    expect(buildRecoveryScore(inputs(FULL, NORMAL).date, inputs(FULL, NORMAL).inputs).status).toBe('ok')
    expect(buildRecoveryScore(inputs(FULL - 1, NORMAL).date, inputs(FULL - 1, NORMAL).inputs).status).toBe('provisional')
  })

  it('gives no score for a night under 4 hours', () => {
    const { date, inputs: i } = inputs(20, { ...NORMAL, sleep: 200 })
    const r = buildRecoveryScore(date, i)
    expect(r.status).toBe('insufficient_sleep')
    expect(r.score).toBeNull()
    expect(r.note).toMatch(/under 4 hours/)
  })

  it('leaves short nights out of the baseline', () => {
    const { date, inputs: i } = inputs(FULL, NORMAL)
    expect(buildRecoveryScore(date, i).status).toBe('ok')
    i.sleep[2] = sleepPt(day(3), 200) // one baseline night was too short to trust
    const r = buildRecoveryScore(date, i)
    expect(r.status).toBe('provisional')
    expect(r.calibration.have).toBe(FULL - 1)
  })

  it('reports no_data when the night has no HRV or resting HR, or no sleep at all', () => {
    const noReading = inputs(20, { rr: 14 })
    expect(buildRecoveryScore(noReading.date, noReading.inputs).status).toBe('no_data')
    const noSleep = inputs(20, NORMAL)
    noSleep.inputs.sleep = noSleep.inputs.sleep.slice(0, -1)
    expect(buildRecoveryScore(noSleep.date, noSleep.inputs).status).toBe('no_data')
  })

  it('rescales over the inputs that exist', () => {
    const { date, inputs: i } = inputs(20, { hrv: 50, rhr: 60 })
    const r = buildRecoveryScore(date, i)
    expect(r.status).toBe('ok')
    const w = r.components.filter((c) => c.effectiveWeight !== null).reduce((a, c) => a + c.effectiveWeight!, 0)
    expect(w).toBeCloseTo(1)
    expect(r.note).toMatch(/Respiratory/)
  })

  it('deducts for an unusual skin temperature and low SpO2', () => {
    const base = inputs(20, { ...NORMAL, temp: 33, spo2: 96 })
    const sick = inputs(20, { ...NORMAL, temp: 34.5, spo2: 92 })
    const a = buildRecoveryScore(base.date, base.inputs)
    const b = buildRecoveryScore(sick.date, sick.inputs)
    expect(b.flags.find((f) => f.id === 'temp')!.penalty).toBe(5)
    expect(b.flags.find((f) => f.id === 'spo2')!.penalty).toBe(5)
    expect(b.score!).toBe(a.score! - 10)
  })

  it('maps scores to zones', () => {
    expect([recoveryZone(33), recoveryZone(34), recoveryZone(66), recoveryZone(67)]).toEqual(['red', 'yellow', 'yellow', 'green'])
  })

  it('plans against the score, else the early estimate, else nothing', () => {
    const ok = inputs(20, NORMAL)
    expect(planningZone(buildRecoveryScore(ok.date, ok.inputs))).toEqual({ zone: 'yellow', provisional: false })
    const early = inputs(8, { hrv: 58, rhr: 58, rr: 13, sleep: 450 })
    expect(planningZone(buildRecoveryScore(early.date, early.inputs))).toMatchObject({ provisional: true })
    const none = inputs(3, NORMAL)
    expect(planningZone(buildRecoveryScore(none.date, none.inputs))).toBeNull()
  })
})
