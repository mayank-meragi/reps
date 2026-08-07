/**
 * Merge local and remote copies of a data file after a sha conflict.
 * Anything with an `id` array-merges by id (newer `updatedAt` wins, remote-only
 * ids are kept); everything else is a shallow object merge with local winning.
 */
export function mergeFile(_path: string, local: unknown, remote: unknown): unknown {
  if (remote == null) return local
  if (Array.isArray(local) && Array.isArray(remote) && hasIds(local) && hasIds(remote)) {
    return mergeById(local, remote)
  }
  if (typeof local === 'object' && typeof remote === 'object' && !Array.isArray(local) && !Array.isArray(remote)) {
    return { ...(remote as object), ...(local as object) }
  }
  return local
}

interface Identified {
  id: string
  updatedAt?: string
  date?: string
}

function hasIds(arr: unknown[]): arr is Identified[] {
  return arr.every((x) => typeof x === 'object' && x !== null && 'id' in x)
}

function mergeById(local: Identified[], remote: Identified[]): Identified[] {
  const byId = new Map<string, Identified>()
  for (const item of remote) byId.set(item.id, item)
  for (const item of local) {
    const existing = byId.get(item.id)
    if (!existing || (item.updatedAt ?? '') >= (existing.updatedAt ?? '')) byId.set(item.id, item)
  }
  return [...byId.values()].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
}
