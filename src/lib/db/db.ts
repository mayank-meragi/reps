import Dexie, { type EntityTable } from 'dexie'

/** A JSON document that mirrors a file in the data repo. `dirty` = not yet pushed to GitHub. */
export interface FileRow {
  path: string
  content: unknown
  /** Last known git blob sha; null when never pushed */
  sha: string | null
  fetchedAt: string
  dirty: 0 | 1
}

/** One Google Health data point, stored as returned plus the fields we index on. */
export interface HealthRecordRow {
  /** `${type}|${id}` */
  key: string
  /** kebab-case data type, e.g. 'daily-resting-heart-rate' */
  type: string
  /** Civil date (YYYY-MM-DD) the point belongs to */
  date: string
  /** RFC 3339 start (or sample/physical time), when the point carries one */
  start: string | null
  end: string | null
  /** The raw DataPoint object from the API */
  data: unknown
  fetchedAt: string
}

export interface HealthSyncRow {
  type: string
  lastSyncAt: string
  /** Newest civil date seen for this type; the next sync re-reads from a couple of days before it */
  newestDate: string | null
  count: number
  error: string | null
}

export class RepsDB extends Dexie {
  files!: EntityTable<FileRow, 'path'>
  healthRecords!: EntityTable<HealthRecordRow, 'key'>
  healthSync!: EntityTable<HealthSyncRow, 'type'>

  constructor(name = 'reps') {
    super(name)
    this.version(1).stores({
      files: 'path, dirty',
      healthRecords: 'key, type, date, [type+date]',
      healthSync: 'type',
    })
  }
}

export const db = new RepsDB()
