import { addDays } from '@/lib/dates'
import type { StoredPoint } from '@/lib/health/types'
import { db, type HealthRecordRow, type HealthSyncRow } from './db'
import { findDataType } from '@/lib/google/dataTypes'
import { forEachDataPointPage, type DataPoint, indexDataPoint, listAllDataPoints } from '@/lib/google/health'
import { HeartRateHistogramBuilder } from '@/lib/google/rollup'

export interface TypeSyncResult {
  type: string
  fetched: number
  since: string
  error?: string
}

/**
 * Pull one data type from Google into the local database. First sync reads
 * `backfillDays` back; later syncs re-read from two days before the newest
 * stored date (late-arriving device syncs revise recent points).
 */
export async function syncHealthType(typeId: string, backfillDays: number): Promise<TypeSyncResult> {
  const type = findDataType(typeId)
  if (!type) throw new Error(`Unknown health data type: ${typeId}`)
  const state = await db.healthSync.get(typeId)
  const since = state?.newestDate ? addDays(state.newestDate, -2) : addDays(new Date().toISOString().slice(0, 10), -backfillDays)
  try {
    let points: DataPoint[]
    if (type.aggregate === 'daily-hr-histogram') {
      const builder = new HeartRateHistogramBuilder()
      await forEachDataPointPage(type, since, (page) => builder.add(page))
      points = builder.finish()
    } else {
      points = await listAllDataPoints(type, since)
    }
    const fetchedAt = new Date().toISOString()
    const rows: HealthRecordRow[] = []
    for (const p of points) {
      const idx = indexDataPoint(type, p)
      if (idx) rows.push({ key: `${typeId}|${idx.id}`, type: typeId, date: idx.date, start: idx.start, end: idx.end, data: p, fetchedAt })
    }
    await db.healthRecords.bulkPut(rows)
    const newest = rows.reduce<string | null>((n, r) => (n === null || r.date > n ? r.date : n), state?.newestDate ?? null)
    await db.healthSync.put({
      type: typeId,
      lastSyncAt: fetchedAt,
      newestDate: newest,
      count: await db.healthRecords.where('type').equals(typeId).count(),
      error: null,
    })
    return { type: typeId, fetched: rows.length, since }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await db.healthSync.put({
      type: typeId,
      lastSyncAt: state?.lastSyncAt ?? '',
      newestDate: state?.newestDate ?? null,
      count: state?.count ?? 0,
      error: message,
    })
    // Auth/offline failures abort the whole run; per-type API errors are reported and the run continues
    throw e
  }
}

export interface RecordQuery {
  type: string
  from?: string
  to?: string
  limit: number
  newestFirst: boolean
}

export async function queryHealthRecords(q: RecordQuery): Promise<HealthRecordRow[]> {
  const from = q.from ?? '0000-01-01'
  const to = q.to ?? '9999-12-31'
  const col = db.healthRecords.where('[type+date]').between([q.type, from], [q.type, to], true, true)
  const ordered = q.newestFirst ? col.reverse() : col
  return ordered.limit(q.limit).toArray()
}

export function listHealthSyncState(): Promise<HealthSyncRow[]> {
  return db.healthSync.toArray()
}

export async function clearHealthData(): Promise<void> {
  await db.transaction('rw', db.healthRecords, db.healthSync, async () => {
    await db.healthRecords.clear()
    await db.healthSync.clear()
  })
}

export async function healthDateRanges(): Promise<Map<string, { first: string; last: string }>> {
  const out = new Map<string, { first: string; last: string }>()
  for (const s of await db.healthSync.toArray()) {
    const first = await db.healthRecords.where('[type+date]').between([s.type, ''], [s.type, '￿']).first()
    const last = await db.healthRecords.where('[type+date]').between([s.type, ''], [s.type, '￿']).last()
    if (first && last) out.set(s.type, { first: first.date, last: last.date })
  }
  return out
}

/**
 * Stored records for several types over one civil-date window (inclusive), newest
 * first, as the selectors consume them. The one place the score and monitor
 * commands read time windows from.
 */
export async function readHealthWindow(types: readonly string[], from: string, to: string, limit = 400): Promise<Record<string, StoredPoint[]>> {
  const entries = await Promise.all(
    types.map(async (type) => {
      const rows = await queryHealthRecords({ type, from, to, limit, newestFirst: true })
      return [type, rows.map(({ date, start, end, data }) => ({ date, start, end, data }))] as const
    }),
  )
  return Object.fromEntries(entries)
}
