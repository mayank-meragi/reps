import * as gh from './github'
import {
  getCachedFile,
  setCachedFile,
  getDirtyPaths,
  markDirty,
  clearDirty,
  clearFileCache,
  isConfigured,
} from './cache'
import { mergeFile } from './merge'
import { PATHS } from './paths'
import type { SettingsFile, VenuesFile } from './types'

export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'offline' | 'auth-error' | 'error'

export interface SyncState {
  status: SyncStatus
  pendingCount: number
  error?: string
}

type Listener = (state: SyncState) => void

let state: SyncState = { status: 'idle', pendingCount: 0 }
const listeners = new Set<Listener>()

function setState(next: Partial<SyncState>) {
  state = { ...state, ...next, pendingCount: getDirtyPaths().length }
  listeners.forEach((l) => l(state))
}

export function subscribeSync(listener: Listener): () => void {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

export function getSyncState(): SyncState {
  return state
}

/**
 * Query function: fetch fresh from GitHub, falling back to the local cache
 * when offline. Dirty files always resolve from cache so remote state never
 * clobbers unpushed edits.
 */
export async function loadFile<T>(path: string, fallback: T): Promise<T> {
  const cached = getCachedFile<T>(path)
  if (getDirtyPaths().includes(path)) {
    return cached ? cached.content : fallback
  }
  try {
    const remote = await gh.getFile(path)
    if (remote === null) return cached ? cached.content : fallback
    const content = JSON.parse(remote.content) as T
    setCachedFile(path, content, remote.sha)
    return content
  } catch (e) {
    if (e instanceof gh.OfflineError) {
      setState({ status: 'offline' })
      return cached ? cached.content : fallback
    }
    if (e instanceof gh.TokenInvalidError) {
      setState({ status: 'auth-error', error: e.message })
    }
    if (cached) return cached.content
    throw e
  }
}

/**
 * Apply a local-first mutation: update the cache synchronously (instant UI),
 * mark dirty, and schedule a debounced push.
 */
export function updateFile<T>(path: string, base: T, updater: (current: T) => T): T {
  const cached = getCachedFile<T>(path)
  const next = updater(cached ? cached.content : base)
  setCachedFile(path, next, cached?.sha ?? null)
  markDirty(path)
  setState({ status: 'pending' })
  scheduleFlush()
  return next
}

let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(delayMs = 2000) {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => void flush(), delayMs)
}

let flushing = false

/** Push every dirty file to GitHub. Safe to call repeatedly. */
export async function flush(): Promise<void> {
  if (flushing || !isConfigured()) return
  const dirty = getDirtyPaths()
  if (dirty.length === 0) {
    setState({ status: 'idle' })
    return
  }
  flushing = true
  setState({ status: 'syncing' })
  try {
    for (const path of dirty) {
      await pushOne(path)
    }
    setState({ status: getDirtyPaths().length === 0 ? 'idle' : 'error' })
  } finally {
    flushing = false
  }
}

async function pushOne(path: string): Promise<void> {
  const cached = getCachedFile(path)
  if (!cached) {
    clearDirty(path)
    return
  }
  const body = JSON.stringify(cached.content, null, 2)
  try {
    const { sha } = await gh.putFile(path, body, cached.sha, `Update ${path}`)
    setCachedFile(path, cached.content, sha)
    clearDirty(path)
  } catch (e) {
    if (e instanceof gh.ConflictError) {
      await resolveConflict(path)
      return
    }
    if (e instanceof gh.OfflineError) {
      setState({ status: 'offline' })
      return
    }
    if (e instanceof gh.TokenInvalidError) {
      setState({ status: 'auth-error', error: e.message })
      return
    }
    setState({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

async function resolveConflict(path: string): Promise<void> {
  const cached = getCachedFile(path)
  if (!cached) return
  try {
    const remote = await gh.getFile(path)
    const merged = mergeFile(
      path,
      cached.content,
      remote ? (JSON.parse(remote.content) as unknown) : null,
    )
    const { sha } = await gh.putFile(
      path,
      JSON.stringify(merged, null, 2),
      remote?.sha ?? null,
      `Merge ${path}`,
    )
    setCachedFile(path, merged, sha)
    clearDirty(path)
  } catch (e) {
    // Second conflict in a row or network failure — keep dirty for the next flush
    setState({ status: 'error', error: `Could not sync ${path}: ${e instanceof Error ? e.message : e}` })
  }
}

const defaultSettings: SettingsFile = { schemaVersion: 1, units: 'kg' }
const defaultVenues: VenuesFile = { venues: [] }

export const SEED_FILES: { path: string; content: unknown }[] = [
  { path: PATHS.settings, content: defaultSettings },
  { path: PATHS.venues, content: defaultVenues },
]

/** First-run bootstrap: create seed files on the data branch if absent. */
export async function ensureSeedFiles(): Promise<void> {
  const existing = await gh.getFile(PATHS.settings)
  if (existing !== null) return
  for (const seed of SEED_FILES) {
    const { sha } = await gh.putFile(
      seed.path,
      JSON.stringify(seed.content, null, 2),
      null,
      `Bootstrap ${seed.path}`,
    )
    setCachedFile(seed.path, seed.content, sha)
  }
}

let initialized = false

/** Register flush triggers: app load, tab hide, back online. */
export function initSync(): void {
  if (initialized) return
  initialized = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush()
  })
  window.addEventListener('online', () => void flush())
  if (isConfigured()) void flush()
}

export { clearFileCache }
