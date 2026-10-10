import { db, type FileRow } from './db/db'

/** Pre-database localStorage keys, read once by importLegacyCache() */
const FILE_PREFIX = 'reps.file:'
const DIRTY_KEY = 'reps.dirty'

const CONFIG_KEYS = {
  githubToken: 'reps.githubToken',
  geminiKey: 'reps.geminiKey',
  openaiKey: 'reps.openaiKey',
  anthropicKey: 'reps.anthropicKey',
  aiProvider: 'reps.aiProvider',
  geminiModel: 'reps.geminiModel',
  openaiModel: 'reps.openaiModel',
  anthropicModel: 'reps.anthropicModel',
  dataRepo: 'reps.dataRepo',
  dataBranch: 'reps.dataBranch',
  googleClientId: 'reps.googleClientId',
  googleToken: 'reps.googleToken',
  googleTokenExpiry: 'reps.googleTokenExpiry',
} as const

export type ConfigKey = keyof typeof CONFIG_KEYS

export interface CachedFile<T = unknown> {
  content: T
  /** Last known git blob sha; null when the file has never been pushed */
  sha: string | null
  fetchedAt: string
}

export function getConfig(key: ConfigKey): string | null {
  return localStorage.getItem(CONFIG_KEYS[key])
}

export function setConfig(key: ConfigKey, value: string | null): void {
  if (value === null || value === '') localStorage.removeItem(CONFIG_KEYS[key])
  else localStorage.setItem(CONFIG_KEYS[key], value)
}

export function getDataBranch(): string {
  return getConfig('dataBranch') ?? 'main'
}

export function isConfigured(): boolean {
  return Boolean(getConfig('githubToken') && getConfig('dataRepo'))
}

/**
 * Documents live in IndexedDB (lib/db) — the durable local database. A
 * synchronous in-memory mirror, hydrated once before the app renders, keeps
 * the read API instant; every write updates the mirror and then the database.
 */
const mirror = new Map<string, CachedFile>()
const dirty = new Set<string>()

function persist(path: string, entry: CachedFile | null): void {
  const op: Promise<unknown> = entry
    ? db.files.put({ path, content: entry.content, sha: entry.sha, fetchedAt: entry.fetchedAt, dirty: dirty.has(path) ? 1 : 0 })
    : db.files.delete(path)
  op.catch((e: unknown) => console.error(`Local DB write failed for ${path}`, e))
}

/** Load the database into memory, importing any pre-database localStorage cache once. */
export async function hydrateCache(): Promise<void> {
  try {
    const rows = await db.files.toArray()
    for (const row of rows) {
      mirror.set(row.path, { content: row.content, sha: row.sha, fetchedAt: row.fetchedAt })
      if (row.dirty) dirty.add(row.path)
    }
    await importLegacyCache()
  } catch (e) {
    // Private mode / blocked storage: the app still works for this session, memory only
    console.error('Local database unavailable, running without persistence', e)
  }
}

async function importLegacyCache(): Promise<void> {
  const legacyDirty: string[] = (() => {
    try {
      return JSON.parse(localStorage.getItem(DIRTY_KEY) ?? '[]') as string[]
    } catch {
      return []
    }
  })()
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(FILE_PREFIX)) keys.push(key)
  }
  const rows: FileRow[] = []
  for (const key of keys) {
    const path = key.slice(FILE_PREFIX.length)
    try {
      const legacy = JSON.parse(localStorage.getItem(key) ?? 'null') as CachedFile | null
      if (!legacy) continue
      const isDirty = legacyDirty.includes(path)
      // The database wins unless the legacy copy has unpushed edits it never saw
      if (mirror.has(path) && !isDirty) continue
      mirror.set(path, legacy)
      if (isDirty) dirty.add(path)
      rows.push({ path, content: legacy.content, sha: legacy.sha, fetchedAt: legacy.fetchedAt, dirty: isDirty ? 1 : 0 })
    } catch {
      /* corrupt legacy entry — skip */
    }
  }
  if (rows.length > 0) await db.files.bulkPut(rows)
  // Only drop the legacy copy after the database confirmed the write
  keys.forEach((k) => localStorage.removeItem(k))
  localStorage.removeItem(DIRTY_KEY)
}

export function getCachedFile<T>(path: string): CachedFile<T> | null {
  return (mirror.get(path) as CachedFile<T> | undefined) ?? null
}

export function setCachedFile<T>(path: string, content: T, sha: string | null): void {
  const entry: CachedFile<T> = { content, sha, fetchedAt: new Date().toISOString() }
  mirror.set(path, entry)
  persist(path, entry)
}

export function getDirtyPaths(): string[] {
  return [...dirty]
}

export function markDirty(path: string): void {
  if (dirty.has(path)) return
  dirty.add(path)
  const entry = mirror.get(path)
  if (entry) persist(path, entry)
}

export function clearDirty(path: string): void {
  if (!dirty.delete(path)) return
  const entry = mirror.get(path)
  if (entry) persist(path, entry)
}

/** Wipe cached documents and the dirty queue (not config, not health data). For "force full re-sync". */
export function clearFileCache(): void {
  mirror.clear()
  dirty.clear()
  db.files.clear().catch((e) => console.error('Could not clear local files', e))
}
