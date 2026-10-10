import { getGoogleClientId, getGoogleToken, googleTokenExpiry } from '@/lib/google/auth'
import { findDataType, HEALTH_DATA_TYPES } from '@/lib/google/dataTypes'
import { getIdentity } from '@/lib/google/health'
import {
  clearHealthData,
  healthDateRanges,
  listHealthSyncState,
  queryHealthRecords,
  readHealthWindow,
  syncHealthType,
  type TypeSyncResult,
} from '@/lib/db/health'
import type { HealthSyncRow } from '@/lib/db/db'
import { addDays, effectiveTodayISO } from '@/lib/dates'
import { healthKeys } from '@/lib/queryKeys'
import { BASELINE_DAYS } from '@/lib/health/baseline'
import { buildHealthMonitor, MONITOR_TYPES, type HealthMonitor } from '@/lib/selectors/healthMonitor'
import { buildSleepScore, DEFAULT_SLEEP_NEED_MIN, type SleepScore } from '@/lib/health/sleepScore'
import { buildRecoveryScore, RECOVERY_TYPES, type RecoveryScore } from '@/lib/health/recoveryScore'
import { buildStrainScore, STRAIN_TYPE, type StrainScore } from '@/lib/health/strainScore'
import { getProfile } from './profile'
import { defineCommand } from './registry'

const MAX_QUERY = 1000

export const listHealthDataTypesCommand = defineCommand<Record<string, never>, unknown>({
  name: 'health.list_data_types',
  title: 'List Google Health data types',
  description:
    'Catalog of Google Health data types this app can sync and query: id (pass to health.sync / health.query_records), label, kind (daily = one summary per day; sample = point-in-time; interval = per-period totals; session = sleep/workouts), description, whether it is synced by default, and how much is stored locally (count, first/last date). Heavy intraday types (heart-rate, steps…) are not synced by default — sync them explicitly only when needed.',
  kind: 'read',
  parameters: { type: 'object', properties: {} },
  handler: async () => {
    const [state, ranges] = await Promise.all([listHealthSyncState(), healthDateRanges()])
    const counts = new Map(state.map((s) => [s.type, s.count]))
    return HEALTH_DATA_TYPES.map((d) => ({
      ...d,
      storedCount: counts.get(d.id) ?? 0,
      firstDate: ranges.get(d.id)?.first ?? null,
      lastDate: ranges.get(d.id)?.last ?? null,
    }))
  },
})

export interface HealthSyncStatus {
  clientIdConfigured: boolean
  connected: boolean
  sessionExpiresAt: string | null
  types: HealthSyncRow[]
}

export const healthSyncStatusCommand = defineCommand<Record<string, never>, HealthSyncStatus>({
  name: 'health.sync_status',
  title: 'Google Health connection and sync status',
  description:
    'Whether the Google OAuth client ID is configured, whether a Google session is currently active (and when it expires), and for each data type the last sync time, newest stored date, record count and last error. Use before health.sync to know if the user must reconnect in Settings.',
  kind: 'read',
  parameters: { type: 'object', properties: {} },
  handler: async () => ({
    clientIdConfigured: Boolean(getGoogleClientId()),
    connected: Boolean(getGoogleToken()),
    sessionExpiresAt: googleTokenExpiry(),
    types: await listHealthSyncState(),
  }),
})

interface SyncArgs {
  types?: string[]
  backfillDays?: number
}

export const healthSyncCommand = defineCommand<SyncArgs, { results: TypeSyncResult[] }>({
  name: 'health.sync',
  title: 'Sync Google Health data',
  description:
    'Pull Google Health data into the local database. Omit `types` to sync the default set (sleep, exercise, daily resting HR/HRV/respiration/SpO2/skin temperature/VO2 max, weight, body fat). Pass type ids from health.list_data_types to sync others. The first sync of a type reads back `backfillDays` (default 30, max 365); later syncs only re-read recent days. Requires an active Google session; if it fails with a reconnect message, ask the user to reconnect in Settings.',
  kind: 'write',
  parameters: {
    type: 'object',
    properties: {
      types: { type: 'array', items: { type: 'string' }, description: 'Data type ids; default = the default set' },
      backfillDays: { type: 'number', description: 'Days to read back on a type\'s first sync (default 30, max 365)' },
    },
  },
  handler: async (args, ctx) => {
    const ids = args.types?.length ? args.types : HEALTH_DATA_TYPES.filter((d) => d.defaultSync).map((d) => d.id)
    const unknown = ids.filter((id) => !findDataType(id))
    if (unknown.length) throw new Error(`Unknown data types: ${unknown.join(', ')}. Use health.list_data_types.`)
    const backfill = Math.min(Math.max(Math.round(args.backfillDays ?? 30), 1), 365)
    // Fails fast with a clear error if the session is missing or the account is not linked
    await getIdentity()
    const results: TypeSyncResult[] = []
    for (const id of ids) {
      ctx.onProgress?.(`Syncing ${id}…`)
      try {
        results.push(await syncHealthType(id, backfill))
      } catch (e) {
        if (e instanceof Error && /reconnect|unreachable/i.test(e.message)) throw e
        results.push({ type: id, fetched: 0, since: '', error: e instanceof Error ? e.message : String(e) })
      }
    }
    await ctx.qc.invalidateQueries({ queryKey: healthKeys.all })
    return { results }
  },
  summarize: (_args, r) =>
    `Synced Google Health (${r.results.reduce((n, x) => n + x.fetched, 0)} records, ${r.results.filter((x) => x.error).length} errors)`,
})

interface QueryArgs {
  type: string
  from?: string
  to?: string
  limit?: number
  order?: 'newest-first' | 'oldest-first'
}

export const queryHealthRecordsCommand = defineCommand<QueryArgs, unknown>({
  name: 'health.query_records',
  title: 'Query stored Google Health records',
  description: `Read stored (already synced) Google Health records of one data type from the local database, filtered by civil date range (YYYY-MM-DD, inclusive). Each record has date, start/end timestamps and \`data\`, the raw Google DataPoint (values such as counts are strings). Max ${MAX_QUERY} records per call (default 100, newest first). Check health.list_data_types for what is stored; run health.sync first if it is missing or stale.`,
  kind: 'read',
  parameters: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Data type id from health.list_data_types' },
      from: { type: 'string', description: 'YYYY-MM-DD' },
      to: { type: 'string', description: 'YYYY-MM-DD' },
      limit: { type: 'number' },
      order: { type: 'string', enum: ['newest-first', 'oldest-first'] },
    },
    required: ['type'],
  },
  handler: async (args) => {
    if (!findDataType(args.type)) throw new Error(`Unknown data type: ${args.type}. Use health.list_data_types.`)
    const rows = await queryHealthRecords({
      type: args.type,
      from: args.from,
      to: args.to,
      limit: Math.min(Math.max(Math.round(args.limit ?? 100), 1), MAX_QUERY),
      newestFirst: args.order !== 'oldest-first',
    })
    return rows.map(({ date, start, end, data }) => ({ date, start, end, data }))
  },
})

export const clearHealthDataCommand = defineCommand<Record<string, never>, null>({
  name: 'health.clear_local_data',
  title: 'Clear locally stored Google Health data',
  description:
    'Delete all synced Google Health records and sync cursors from the local database. Nothing is deleted in Google; a later health.sync re-downloads the data.',
  kind: 'destructive',
  parameters: { type: 'object', properties: {} },
  handler: async (_args, ctx) => {
    await clearHealthData()
    await ctx.qc.invalidateQueries({ queryKey: healthKeys.all })
    return null
  },
  summarize: () => 'Cleared local Google Health data',
})

export const getHealthMonitorCommand = defineCommand<{ date?: string }, HealthMonitor>({
  name: 'health.get_monitor',
  title: 'Read the Health Monitor for a day',
  description: `The Health Monitor shown on the Health page, for one civil date (YYYY-MM-DD, default today): respiratory rate (rpm), resting heart rate (bpm), HRV (ms), blood oxygen (%), skin temperature (°C) and sleep (minutes asleep), each with the day's value, the ${BASELINE_DAYS}-day baseline (mean, sd, low/high = mean ± 1 sd), a status (lower / higher / normal vs that baseline, or unknown with fewer than 5 prior days) and a tone, plus a timeline of that day's primary sleep and workouts. Reads only synced local data: if values are null, check health.sync_status and run health.sync.`,
  kind: 'read',
  parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, default today' } } },
  handler: async (args) => {
    const date = args.date ?? effectiveTodayISO()
    return buildHealthMonitor(date, await readHealthWindow(MONITOR_TYPES, addDays(date, -BASELINE_DAYS - 1), date))
  },
})

export interface HealthScores {
  date: string
  sleep: SleepScore
  recovery: RecoveryScore
  strain: StrainScore
}

export const getHealthScoresCommand = defineCommand<{ date?: string }, HealthScores>({
  name: 'health.get_scores',
  title: 'Read the daily scores',
  description:
    "The score rings on the Health page for one civil date (YYYY-MM-DD, default today). `sleep` is the 0–100 sleep score for the night that ended that day, with its parts (duration 40, efficiency 20, restorative deep/REM 25, consistency 15; a part with missing data is dropped and the rest rescaled), each part's points and the inputs behind it, plus the underlying facts (minutes asleep/in bed, deep/REM minutes, bedtime). Duration is measured against the user's sleep need (profile.sleepNeedMinutes, default 480; change it with profile.update). `recovery` is the 0–100 recovery score (zones: red under 34, yellow 34–66, green 67+): today's overnight HRV, resting heart rate, sleep score and respiratory rate compared, as z-scores, with the user's own previous-30-day baseline (needs 5 days; until then status is 'calibrating' with progress), weighted HRV 40 / resting HR 25 / sleep 20 / respiratory 10 and rescaled over the inputs present, plus illness flags for unusual skin temperature or low SpO2 that subtract up to 5 points each. Each component carries its value, baseline mean, z (positive = better recovered), effective weight and a readable detail, so you can explain exactly why the score is what it is. `strain` is the 0–100% strain score for the day: load = Σ minutes at each bpm × max(0, bpm − 110), strain = 100×(1−e^(−load/1234)) — every minute above 110 bpm counts, harder minutes count proportionally more, and anything below 110 (sleep, rest, strolling) counts for nothing. The constants were fitted to the user's Bevel strain values over 7 days, so expect roughly Bevel-like numbers (average miss ~3–8 points). It returns the load, minutes above 110/130/150 bpm, how many minutes of data exist (low on a partial day), the parameters, and `target`, the recommended strain range for that day derived from the day's recovery zone (red <35, yellow 35–60, green 60–85). Needs the heart-rate type synced (health.sync does this by default). If sleep.score is null, check health.sync_status and run health.sync.",
  kind: 'read',
  parameters: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD, default today' } } },
  handler: async (args, ctx) => {
    const date = args.date ?? effectiveTodayISO()
    const need = getProfile(ctx.qc)?.sleepNeedMinutes ?? DEFAULT_SLEEP_NEED_MIN
    const metricFrom = addDays(date, -BASELINE_DAYS - 1)
    // Sleep reaches further back: each baseline night's score needs its own 7 earlier nights
    const sleepFrom = addDays(date, -BASELINE_DAYS - 8)
    const metricTypes = [RECOVERY_TYPES.hrv, RECOVERY_TYPES.rhr, RECOVERY_TYPES.rr, RECOVERY_TYPES.spo2, RECOVERY_TYPES.temp]
    const [metrics, sleepWindow, hr] = await Promise.all([
      readHealthWindow(metricTypes, metricFrom, date),
      readHealthWindow([RECOVERY_TYPES.sleep], sleepFrom, date),
      readHealthWindow([STRAIN_TYPE], date, date),
    ])
    const sleep = sleepWindow[RECOVERY_TYPES.sleep]
    const recovery = buildRecoveryScore(
      date,
      {
        hrv: metrics[RECOVERY_TYPES.hrv],
        rhr: metrics[RECOVERY_TYPES.rhr],
        rr: metrics[RECOVERY_TYPES.rr],
        spo2: metrics[RECOVERY_TYPES.spo2],
        temp: metrics[RECOVERY_TYPES.temp],
        sleep,
      },
      need,
    )
    return {
      date,
      sleep: buildSleepScore(date, sleep, need),
      recovery,
      strain: buildStrainScore(date, hr[STRAIN_TYPE], recovery.zone),
    }
  },
})
