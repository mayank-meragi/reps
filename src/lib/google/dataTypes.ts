/**
 * Catalog of Google Health API data types we know how to read, from
 * https://developers.google.com/health/data-types. Exposed to the AI via
 * health.list_data_types so it picks what to sync and query.
 */

export type RecordKind = 'interval' | 'sample' | 'daily' | 'session'

export interface HealthDataType {
  /** kebab-case id used in URLs and as our storage `type` */
  id: string
  label: string
  kind: RecordKind
  description: string
  /** Synced by default: small (≈1 point per day or per event). Heavy types are opt-in. */
  defaultSync: boolean
  /** Per-minute data rolled up to one stored row per day while syncing (see rollup.ts) */
  aggregate?: 'daily-hr-histogram'
}

const t = (
  id: string,
  label: string,
  kind: RecordKind,
  description: string,
  defaultSync = false,
  aggregate?: HealthDataType['aggregate'],
): HealthDataType => ({ id, label, kind, description, defaultSync, ...(aggregate ? { aggregate } : {}) })

export const HEALTH_DATA_TYPES: HealthDataType[] = [
  t('sleep', 'Sleep', 'session', 'Sleep sessions with stages, duration and efficiency', true),
  t('exercise', 'Exercise', 'session', 'Workout sessions (type, duration, calories, heart rate summary)', true),
  t('daily-resting-heart-rate', 'Resting heart rate', 'daily', 'Daily resting heart rate (bpm)', true),
  t('daily-heart-rate-variability', 'Heart rate variability', 'daily', 'Daily HRV (ms)', true),
  t('daily-respiratory-rate', 'Respiratory rate', 'daily', 'Daily breathing rate during sleep', true),
  t('daily-oxygen-saturation', 'Oxygen saturation', 'daily', 'Daily SpO2 summary', true),
  t('daily-sleep-temperature-derivations', 'Sleep skin temperature', 'daily', 'Nightly skin temperature deviation', true),
  t('daily-vo2-max', 'VO2 max', 'daily', 'Daily cardio-fitness estimate', true),
  t('daily-heart-rate-zones', 'Heart rate zones', 'daily', 'Personal heart rate zone thresholds for the day', true),
  t('weight', 'Weight', 'sample', 'Body weight measurements', true),
  t('body-fat', 'Body fat', 'sample', 'Body fat percentage measurements', true),
  t('height', 'Height', 'sample', 'Height measurements', true),
  t(
    'heart-rate',
    'Heart rate',
    'sample',
    'All-day heart rate (~38,000 samples a day), stored as one row per day: data.heartRate.minutesByBpm maps each bpm to the minutes spent at it, data.heartRate.totalMinutes. Used for the strain score.',
    true,
    'daily-hr-histogram',
  ),
  t('heart-rate-variability', 'HRV (raw)', 'sample', 'Intraday HRV samples'),
  t('oxygen-saturation', 'SpO2 (raw)', 'sample', 'Intraday oxygen saturation samples'),
  t('steps', 'Steps (raw)', 'interval', 'Per-minute step counts — large'),
  t('distance', 'Distance (raw)', 'interval', 'Per-minute distance — large'),
  t('floors', 'Floors', 'interval', 'Floors climbed'),
  t('active-zone-minutes', 'Active zone minutes', 'interval', 'Minutes in elevated heart rate zones'),
  t('active-minutes', 'Active minutes', 'interval', 'Active minutes by intensity'),
  t('active-energy-burned', 'Active energy', 'interval', 'Active calories burned'),
  t('total-calories', 'Total calories', 'interval', 'Total energy expenditure'),
  t('time-in-heart-rate-zone', 'Time in HR zone', 'interval', 'Per-minute zone records (LIGHT/MODERATE/VIGOROUS/PEAK) — large; LIGHT starts at 30 bpm so it includes sleep'),
  t('sedentary-period', 'Sedentary periods', 'interval', 'Stretches of inactivity'),
  t('activity-level', 'Activity level', 'interval', 'Activity level over time'),
]

export function findDataType(id: string): HealthDataType | undefined {
  return HEALTH_DATA_TYPES.find((d) => d.id === id)
}

export const kebabToSnake = (s: string) => s.replace(/-/g, '_')
export const kebabToCamel = (s: string) => s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
