import type { QueryClient } from '@tanstack/react-query'
import { PATHS } from '@/lib/paths'
import { currentMonthKey } from '@/lib/dates'
import { updateFile } from '@/lib/sync'
import { fileQueryKey } from '@/lib/queryKeys'
import type { ActivityEntry, ActivitySource } from '@/lib/types'

const emptyLog: ActivityEntry[] = []

/**
 * Persisted audit trail for every write, whichever surface made it. Backs a
 * future Settings → AI activity view — the thing that makes "let the AI do
 * everything" tolerable, because every AI write is visible and inspectable.
 */
export function appendActivity(
  qc: QueryClient,
  entry: {
    source: ActivitySource
    command: string
    args: Record<string, unknown>
    summary: string
    undoable: boolean
  },
): void {
  const path = PATHS.activity(currentMonthKey())
  const full: ActivityEntry = { id: crypto.randomUUID(), at: new Date().toISOString(), ...entry }
  const next = updateFile<ActivityEntry[]>(path, emptyLog, (current) => [...current, full])
  qc.setQueryData(fileQueryKey(path), next)
}
