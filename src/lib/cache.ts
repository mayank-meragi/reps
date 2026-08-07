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

export function getCachedFile<T>(path: string): CachedFile<T> | null {
  const raw = localStorage.getItem(FILE_PREFIX + path)
  if (!raw) return null
  try {
    return JSON.parse(raw) as CachedFile<T>
  } catch {
    localStorage.removeItem(FILE_PREFIX + path)
    return null
  }
}

export function setCachedFile<T>(path: string, content: T, sha: string | null): void {
  const entry: CachedFile<T> = { content, sha, fetchedAt: new Date().toISOString() }
  localStorage.setItem(FILE_PREFIX + path, JSON.stringify(entry))
}

export function getDirtyPaths(): string[] {
  const raw = localStorage.getItem(DIRTY_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as string[]
  } catch {
    return []
  }
}

export function markDirty(path: string): void {
  const dirty = getDirtyPaths()
  if (!dirty.includes(path)) {
    dirty.push(path)
    localStorage.setItem(DIRTY_KEY, JSON.stringify(dirty))
  }
}

export function clearDirty(path: string): void {
  const dirty = getDirtyPaths().filter((p) => p !== path)
  localStorage.setItem(DIRTY_KEY, JSON.stringify(dirty))
}

/** Wipe cached files and dirty queue (not config). For "force full re-sync". */
export function clearFileCache(): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith(FILE_PREFIX)) keys.push(key)
  }
  keys.forEach((k) => localStorage.removeItem(k))
  localStorage.removeItem(DIRTY_KEY)
}
