import { e1rmTrend } from './records'
import type { BodyMetric, Session } from '@/lib/types'

export interface StrengthWeightPoint {
  date: string
  e1rm?: number
  weightKg?: number
  isPr?: boolean
}

/** Date-aligned series for a lift's e1RM and body weight. */
export function strengthWeightTrend(exerciseId: string, sessions: Session[], metrics: BodyMetric[]): StrengthWeightPoint[] {
  const byDate = new Map<string, StrengthWeightPoint>()
  for (const point of e1rmTrend(exerciseId, sessions)) byDate.set(point.date, { date: point.date, e1rm: point.e1rm, isPr: point.isPr })
  for (const metric of metrics) byDate.set(metric.date, { ...byDate.get(metric.date), date: metric.date, weightKg: metric.weightKg })
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}
