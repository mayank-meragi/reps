import { describe, expect, it } from 'vitest'
import { findDataType } from './dataTypes'
import { buildFilter, indexDataPoint } from './health'

const type = (id: string) => findDataType(id)!

describe('buildFilter', () => {
  it('uses the field each record kind supports', () => {
    expect(buildFilter(type('steps'), '2026-10-01')).toBe('steps.interval.civil_start_time >= "2026-10-01"')
    expect(buildFilter(type('weight'), '2026-10-01')).toBe('weight.sample_time.civil_time >= "2026-10-01"')
    expect(buildFilter(type('exercise'), '2026-10-01')).toBe('exercise.interval.civil_start_time >= "2026-10-01"')
    expect(buildFilter(type('sleep'), '2026-10-01')).toBe('sleep.interval.civil_end_time >= "2026-10-01"')
  })
  it('spells daily types in snake_case first, camelCase as the fallback', () => {
    const hrv = type('daily-heart-rate-variability')
    expect(buildFilter(hrv, '2026-10-01')).toBe('daily_heart_rate_variability.date >= "2026-10-01"')
    expect(buildFilter(hrv, '2026-10-01', 'camel')).toBe('dailyHeartRateVariability.date >= "2026-10-01"')
  })
})

describe('indexDataPoint', () => {
  it('reads a daily summary date', () => {
    const p = { dailyRestingHeartRate: { date: { year: 2026, month: 10, day: 3 }, beatsPerMinute: '52' } }
    expect(indexDataPoint(type('daily-resting-heart-rate'), p)).toMatchObject({ date: '2026-10-03' })
  })
  it('keys sleep by its civil end date and keeps the point name as id', () => {
    const p = {
      name: 'users/1/dataTypes/sleep/dataPoints/abc',
      sleep: {
        interval: {
          startTime: '2026-10-02T23:10:00Z',
          endTime: '2026-10-03T06:40:00Z',
          civilStartTime: { date: { year: 2026, month: 10, day: 2 } },
          civilEndTime: { date: { year: 2026, month: 10, day: 3 } },
        },
      },
    }
    expect(indexDataPoint(type('sleep'), p)).toEqual({
      id: 'users/1/dataTypes/sleep/dataPoints/abc',
      date: '2026-10-03',
      start: '2026-10-02T23:10:00Z',
      end: '2026-10-03T06:40:00Z',
    })
  })
  it('reads sample times and falls back to the timestamp date', () => {
    const p = { weight: { sampleTime: { physicalTime: '2026-10-04T07:00:00Z' }, weightGrams: 70000 } }
    expect(indexDataPoint(type('weight'), p)).toMatchObject({ date: '2026-10-04', start: '2026-10-04T07:00:00Z' })
  })
  it('returns null when the point has no body', () => {
    expect(indexDataPoint(type('weight'), { name: 'x' })).toBeNull()
  })
})
