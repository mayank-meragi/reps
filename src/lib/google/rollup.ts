import type { DataPoint } from './health'

/**
 * Heart rate arrives as ~38,000 samples a day. Storing them raw would bloat the
 * local database, so a sync folds them into one row per civil day:
 *   { heartRate: { date, minutesByBpm: { "72": 12.3, … }, totalMinutes } }
 * Each sample is credited with the time until the next sample (capped at 60 s,
 * so gaps while the band is off don't count as hours at one bpm). Re-syncing a
 * day replaces its row, so a partial "today" keeps growing.
 *
 * Pages arrive newest-first; the builder is fed page by page and keeps only the
 * last sample, so memory stays flat however long the backfill is.
 */

const MAX_GAP_SEC = 60

interface Day {
  date: { year: number; month: number; day: number }
  minutes: Map<number, number>
  total: number
}

export class HeartRateHistogramBuilder {
  private days = new Map<string, Day>()
  private newer: number | null = null

  /** Feed the next page (newest-first order, continuing from the previous page). */
  add(points: DataPoint[]): void {
    for (const p of points) {
      const sample = (
        p.heartRate as
          | { sampleTime?: { physicalTime?: string; civilTime?: { date?: { year: number; month: number; day: number } } }; beatsPerMinute?: string }
          | undefined
      )
      const t = sample?.sampleTime?.physicalTime ? Date.parse(sample.sampleTime.physicalTime) : NaN
      const date = sample?.sampleTime?.civilTime?.date
      const bpm = Number(sample?.beatsPerMinute)
      if (!date || !Number.isFinite(t) || !Number.isFinite(bpm)) continue
      if (this.newer !== null) {
        const minutes = Math.min(MAX_GAP_SEC, Math.max(0, (this.newer - t) / 1000)) / 60
        const key = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`
        const day = this.days.get(key) ?? { date, minutes: new Map<number, number>(), total: 0 }
        day.minutes.set(bpm, (day.minutes.get(bpm) ?? 0) + minutes)
        day.total += minutes
        this.days.set(key, day)
      }
      this.newer = t
    }
  }

  finish(): DataPoint[] {
    return [...this.days.values()].map((d) => ({
      heartRate: {
        date: d.date,
        minutesByBpm: Object.fromEntries([...d.minutes].sort(([a], [b]) => a - b).map(([bpm, m]) => [bpm, Math.round(m * 100) / 100])),
        totalMinutes: Math.round(d.total * 100) / 100,
      },
    }))
  }
}
